import http from "node:http";
import {
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Pool, type PoolClient } from "pg";

const port = Number(process.env.PRIVATE_RUNNER_PORT ?? 4600);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://sessions:sessions@localhost:5432/sessions";
const maxBody = Number(process.env.SESSIONS_MAX_BODY_BYTES ?? 1_048_576);
const leaseSeconds = Number(
  process.env.SESSIONS_PRIVATE_RUNNER_LEASE_SECONDS ?? 120,
);
const maxLogBytes = Number(
  process.env.SESSIONS_ACTION_LOG_BYTES ?? 2 * 1024 * 1024,
);
const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.SESSIONS_PRIVATE_RUNNER_DB_POOL_MAX ?? 10),
});

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Identity = {
  workspaceId: string;
  principalId: string;
  scopes: string[];
};

type Runner = {
  id: string;
  workspace_id: string;
  labels: string[];
  max_concurrency: number;
  status: string;
};

function send(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function jsonBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBody) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

async function apiIdentity(req: http.IncomingMessage): Promise<Identity> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    throw new HttpError(401, "bearer token required");
  }
  const result = await pool.query(
    `select c.workspace_id,c.principal_id,c.scopes
       from api_credentials c
       join principals p on p.id=c.principal_id
      where c.token_hash=$1
        and c.status='active'
        and p.status='active'
        and (c.expires_at is null or c.expires_at>now())`,
    [sha256(auth.slice(7).trim())],
  );
  if (!result.rows.length) throw new HttpError(401, "invalid or expired credential");
  return {
    workspaceId: result.rows[0].workspace_id,
    principalId: result.rows[0].principal_id,
    scopes: result.rows[0].scopes ?? [],
  };
}

function requireScope(identity: Identity, needed: string) {
  if (
    !identity.scopes.includes("*") &&
    !identity.scopes.includes(needed) &&
    !identity.scopes.includes("sessions:write")
  ) {
    throw new HttpError(403, `missing scope: ${needed}`);
  }
}

async function requireEnterpriseAdmin(identity: Identity) {
  const result = await pool.query(
    `select m.role,p.kind,e.plan_key,e.status entitlement_status
       from workspace_memberships m
       join principals p on p.id=m.principal_id
       left join workspace_entitlements e on e.workspace_id=m.workspace_id
      where m.workspace_id=$1 and m.principal_id=$2`,
    [identity.workspaceId, identity.principalId],
  );
  const row = result.rows[0];
  if (!row || row.kind !== "human" || !["owner", "admin"].includes(row.role)) {
    throw new HttpError(
      403,
      "private runner administration requires a human workspace owner or admin",
    );
  }
  if (row.entitlement_status !== "active" || row.plan_key !== "enterprise") {
    throw new HttpError(402, "private runners require an active Enterprise entitlement");
  }
}

async function runnerIdentity(req: http.IncomingMessage): Promise<Runner> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Runner ")) {
    throw new HttpError(401, "runner token required");
  }
  const result = await pool.query(
    `update private_runners
        set last_seen_at=now(),updated_at=now()
      where token_hash=$1 and status='active'
      returning id,workspace_id,labels,max_concurrency,status`,
    [sha256(auth.slice(7).trim())],
  );
  if (!result.rows.length) throw new HttpError(401, "invalid or inactive runner token");
  return result.rows[0] as Runner;
}

function validateLabels(value: unknown) {
  if (!Array.isArray(value) || value.length > 50) {
    throw new HttpError(400, "labels must be an array of at most 50 values");
  }
  const labels = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (labels.some((item) => !/^[A-Za-z0-9_.:-]{1,64}$/.test(item))) {
    throw new HttpError(400, "runner labels contain an invalid value");
  }
  return labels;
}

function actionKey() {
  const raw = process.env.SESSIONS_ACTION_SECRET_KEY;
  if (!raw) throw new HttpError(503, "Actions secret encryption key is not configured");
  const key = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new HttpError(503, "Actions secret encryption key must decode to 32 bytes");
  }
  return key;
}

