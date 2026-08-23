import { Pool } from "pg";
import { runActionOnce } from "./actions.js";
import { runRollbackOnce } from "./worker.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://sessions:sessions@localhost:5432/sessions";

const pollMs = Number(process.env.RUNNER_POLL_MS ?? 2000);

const pool = new Pool({
  connectionString: databaseUrl,
});

async function main() {
  console.log("Sessions runner online");

  for (;;) {
    let processed = false;

    const action = await runActionOnce(pool);
    if (action.processed) {
      processed = true;
      console.log(
        `Sessions Action ${action.runId} ${action.conclusion} for ${action.repositoryId ?? "unknown repository"}${action.commitId ? ` @ ${action.commitId}` : ""}`,
      );
    }

    const rollback = await runRollbackOnce(pool);
    if (rollback.processed) {
      processed = true;
      console.log(
        `Prepared rollback ${rollback.requestId} to ${rollback.snapshotId}`,
      );
    }

    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
