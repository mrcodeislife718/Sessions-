import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://sessions:sessions@localhost:5432/sessions";
const pollMs = Number(process.env.RUNNER_POLL_MS ?? 2000);
const pool = new Pool({ connectionString: databaseUrl });

async function tick() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      "select * from rollback_requests where status = 'planned' order by created_at for update skip locked limit 1",
    );
    if (!result.rowCount) {
      await client.query("commit");
      return;
    }
    const request = result.rows[0];
    await client.query("update rollback_requests set status = 'running' where id = $1", [request.id]);
    await client.query(
      "insert into session_events (id, session_id, type, occurred_at, actor, payload) values ($1,$2,'RollbackTriggered',now(),$3,$4)",
      [
        `event_runner_${Date.now()}`,
        request.session_id,
        JSON.stringify({ id: "sessions_runner", kind: "service", displayName: "Sessions Runner" }),
        JSON.stringify({ rollbackRequestId: request.id, snapshotId: request.snapshot_id }),
      ],
    );
    // V1 deliberately stops at a verified rollback plan. Repository mutation is added only
    // after runner sandboxing, workspace mounts, and permission boundaries are enforced.
    await client.query(
      "update rollback_requests set status = 'ready_for_execution', completed_at = now() where id = $1",
      [request.id],
    );
    await client.query("commit");
    console.log(`Prepared rollback ${request.id} to ${request.snapshot_id}`);
  } catch (error) {
    await client.query("rollback");
    console.error(error);
  } finally {
    client.release();
  }
}

async function main() {
  console.log("Sessions runner online");
  for (;;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
