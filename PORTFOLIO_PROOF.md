# Sessions — Portfolio Proof Contract

**Track:** Commercial AI infrastructure

Sessions is complete only when persistent engineering/agent execution is implemented, tested under failure, benchmarked, deployable, used in real workflows, and commercially validated where sold.

## Required gates

- Implementation: prove persistent state, continuation, evidence/history, recovery, and coordination with runnable scenarios.
- Tests: correctness, persistence, concurrency, replay, migration, and regression coverage.
- Failure testing: interrupted writes, process death, stale/conflicting state, corrupted records, dependency loss, network failure, partial execution, and recovery.
- Benchmark: baseline against stateless/manual continuation; measure recovery time, context reconstruction, storage/latency overhead, success rate, and long-run reliability.
- Proof: every README claim links to a test, benchmark, artifact, or production result.
- Security: tenant isolation, authorization, secrets, provenance integrity, tamper evidence, retention/deletion, and backup/restore.
- Deployment: repeatable production deploy, health checks, telemetry, backups, migrations, rollback, and disaster recovery.
- Users: real engineering/agent workflows with completion and continuation metrics.
- Revenue: paid conversion, retention, expansion, support burden, and repeatable acquisition when commercialized.
- Documentation: setup, architecture, operations, limitations, failure modes, evidence, and runbooks.

## Evidence rule

No claim may be marked proven without an exact artifact or reproducible command. Synthetic demonstrations are not user validation. A passing command is not deployment proof. A deployment is not commercial validation.

## Next proof target

Run a long-lived multi-session engineering workflow, deliberately interrupt it at multiple stages, restore it from persisted state, and compare completion/recovery against the same workflow without Sessions. Preserve raw logs and benchmark results.
