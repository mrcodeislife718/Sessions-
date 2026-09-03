# Sessions Capability Ledger

This ledger records the capabilities present in canonical `main` after remote branch reconciliation. It distinguishes repository implementation/qualification from external deployment and customer proof.

Status vocabulary: **SPECIFIED**, **IMPLEMENTED**, **INTEGRATED**, **TESTED**, **QUALIFIED**, **PRODUCTION-READY**, **EXTERNALLY-BLOCKED**, **DEPRECATED**, **SUPERSEDED**.

## Canonical capability matrix

| Capability | Canonical owner / module | Status | Evidence / qualification | Economic relevance | Remaining boundary |
|---|---|---|---|---|---|
| Native repository engine | `packages/native-repository`, repository API/runtime | QUALIFIED | native collaboration + CI | core source-control product | external large-scale adoption/performance proof remains separate |
| Repositories, branches, commits/changes and hosted repository state | repository packages, `apps/api/src/repositories.ts`, `repository-server.ts`, Postgres repository migrations | QUALIFIED | CI, native collaboration, launch qualification | Git/GitHub-layer product core | comparative superiority requires measured evidence |
| Collaboration and pull-request/merge semantics | `apps/api/src/collaboration.ts`, native merge, repository collaboration schema/UI | QUALIFIED | native collaboration workflow | team/organization retention | external multi-team acceptance remains commercial proof |
| Issues and forge collaboration objects | `apps/api/src/issues.ts`, web/product surfaces | INTEGRATED | canonical build/typecheck/CI | forge completeness | broad ecosystem/network-effect proof external |
| Human/AI execution lineage | execution-lineage API/tests, causal persistence, lineage schema/workflow | QUALIFIED | execution-lineage CI + general CI | differentiated AI-native source-control value | comparative lineage advantage requires external measurement |
| Causal/reasoning artifacts and graph | causal persistence, reasoning artifacts/graph, timeline/memory/semantic packages | QUALIFIED | reasoning tests + CI | engineering continuity and explainability | customer value proof external |
| Human/AI provenance | canonical actor/lineage structures across repository and execution paths | INTEGRATED | lineage/collaboration qualification | auditability and enterprise governance | full external identity federation is integration dependent |
| Native merge/conflict handling | `apps/api/src/native-merge.ts`, native repository package | QUALIFIED | native repository tests/CI | source-control reliability | benchmark parity/superiority vs Git/Jujutsu remains evidence work |
| Verification engine/evidence-bound engineering state | `packages/verification-engine` and API/workflow integration | QUALIFIED | build/typecheck/CI | safer releases and AI-authored changes | external proof of reduced failures remains commercial/benchmark evidence |
| Authentication and hosted workspace authority | `apps/api/src/auth-server.ts`, hosted-auth migrations | QUALIFIED | CI + launch qualification | paid team/enterprise operation | real production identity configuration required |
| Billing and entitlements | `apps/api/src/billing-server.ts`, commercial-core, billing migrations | QUALIFIED | commercial qualification + CI | subscription/usage revenue | real Stripe account/live-mode proof external |
| Authoritative Stripe entitlement sequence | billing server + qualification | QUALIFIED | corrected Checkout→subscription/invoice sequence; CI/commercial qualification green | prevents unpaid access/false revenue | live provider qualification external |
| API credentials and commercial usage state | billing/commercial schema/runtime | QUALIFIED | launch/commercial qualification | API/enterprise monetization | measured usage economics external |
| Workflow/runner execution | `apps/runner`, workflow server/executor | QUALIFIED | runner tests + launch/CI | automation/Actions-like value | production fleet operations external |
| Deployment/release lifecycle | production compose, deployment/release UI/API, scripts | QUALIFIED | launch qualification | complete forge lifecycle | live deployment and customer acceptance explicitly external |
| Backup/restore/rollback/recovery | production scripts + Postgres qualification + repository operation/recovery architecture | QUALIFIED | launch Postgres recovery workflow | enterprise reliability | disaster-recovery evidence in target production environment external |
| Observability | `apps/api/src/observability.ts`, production topology/SLO scripts | QUALIFIED | launch/CI | operator trust and enterprise readiness | real production telemetry/SLO history external |
| Web product surface | `apps/web` | QUALIFIED | canonical build + launch contract | primary hosted user experience | external usability/customer adoption proof |
| CLI | `apps/cli` | QUALIFIED | canonical build/typecheck | developer distribution | ecosystem adoption external |
| SDK | `apps/sdk` / `@sessions/sdk` | QUALIFIED | canonical build/typecheck | developer/enterprise integration | ecosystem adoption external |
| MCP integration | `apps/mcp` | QUALIFIED | canonical build/typecheck | AI tool integration/distribution | external tool ecosystem proof |
| VS Code integration | Sessions VS Code package | QUALIFIED | canonical build/typecheck | adoption bridge | marketplace/user proof external |
| Desktop product | desktop package | QUALIFIED | canonical build/typecheck | local/native user surface | packaged distribution proof external |
| Mobile surface | mobile package | TESTED | canonical typecheck | secondary access/ops surface | production distribution external |
| Git compatibility/adoption architecture | native repository + technical-superiority architecture | IMPLEMENTED / SPECIFIED BY SUBCAPABILITY | repository tests + architecture record | lowers migration friction | complete representative Git round-trip benchmark remains evidence gate |
| Launch qualification contract | `.github/workflows/launch-qualification.yml`, `scripts/qualify-launch.mjs` | QUALIFIED | post-reconciliation launch workflow green | prevents false launch claims | live deployment, real Stripe, external-user acceptance, real payment/retention explicitly external |
| Portfolio proof discipline | `PORTFOLIO_PROOF.md`, Portfolio Proof workflow | QUALIFIED | post-reconciliation gate green | buyer diligence / claim discipline | superiority claims remain evidence-dependent |
| Economic model | `ECONOMIC_ROLE.md`, commercial-core/billing/economic-production modules | INTEGRATED | commercial qualification | individual/team/enterprise/API economics | willingness-to-pay, retention and expansion are market evidence, not repo evidence |

## Product boundary

Sessions is a source-control, collaboration, execution, verification, recovery and deployment platform for humans and AI systems. Execution lineage and persistent engineering context are differentiators inside that product; they are not a replacement for repository/forge functionality.

Sessions must not be reduced to a chat-memory layer, coding assistant, or repository plugin.

## External proof that remains explicit

Canonical launch qualification intentionally does not convert the following into CI claims:

- live production deployment against real secrets/domains;
- real Stripe test/live-mode account qualification;
- external-user onboarding and collaboration acceptance;
- real customer payment and retention evidence;
- measured comparative superiority against Git/GitHub/Jujutsu/GitLab where claimed.

## Branch provenance

See [`BRANCH_RECONCILIATION.md`](BRANCH_RECONCILIATION.md) for the permanent mapping of all observed remote branches and the superseded PR #10 into canonical `main`.