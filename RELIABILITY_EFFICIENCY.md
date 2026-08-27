# Reliability & Efficiency Standard

Sessions must become harder to break and cheaper to operate as it matures.

Reliability invariants: repository integrity, immutable provenance, replayable execution, crash recovery, safe merge/deploy behavior, tested backup/restore, tenant isolation, rollback, and verified recovery before state is promoted.

Efficiency invariants: incremental semantic analysis, deduplicated verification, reusable stable execution context, bounded agent work, avoidance of repeated failed work, and explicit compute/time accounting.

Primary economic metric: engineering time and failure cost recovered per compute dollar.

Every release must answer: what fails first under load; what happens when dependencies disappear; can state be corrupted or lost; can the system replay and explain what happened; can it restore known-good state; what work is repeated; what data movement is avoidable; what expensive intelligence can be replaced by cheaper logic; what is cost per useful outcome; and whether optimization reduces correctness or verification quality.

Release loop: input -> normal operation -> resource accounting -> failure injection -> recovery -> verification -> cost accounting -> adaptive improvement.
