import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";

const server = (process.env.SESSIONS_PRIVATE_RUNNER_URL ?? "").replace(/\/$/, "");
const token = process.env.SESSIONS_PRIVATE_RUNNER_TOKEN ?? "";
const pollMs = Number(process.env.SESSIONS_PRIVATE_RUNNER_POLL_MS ?? 2000);
const root = process.env.SESSIONS_PRIVATE_RUNNER_ROOT ?? "/tmp/sessions-private-runner";
const maxLogBytes = Number(process.env.SESSIONS_ACTION_LOG_BYTES ?? 2 * 1024 * 1024);
const memory = process.env.SESSIONS_ACTION_MEMORY ?? "1g";
const cpus = process.env.SESSIONS_ACTION_CPUS ?? "1.0";
const pids = process.env.SESSIONS_ACTION_PIDS ?? "256";

if (!server || !/^https:\/\//.test(server)) {
  throw new Error("SESSIONS_PRIVATE_RUNNER_URL must be an https:// Sessions endpoint");
}
if (!token.startsWith("runner_")) {
  throw new Error("SESSIONS_PRIVATE_RUNNER_TOKEN is required");
}

type Check = {
  id: string;
  name: string;
  container_image: string;
  command_argv: string[];
  timeout_seconds: number;
  network_policy: "none" | "egress";
  secret_names: string[];
};

type Job = {
  id: string;
  repository_id: string;
  commit_id: string;
  leaseSeconds: number;
  checks: Check[];
};

type CommandResult = {
  conclusion: "success" | "failure";
  summary: string;
  exitCode: number;
  log: string;
  evidence: Record<string, unknown>;
};

