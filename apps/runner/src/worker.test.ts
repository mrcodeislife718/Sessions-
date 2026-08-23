import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { Pool } from "pg";
import { runRollbackOnce } from "./worker.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "runner advances a planned rollback and records timeline evidence",
  {
    skip: databaseUrl
      ? false
      : "TEST_DATABASE_URL is not configured",
  },
  async () => {
    const pool = new Pool({
      connectionString: databaseUrl,
    });

    const suffix = crypto.randomUUID();

    const sessionId = `session_test_${suffix}`;
    const snapshotId = `snapshot_test_${suffix}`;
    const rollbackId = `rollback_test_${suffix}`;

    try {
      await pool.query(
        `insert into sessions
         (id, workspace_id, project_id, repository_id, objective, status)
         values ($1,$2,$3,$4,$5,'active')`,
        [
          sessionId,
          "workspace_test",
          "project_test",
          "repository_test",
          "Runner integration validation",
        ],
      );

      await pool.query(
        `insert into snapshots
         (id, session_id, repository_id, digest, manifest, created_at)
         values ($1,$2,$3,$4,$5,now())`,
        [
          snapshotId,
          sessionId,
          "repository_test",
          `digest_${suffix}`,
          JSON.stringify({
            id: snapshotId,
            entries: [],
          }),
        ],
      );

      await pool.query(
        `insert into rollback_requests
         (id, session_id, snapshot_id, status, requested_by)
         values ($1,$2,$3,'planned',$4)`,
        [
          rollbackId,
          sessionId,
          snapshotId,
          JSON.stringify({
            id: "integration_test",
            kind: "service",
          }),
        ],
      );

      const result = await runRollbackOnce(pool);

      assert.equal(result.processed, true);
      assert.equal(result.requestId, rollbackId);
      assert.equal(result.sessionId, sessionId);
      assert.equal(result.snapshotId, snapshotId);
      assert.equal(result.status, "ready_for_execution");

      const rollback = await pool.query(
        `select status, completed_at
         from rollback_requests
         where id = $1`,
        [rollbackId],
      );

      assert.equal(
        rollback.rows[0]?.status,
        "ready_for_execution",
      );

      assert.ok(
        rollback.rows[0]?.completed_at,
      );

      const event = await pool.query(
        `select type, actor, payload
         from session_events
         where session_id = $1
           and type = 'RollbackTriggered'`,
        [sessionId],
      );

      assert.equal(event.rowCount, 1);
      assert.equal(
        event.rows[0]?.type,
        "RollbackTriggered",
      );

      assert.equal(
        event.rows[0]?.actor?.id,
        "sessions_runner",
      );

      assert.equal(
        event.rows[0]?.payload?.rollbackRequestId,
        rollbackId,
      );

      assert.equal(
        event.rows[0]?.payload?.snapshotId,
        snapshotId,
      );
    } finally {
      await pool.query(
        "delete from sessions where id = $1",
        [sessionId],
      );

      await pool.end();
    }
  },
);
