import { spawn } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import { Pool, type PoolClient } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://sessions:sessions@localhost:5432/sessions";
const pollMs = Number(process.env.WORKFLOW_EXECUTOR_POLL_MS ?? 1500);
const jobRoot = process.env.SESSIONS_JOB_ROOT ?? "/sessions-jobs";
const dockerVolume = process.env.SESSIONS_JOB_VOLUME ?? "sessions_jobs";
const maxLogBytes = Number(
  process.env.SESSIONS_ACTION_LOG_BYTES ?? 2 * 1024 * 1024,
);
const memory = process.env.SESSIONS_ACTION_MEMORY ?? "1g";
const cpus = process.env.SESSIONS_ACTION_CPUS ?? "1.0";
const pids = process.env.SESSIONS_ACTION_PIDS ?? "256";

const pool = new Pool({ connectionString: databaseUrl, max: 5 });

type Run = {
  id: string;
  repository_id: string;
  commit_id: string;
  workspace_id: string;
};

type Check = {
  id: string;
  name: string;
  category: string;
  container_image: string;
  command_argv: string[];
  timeout_seconds: number;
  network_policy: "none" | "egress";
  secret_names: string[];
};

function safePath(value: string): string {
  if (!value || value.startsWith("/") || value.includes("\0")) {
    throw new Error(`unsafe manifest path: ${value}`);
  }
  const normalized = posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`unsafe manifest path: ${value}`);
  }
  return normalized;
}

function bounded(
  buffer: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
): Buffer<ArrayBufferLike> {
  if (buffer.length >= maxLogBytes) return buffer;
  const room = maxLogBytes - buffer.length;
  return Buffer.concat([buffer, chunk.subarray(0, room)]);
}

function actionKey(): Buffer {
  const raw = process.env.SESSIONS_ACTION_SECRET_KEY;
  if (!raw) {
    throw new Error("Actions secret encryption key is not configured");
  }
  const key = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("Actions secret encryption key must decode to 32 bytes");
  }
  return key;
}

function decryptSecret(row: {
  nonce: string;
  auth_tag: string;
  ciphertext: string;
}): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    actionKey(),
    Buffer.from(row.nonce, "base64"),
  );
  decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function redact(text: string, secrets: Record<string, string>): string {
  let value = text;
  for (const secret of Object.values(secrets).sort(
    (a, b) => b.length - a.length,
  )) {
    if (secret.length >= 4) value = value.split(secret).join("***");
  }
  return value;
}

async function claimRun(client: PoolClient): Promise<Run | null> {
  await client.query("begin");
  try {
    const result = await client.query<Run>(
      "select id,repository_id,commit_id,workspace_id from action_runs where execution_kind='customer_workflow' and status='queued' order by created_at for update skip locked limit 1",
    );
    if (!result.rowCount) {
      await client.query("rollback");
      return null;
    }
    const run = result.rows[0];
    await client.query(
      "update action_runs set status='running',started_at=now() where id=$1",
      [run.id],
    );
    await client.query("commit");
    return run;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function reconstruct(run: Run): Promise<void> {
  const root = `${jobRoot}/${run.id}/source`;
  await rm(`${jobRoot}/${run.id}`, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const checkpoint = await pool.query(
    "select record from sessions_repository_checkpoints where repository_id=$1 and checkpoint_id=$2",
    [run.repository_id, run.commit_id],
  );
  const record = checkpoint.rows[0]?.record;
  if (!record?.sourceManifestId) {
    throw new Error("workflow commit has no source manifest");
  }

  const manifestResult = await pool.query(
    "select manifest from repository_manifests where repository_id=$1 and id=$2",
    [run.repository_id, record.sourceManifestId],
  );
  const manifest = manifestResult.rows[0]?.manifest;
  if (!manifest) throw new Error("workflow source manifest is missing");

  for (const entry of manifest.entries ?? []) {
    const relativePath = safePath(String(entry.path));
    const objectResult = await pool.query(
      "select digest,content from sessions_repository_objects where repository_id=$1 and object_id=$2",
      [run.repository_id, entry.objectId],
    );
    if (!objectResult.rowCount) {
      throw new Error(`missing source object: ${entry.objectId}`);
    }

    const content = Buffer.from(objectResult.rows[0].content);
    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== entry.digest || digest !== objectResult.rows[0].digest) {
      throw new Error(`source integrity failure: ${relativePath}`);
    }

    const target = `${root}/${relativePath}`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { mode: 0o444 });
  }
}

async function loadSecrets(
  run: Run,
  names: string[],
): Promise<Record<string, string>> {
  if (!names.length) return {};
  const result = await pool.query(
    "select name,ciphertext,nonce,auth_tag from repository_action_secrets where workspace_id=$1 and repository_id=$2 and name=any($3::text[])",
    [run.workspace_id, run.repository_id, names],
  );
  const found = new Map<string, (typeof result.rows)[number]>(
    result.rows.map((row) => [String(row.name), row]),
  );
  const secrets: Record<string, string> = {};
  for (const name of names) {
    const row = found.get(name);
    if (!row) throw new Error(`required Actions secret is missing: ${name}`);
    secrets[name] = decryptSecret(row);
  }
  return secrets;
}

async function runContainer(
  run: Run,
  check: Check,
  secrets: Record<string, string>,
) {
  const cleanRunId = run.id.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 28);
  const cleanCheckId = check.id.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 20);
  const container = `sessions-job-${cleanRunId}-${cleanCheckId}`;
  const workdir = `/jobs/${run.id}/source`;
  const network = check.network_policy === "egress" ? "bridge" : "none";

  const args: string[] = [
    "run",
    "--rm",
    "--name",
    container,
    "--network",
    network,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    pids,
    "--memory",
    memory,
    "--cpus",
    cpus,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=64m",
    "--mount",
    `type=volume,src=${dockerVolume},dst=/jobs,readonly`,
    "--workdir",
    workdir,
  ];

  for (const [name, value] of Object.entries(secrets)) {
    args.push("--env", `${name}=${value}`);
  }
  args.push(check.container_image, ...check.command_argv);

  const started = Date.now();
  let output: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let timedOut = false;
  const child = spawn("docker", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH:
        process.env.PATH ??
        "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      DOCKER_HOST:
        process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock",
    },
  });

  child.stdout.on("data", (chunk: Buffer | string) => {
    output = bounded(output, Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    output = bounded(output, Buffer.from(chunk));
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    spawn("docker", ["rm", "-f", container], { stdio: "ignore" }).unref();
    child.kill("SIGKILL");
  }, check.timeout_seconds * 1000);

  const exitCode = await new Promise<number>((resolve) => {
    child.once("error", () => resolve(127));
    child.once("close", (code) => resolve(code ?? 1));
  });
  clearTimeout(timeout);

  const raw = output.toString("utf8");
  return {
    exitCode: timedOut ? 124 : exitCode,
    log: redact(raw, secrets),
    logTruncated: output.length >= maxLogBytes,
    timedOut,
    durationMs: Date.now() - started,
    logDigest: createHash("sha256").update(output).digest("hex"),
    containerImage: check.container_image,
    command: check.command_argv,
    network,
    secretNames: Object.keys(secrets),
    secretsRedacted: true,
    readOnlyRoot: true,
    capabilities: "none",
    memory,
    cpus,
    pids,
  };
}