function decryptSecret(row: {
  nonce: string;
  auth_tag: string;
  ciphertext: string;
}) {
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

async function audit(
  workspaceId: string,
  principalId: string | null,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
) {
  await pool.query(
    `insert into audit_events(
       id,workspace_id,principal_id,action,resource_type,resource_id,outcome,metadata
     ) values($1,$2,$3,$4,'private_runner',$5,'allowed',$6)`,
    [
      `audit_${randomUUID()}`,
      workspaceId,
      principalId,
      action,
      resourceId,
      JSON.stringify(metadata),
    ],
  );
}

async function assignedRun(runner: Runner, runId: string) {
  const result = await pool.query(
    `select * from action_runs
      where id=$1 and workspace_id=$2 and assigned_private_runner_id=$3
        and status='running' and runner_lease_expires_at>now()`,
    [runId, runner.workspace_id, runner.id],
  );
  if (!result.rows.length) {
    throw new HttpError(409, "job is not actively leased to this runner");
  }
  return result.rows[0];
}

async function claimRun(runner: Runner) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update action_runs
          set status='queued',assigned_private_runner_id=null,
              runner_lease_expires_at=null,started_at=null
        where workspace_id=$1 and execution_target in ('private','either')
          and status='running' and assigned_private_runner_id is not null
          and runner_lease_expires_at<=now()`,
      [runner.workspace_id],
    );
    const active = await client.query(
      `select count(*)::int n from action_runs
        where assigned_private_runner_id=$1 and status='running'
          and runner_lease_expires_at>now()`,
      [runner.id],
    );
    if (Number(active.rows[0]?.n ?? 0) >= runner.max_concurrency) {
      await client.query("rollback");
      return null;
    }
    const result = await client.query(
      `select id,repository_id,commit_id,workspace_id,workflow_id,workflow_name,runner_labels
         from action_runs
        where workspace_id=$1 and execution_target in ('private','either')
          and status='queued' and $2::text[] @> runner_labels
        order by created_at
        for update skip locked
        limit 1`,
      [runner.workspace_id, runner.labels ?? []],
    );
    if (!result.rows.length) {
      await client.query("rollback");
      return null;
    }
    const run = result.rows[0];
    await client.query(
      `update action_runs
          set status='running',assigned_private_runner_id=$2,
              runner_lease_expires_at=now()+($3::text||' seconds')::interval,
              started_at=coalesce(started_at,now())
        where id=$1`,
      [run.id, runner.id, leaseSeconds],
    );
    const checks = await client.query(
      `select id,name,category,container_image,command_argv,timeout_seconds,
              network_policy,secret_names
         from action_checks where action_run_id=$1 order by id`,
      [run.id],
    );
    await client.query("commit");
    await audit(runner.workspace_id, null, "private_runner.job_claim", runner.id, {
      runId: run.id,
      repositoryId: run.repository_id,
    });
    return { ...run, leaseSeconds, checks: checks.rows };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function jobManifest(runner: Runner, runId: string) {
  const run = await assignedRun(runner, runId);
  const checkpoint = await pool.query(
    `select record from sessions_repository_checkpoints
      where repository_id=$1 and checkpoint_id=$2`,
    [run.repository_id, run.commit_id],
  );
  const record = checkpoint.rows[0]?.record;
  if (!record?.sourceManifestId) {
    throw new HttpError(409, "job checkpoint has no source manifest");
  }
  const result = await pool.query(
    `select manifest from repository_manifests
      where repository_id=$1 and id=$2`,
    [run.repository_id, record.sourceManifestId],
  );
  const manifest = result.rows[0]?.manifest;
  if (!manifest) throw new HttpError(409, "job source manifest is missing");
  return {
    repositoryId: run.repository_id,
    commitId: run.commit_id,
    sourceDigest: record.sourceDigest,
    manifest,
  };
}

async function jobObject(runner: Runner, runId: string, objectId: string) {
  const run = await assignedRun(runner, runId);
  const result = await pool.query(
    `select object_id,digest,content from sessions_repository_objects
      where repository_id=$1 and object_id=$2`,
    [run.repository_id, objectId],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "source object not found");
  const content = Buffer.from(row.content);
  if (sha256(content) !== row.digest) {
    throw new HttpError(500, "stored source object failed digest verification");
  }
  return {
    objectId: row.object_id,
    digest: row.digest,
    size: content.length,
    contentBase64: content.toString("base64"),
  };
}

async function jobSecrets(runner: Runner, runId: string, names: unknown) {
  const run = await assignedRun(runner, runId);
  const requested = validateLabels(names);
  const checks = await pool.query(
    "select secret_names from action_checks where action_run_id=$1",
    [runId],
  );
  const allowed = new Set<string>();
  for (const row of checks.rows) {
    for (const name of row.secret_names ?? []) allowed.add(String(name));
  }
  if (requested.some((name) => !allowed.has(name))) {
    throw new HttpError(403, "job requested a secret not declared by its workflow");
  }
  if (!requested.length) return {};
  const result = await pool.query(
    `select name,ciphertext,nonce,auth_tag
       from repository_action_secrets
      where workspace_id=$1 and repository_id=$2 and name=any($3::text[])`,
    [runner.workspace_id, run.repository_id, requested],
  );
  if (result.rows.length !== requested.length) {
    throw new HttpError(409, "one or more required workflow secrets are missing");
  }
  return Object.fromEntries(
    result.rows.map((row) => [row.name, decryptSecret(row)]),
  );
}

async function completeRun(runner: Runner, runId: string, payload: any) {
  await assignedRun(runner, runId);
  const results = Array.isArray(payload.checks) ? payload.checks : [];
  const expected = (
    await pool.query("select id from action_checks where action_run_id=$1", [runId])
  ).rows.map((row) => String(row.id));
  if (
    results.length !== expected.length ||
    results.some((row: any) => !expected.includes(String(row.id)))
  ) {
    throw new HttpError(
      400,
      "completion must provide exactly one result for every job check",
    );
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    let failed = false;
    for (const row of results) {
      const conclusion = String(row.conclusion) === "success" ? "success" : "failure";
      failed ||= conclusion !== "success";
      const log = String(row.log ?? "");
      if (Buffer.byteLength(log) > maxLogBytes) {
        throw new HttpError(413, "private runner log exceeds configured limit");
      }
      await client.query(
        `update action_checks
            set status='completed',conclusion=$2,summary=$3,evidence=$4,
                log_text=$5,exit_code=$6,started_at=coalesce(started_at,now()),
                completed_at=now()
          where id=$1 and action_run_id=$7`,
        [
          row.id,
          conclusion,
          String(row.summary ?? "Private runner execution").slice(0, 1000),
          JSON.stringify({ ...(row.evidence ?? {}), privateRunnerId: runner.id }),
          log,
          Number.isInteger(row.exitCode) ? row.exitCode : null,
          runId,
        ],
      );
    }
    await client.query(
      `update action_runs
          set status='completed',conclusion=$2,completed_at=now(),
              runner_lease_expires_at=null
        where id=$1 and assigned_private_runner_id=$3`,
      [runId, failed ? "failure" : "success", runner.id],
    );
    await client.query("commit");
    await audit(
      runner.workspace_id,
      null,
      "private_runner.job_complete",
      runner.id,
      { runId, conclusion: failed ? "failure" : "success" },
    );
    return {
      runId,
      status: "completed",
      conclusion: failed ? "failure" : "success",
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function handleRunnerRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
) {
  const runner = await runnerIdentity(req);
  if (req.method === "POST" && url.pathname === "/api/private-runner/claim") {
    return send(res, 200, { job: await claimRun(runner) });
  }
  let match = url.pathname.match(
    /^\/api\/private-runner\/jobs\/([^/]+)\/heartbeat$/,
  );
  if (match && req.method === "POST") {
    await assignedRun(runner, match[1]);
    await pool.query(
      `update action_runs
          set runner_lease_expires_at=now()+($2::text||' seconds')::interval
        where id=$1 and assigned_private_runner_id=$3`,
      [match[1], leaseSeconds, runner.id],
    );
    return send(res, 200, { runId: match[1], leaseSeconds });
  }
  match = url.pathname.match(/^\/api\/private-runner\/jobs\/([^/]+)\/manifest$/);
  if (match && req.method === "GET") {
    return send(res, 200, await jobManifest(runner, match[1]));
  }
  match = url.pathname.match(
    /^\/api\/private-runner\/jobs\/([^/]+)\/objects\/([^/]+)$/,
  );
  if (match && req.method === "GET") {
    return send(
      res,
      200,
      await jobObject(runner, match[1], decodeURIComponent(match[2])),
    );
  }
  match = url.pathname.match(/^\/api\/private-runner\/jobs\/([^/]+)\/secrets$/);
  if (match && req.method === "POST") {
    const payload = await jsonBody(req);
    return send(res, 200, {
      secrets: await jobSecrets(runner, match[1], payload.names),
    });
  }
  match = url.pathname.match(/^\/api\/private-runner\/jobs\/([^/]+)\/complete$/);
  if (match && req.method === "POST") {
    return send(res, 200, await completeRun(runner, match[1], await jsonBody(req)));
  }
  throw new HttpError(404, "not found");
}

async function handleAdminRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
) {
  const identity = await apiIdentity(req);
  requireScope(identity, req.method === "GET" ? "sessions:read" : "sessions:write");
  await requireEnterpriseAdmin(identity);

  if (url.pathname === "/api/private-runners") {
    if (req.method === "GET") {
      const result = await pool.query(
        `select id,name,labels,max_concurrency,status,last_seen_at,created_at,updated_at
           from private_runners where workspace_id=$1 order by name`,
        [identity.workspaceId],
      );
      return send(res, 200, result.rows);
    }
    if (req.method === "POST") {
      const payload = await jsonBody(req);
      const name = String(payload.name ?? "").trim();
      if (!/^[A-Za-z0-9_. -]{1,120}$/.test(name)) {
        throw new HttpError(400, "valid runner name is required");
      }
      const runnerLabels = validateLabels(payload.labels ?? []);
      const maxConcurrency = Number(payload.maxConcurrency ?? 1);
      if (
        !Number.isInteger(maxConcurrency) ||
        maxConcurrency < 1 ||
        maxConcurrency > 64
      ) {
        throw new HttpError(400, "maxConcurrency must be 1-64");
      }
      const token = `runner_${randomBytes(32).toString("hex")}`;
      const result = await pool.query(
        `insert into private_runners(
           workspace_id,name,token_hash,labels,max_concurrency,created_by
         ) values($1,$2,$3,$4,$5,$6)
         returning id,name,labels,max_concurrency,status,created_at`,
        [
          identity.workspaceId,
          name,
          sha256(token),
          runnerLabels,
          maxConcurrency,
          identity.principalId,
        ],
      );
      const runner = result.rows[0];
      await audit(
        identity.workspaceId,
        identity.principalId,
        "private_runner.register",
        runner.id,
        { name, labels: runnerLabels, maxConcurrency },
      );
      return send(res, 201, { ...runner, token });
    }
  }

  let match = url.pathname.match(
    /^\/api\/private-runners\/([^/]+)\/(disable|revoke|enable)$/,
  );
  if (match && req.method === "POST") {
    const status =
      match[2] === "revoke" ? "revoked" : match[2] === "disable" ? "disabled" : "active";
    const result = await pool.query(
      `update private_runners set status=$3,updated_at=now()
        where id=$1 and workspace_id=$2 and status<>'revoked'
        returning id,name,status`,
      [match[1], identity.workspaceId, status],
    );
    if (!result.rows.length) {
      throw new HttpError(404, "runner not found or permanently revoked");
    }
    await audit(
      identity.workspaceId,
      identity.principalId,
      `private_runner.${match[2]}`,
      match[1],
    );
    return send(res, 200, result.rows[0]);
  }

  match = url.pathname.match(/^\/api\/repositories\/([^/]+)\/runner-policy$/);
  if (match) {
    const repositoryId = decodeURIComponent(match[1]);
    const repository = await pool.query(
      "select lifecycle_status from hosted_repositories where id=$1 and workspace_id=$2",
      [repositoryId, identity.workspaceId],
    );
    if (!repository.rows.length) throw new HttpError(404, "repository not found");
    if (req.method === "GET") {
      const result = await pool.query(
        `select * from repository_runner_policies
          where repository_id=$1 and workspace_id=$2`,
        [repositoryId, identity.workspaceId],
      );
      return send(
        res,
        200,
        result.rows[0] ?? {
          repositoryId,
          executionTarget: "hosted",
          requiredLabels: [],
        },
      );
    }
    if (req.method === "PUT") {
      if (repository.rows[0].lifecycle_status !== "active") {
        throw new HttpError(409, "repository is read-only");
      }
      const payload = await jsonBody(req);
      const target = String(payload.executionTarget ?? "hosted");
      if (!["hosted", "private", "either"].includes(target)) {
        throw new HttpError(400, "executionTarget must be hosted, private, or either");
      }
      const requiredLabels = validateLabels(payload.requiredLabels ?? []);
      const result = await pool.query(
        `insert into repository_runner_policies(
           workspace_id,repository_id,execution_target,required_labels,created_by
         ) values($1,$2,$3,$4,$5)
         on conflict(repository_id) do update
           set execution_target=excluded.execution_target,
               required_labels=excluded.required_labels,updated_at=now()
         returning *`,
        [
          identity.workspaceId,
          repositoryId,
          target,
          requiredLabels,
          identity.principalId,
        ],
      );
      await audit(
        identity.workspaceId,
        identity.principalId,
        "private_runner.policy_update",
        repositoryId,
        { executionTarget: target, requiredLabels },
      );
      return send(res, 200, result.rows[0]);
    }
  }

  throw new HttpError(404, "not found");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      await pool.query("select 1");
      return send(res, 200, { ok: true, service: "sessions-private-runners" });
    }
    if (url.pathname.startsWith("/api/private-runner/")) {
      return await handleRunnerRequest(req, res, url);
    }
    return await handleAdminRequest(req, res, url);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "internal error";
    console.error(
      JSON.stringify({ level: "error", service: "sessions-private-runners", status, message }),
    );
    return send(res, status, { error: status >= 500 ? "internal error" : message });
  }
});

server.listen(port, "0.0.0.0", () =>
  console.log(
    JSON.stringify({ level: "info", event: "private-runners.started", port, leaseSeconds }),
  ),
);

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
