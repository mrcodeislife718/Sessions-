# Sessions source-control parity

Sessions owns its repository model: Workstreams, Checkpoints, content-addressed objects, integrity verification, tags and remotes. Git is an import boundary, not the internal storage engine.

## Implemented surfaces

- Native repository: status, stage/unstage, diff, checkpoint, workstream, switch/checkout, integrate, restore, integrity, clone, Git import, tags, remotes, fetch, pull, push and revert.
- CLI: native repository commands including transport/migration operations.
- SDK: hosted Sessions plus collaboration APIs for issues, pull requests, reviews, Actions, releases and deployments.
- MCP: Sessions execution and collaboration tools.
- VS Code: status, checkpoint, history, pull, push and integrity commands.
- Web client: typed source-control command transport for repository UI integration.

## Qualification gates

A source-control release is not production-qualified until CI passes build/typecheck/tests on Node 22 and 24 and E2E covers initialize -> checkpoint -> clone -> branch/workstream -> integrate -> tag -> push/fetch/pull -> revert -> integrity plus Git migration fixtures. Destructive operations must reject dirty working trees unless explicitly protected.