function sha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function safePath(value: string) {
  if (!value || value.startsWith("/") || value.includes("\0")) {
    throw new Error(`unsafe manifest path: ${value}`);
  }
  const normalized = posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`unsafe manifest path: ${value}`);
  }
  return normalized;
}

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Runner ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${server}${path}`, { ...init, headers });
  const value = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(value?.error ?? `private runner API ${response.status}`);
  return value;
}

function redact(text: string, secretValues: Record<string, string>) {
  let output = text;
  for (const value of Object.values(secretValues).sort((a, b) => b.length - a.length)) {
    if (value.length >= 4) output = output.split(value).join("***");
  }
  return output;
}

function bounded(buffer: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> {
  if (buffer.length >= maxLogBytes) return buffer;
  return Buffer.concat([buffer, chunk.subarray(0, maxLogBytes - buffer.length)]);
}

async function reconstruct(job: Job) {
  const jobRoot = `${root}/${job.id}`;
  const source = `${jobRoot}/source`;
  await rm(jobRoot, { recursive: true, force: true });
  await mkdir(source, { recursive: true });
  const state = await request(`/api/private-runner/jobs/${encodeURIComponent(job.id)}/manifest`);
  for (const entry of state.manifest?.entries ?? []) {
    const path = safePath(String(entry.path));
    const object = await request(`/api/private-runner/jobs/${encodeURIComponent(job.id)}/objects/${encodeURIComponent(String(entry.objectId))}`);
    const content = Buffer.from(String(object.contentBase64), "base64");
    const digest = sha256(content);
    if (digest !== entry.digest || digest !== object.digest) throw new Error(`source digest mismatch: ${path}`);
    const target = `${source}/${path}`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { mode: 0o444 });
  }
  return { jobRoot, source };
}

async function fetchSecrets(job: Job, check: Check): Promise<Record<string, string>> {
  if (!(check.secret_names ?? []).length) return {};
  const value = await request(`/api/private-runner/jobs/${encodeURIComponent(job.id)}/secrets`, {
    method: "POST",
    body: JSON.stringify({ names: check.secret_names }),
  });
  return value.secrets ?? {};
}

async function execute(job: Job, check: Check, source: string, secretValues: Record<string, string>): Promise<CommandResult> {
  const cleanRun = job.id.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 28);
  const cleanCheck = check.id.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 20);
  const container = `sessions-private-${cleanRun}-${cleanCheck}`;
  const network = check.network_policy === "egress" ? "bridge" : "none";
  const args = [
    "run", "--rm", "--name", container,
    "--network", network,
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", pids,
    "--memory", memory,
    "--cpus", cpus,
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
    "--mount", `type=bind,src=${source},dst=/workspace,readonly`,
    "--workdir", "/workspace",
  ];

  for (const [name, value] of Object.entries(secretValues)) args.push("--env", `${name}=${value}`);
  args.push(check.container_image, ...check.command_argv);

  let output: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let timedOut = false;
  const started = Date.now();
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { output = bounded(output, Buffer.from(chunk)); });
  child.stderr.on("data", (chunk) => { output = bounded(output, Buffer.from(chunk)); });

  const timeout = setTimeout(() => {
    timedOut = true;
    spawn("docker", ["rm", "-f", container], { stdio: "ignore" }).unref();
    child.kill("SIGKILL");
  }, Math.max(1, Number(check.timeout_seconds)) * 1000);

  const exitCode = await new Promise<number>((resolve) => {
    child.once("error", () => resolve(127));
    child.once("close", (code) => resolve(code ?? 1));
  });
  clearTimeout(timeout);

  const effectiveExitCode = timedOut ? 124 : exitCode;
  const raw = output.toString("utf8");
  return {
    conclusion: !timedOut && exitCode === 0 ? "success" : "failure",
    summary: timedOut ? "Timed out on private Sessions runner" : `Exited with code ${effectiveExitCode}`,
    exitCode: effectiveExitCode,
    log: redact(raw, secretValues),
    evidence: {
      privateExecution: true,
      durationMs: Date.now() - started,
      logDigest: sha256(output),
      logTruncated: output.length >= maxLogBytes,
      containerImage: check.container_image,
      command: check.command_argv,
      network,
      secretsRedacted: true,
      readOnlyRoot: true,
      capabilities: "none",
      memory,
      cpus,
      pids,
    },
  };
}

async function run(job: Job) {
  const { jobRoot, source } = await reconstruct(job);
  const results: any[] = [];
  let failed = false;
  const heartbeatMs = Math.max(5000, Math.floor(job.leaseSeconds * 1000 / 3));
  const heartbeat = setInterval(() => {
    void request(`/api/private-runner/jobs/${encodeURIComponent(job.id)}/heartbeat`, { method: "POST" })
      .catch((error) => console.error(JSON.stringify({ level: "error", event: "private-runner.heartbeat.failed", runId: job.id, message: String(error) })));
  }, heartbeatMs);

  try {
    for (const check of job.checks) {
      if (failed) {
        results.push({
          id: check.id,
          conclusion: "failure",
          summary: "Skipped after an earlier workflow step failed",
          exitCode: null,
          log: "",
          evidence: { privateExecution: true, skipped: true },
        });
        continue;
      }
      const values = await fetchSecrets(job, check);
      const result = await execute(job, check, source, values);
      results.push({ id: check.id, ...result });
      failed = result.conclusion !== "success";
    }

    await request(`/api/private-runner/jobs/${encodeURIComponent(job.id)}/complete`, {
      method: "POST",
      body: JSON.stringify({ checks: results }),
    });
    console.log(JSON.stringify({ level: "info", event: "private-runner.job.completed", runId: job.id, conclusion: failed ? "failure" : "success" }));
  } finally {
    clearInterval(heartbeat);
    await rm(jobRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  await mkdir(root, { recursive: true });
  console.log(JSON.stringify({ level: "info", event: "private-runner.agent.started", server, root, defaultNetwork: "none", memory, cpus, pids }));
  for (;;) {
    try {
      const claimed = await request("/api/private-runner/claim", { method: "POST" });
      if (claimed.job) await run(claimed.job as Job);
      else await new Promise((resolve) => setTimeout(resolve, pollMs));
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "private-runner.agent.error", message: error instanceof Error ? error.message : String(error) }));
      await new Promise((resolve) => setTimeout(resolve, Math.max(2000, pollMs)));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