async function execute(run: Run): Promise<void> {
  await reconstruct(run);
  const result = await pool.query<Check>(
    "select id,name,category,container_image,command_argv,timeout_seconds,network_policy,secret_names from action_checks where action_run_id=$1 order by id",
    [run.id],
  );

  let failed = false;
  for (const raw of result.rows) {
    const check: Check = {
      ...raw,
      command_argv: Array.isArray(raw.command_argv) ? raw.command_argv : [],
      secret_names: Array.isArray(raw.secret_names) ? raw.secret_names : [],
    };

    if (failed) {
      await pool.query(
        "update action_checks set status='completed',conclusion='skipped',summary='Skipped after an earlier workflow step failed',completed_at=now() where id=$1",
        [check.id],
      );
      continue;
    }

    await pool.query(
      "update action_checks set status='running',started_at=now() where id=$1",
      [check.id],
    );

    try {
      const secrets = await loadSecrets(run, check.secret_names);
      const execution = await runContainer(run, check, secrets);
      const conclusion = execution.exitCode === 0 ? "success" : "failure";
      failed = conclusion === "failure";
      await pool.query(
        "update action_checks set status='completed',conclusion=$2,summary=$3,evidence=$4,log_text=$5,exit_code=$6,completed_at=now() where id=$1",
        [
          check.id,
          conclusion,
          execution.timedOut
            ? "Timed out in isolated Sessions executor"
            : `Exited with code ${execution.exitCode}`,
          JSON.stringify({ ...execution, log: undefined }),
          execution.log,
          execution.exitCode,
        ],
      );
    } catch (error) {
      failed = true;
      await pool.query(
        "update action_checks set status='completed',conclusion='failure',summary=$2,evidence=$3,completed_at=now() where id=$1",
        [
          check.id,
          error instanceof Error ? error.message : "workflow execution failed",
          JSON.stringify({ executorFailure: true }),
        ],
      );
    }
  }

  await pool.query(
    "update action_runs set status='completed',conclusion=$2,completed_at=now() where id=$1",
    [run.id, failed ? "failure" : "success"],
  );
  await rm(`${jobRoot}/${run.id}`, { recursive: true, force: true });
}

async function failRun(run: Run, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await pool.query(
    "update action_checks set status='completed',conclusion='failure',summary=$2,completed_at=now() where action_run_id=$1 and status in ('queued','running')",
    [run.id, message],
  );
  await pool.query(
    "update action_runs set status='completed',conclusion='failure',completed_at=now() where id=$1",
    [run.id],
  );
  await rm(`${jobRoot}/${run.id}`, { recursive: true, force: true }).catch(
    () => undefined,
  );
}

async function main(): Promise<void> {
  console.log(
    JSON.stringify({
      level: "info",
      event: "workflow-executor.started",
      jobRoot,
      dockerVolume,
      defaultNetwork: "none",
      memory,
      cpus,
      pids,
    }),
  );

  for (;;) {
    const client = await pool.connect();
    let run: Run | null = null;
    try {
      run = await claimRun(client);
    } finally {
      client.release();
    }

    if (!run) {
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
      continue;
    }

    try {
      await execute(run);
      console.log(
        JSON.stringify({ level: "info", event: "workflow.completed", runId: run.id }),
      );
    } catch (error) {
      console.error(error);
      await failRun(run, error);
    }
  }
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
