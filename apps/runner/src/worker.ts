import crypto from "node:crypto";
import type { Pool } from "pg";

export interface RollbackRunResult {
  processed: boolean;
  requestId?: string;
  sessionId?: string;
  snapshotId?: string;
  status?: "ready_for_execution";
}

export async function runRollbackOnce(
  pool: Pool,
): Promise<RollbackRunResult> {
  const client = await pool.connect();

  try {
    await client.query("begin");

    const result = await client.query(
      `select *
       from rollback_requests
       where status = 'planned'
       order by created_at
       for update skip locked
       limit 1`,
    );

    if (!result.rowCount) {
      await client.query("commit");
      return { processed: false };
    }

    const request = result.rows[0];

    await client.query(
      "update rollback_requests set status = 'running' where id = $1",
      [request.id],
    );

    await client.query(
      `insert into session_events
       (id, session_id, type, occurred_at, actor, payload)
       values ($1,$2,'RollbackTriggered',now(),$3,$4)`,
      [
        `event_runner_${crypto.randomUUID()}`,
        request.session_id,
        JSON.stringify({
          id: "sessions_runner",
          kind: "service",
          displayName: "Sessions Runner",
        }),
        JSON.stringify({
          rollbackRequestId: request.id,
          snapshotId: request.snapshot_id,
        }),
      ],
    );

    // V1 stops at a verified rollback plan.
    // Physical repository mutation is added only after sandboxing,
    // workspace mounts, and permission boundaries are enforced.
    await client.query(
      `update rollback_requests
       set status = 'ready_for_execution',
           completed_at = now()
       where id = $1`,
      [request.id],
    );

    await client.query("commit");

    return {
      processed: true,
      requestId: request.id,
      sessionId: request.session_id,
      snapshotId: request.snapshot_id,
      status: "ready_for_execution",
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
