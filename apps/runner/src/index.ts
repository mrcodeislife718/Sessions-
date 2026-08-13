import { Pool } from "pg";
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
    const result = await runRollbackOnce(pool);

    if (result.processed) {
      console.log(
        `Prepared rollback ${result.requestId} to ${result.snapshotId}`,
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, pollMs),
    );
  }
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
