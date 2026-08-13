# Sessions Product Surfaces

Sessions is one platform with many interfaces into the same execution graph, identity model, event model, and authorization system.

## Product rule

**One backend. One event model. One identity model. Many surfaces.**

A Session may begin in VS Code, continue through an AI system using the API, be reviewed in the web app, require approval from mobile, and be recovered from the desktop app. It remains one Session with one lineage.

## Surface responsibilities

### VS Code extension
Primary in-workflow developer surface.

- detect Sessions-enabled repositories
- start and stop Sessions
- show human, AI-system, and AI-agent participants
- surface changed systems and files
- display verification status and failures
- create checkpoints
- replay execution history
- show risk and approval requirements
- initiate safe rollback flows
- avoid forcing developers to leave the editor for routine operations

### Web app
Full workspace and organizational control plane.

- repositories and projects
- Session timelines
- verification evidence
- engineering memory
- teams and RBAC
- deployments
- governance and approvals
- analytics and observability
- account and billing administration

### CLI
Fast local and automation interface.

Canonical commands include:

```text
sessions init
sessions import
sessions start
sessions checkpoint
sessions verify
sessions timeline
sessions replay
sessions rollback
sessions deploy
sessions memory
sessions agents
```

### Desktop app
Local-first power-user surface.

- repository management
- local runners
- local and offline execution history
- filesystem and OS integration
- multi-repository workflows
- desktop notifications
- recovery and rollback tooling

### Mobile app
Operational awareness and approval surface, not a mobile IDE.

- Session status
- approval requests
- failed verification alerts
- deployment health
- rollback authorization
- concise "what happened?" summaries
- incident and escalation notifications

### API / SDK / MCP
Machine-facing integration surface for AI systems, AI agents, developer tools, and automation.

- create and operate Sessions
- emit execution events
- register actors
- create checkpoints
- submit verification evidence
- query timelines
- inspect state
- request replay plans
- participate in governed execution workflows

## Priority

1. VS Code + CLI + Web
2. Desktop
3. Mobile

Desktop and mobile must share the same platform contracts instead of implementing independent business logic.

## Developer-experience requirement

Every surface must reduce friction. Sessions should follow the developer into the tools they already use rather than demanding that they constantly switch context to a separate dashboard.
