# Sessions Product Surfaces

Sessions is one native development platform with many interfaces into the same repository model, execution graph, identity model, event model, authorization model, collaboration state, and recovery system.

## Product rule

**One platform. One repository model. One event model. One identity model. Many surfaces.**

A Workstream can begin on desktop, continue in VS Code, be advanced by an AI system through the API, reviewed in the web app, approved from mobile, and restored through the runner. It remains one Sessions-native development history.

## Web app

The full collaboration and development control center.

- repositories
- Workstreams
- Sessions
- Checkpoints
- history
- source differences
- Change Reviews
- Work Items
- verification
- activity and progress
- releases
- deployments
- recovery
- teams
- permissions
- identity
- search
- notifications
- audit
- billing and administration

## VS Code extension

Primary in-editor developer surface.

- detect Sessions repositories
- initialize repositories
- create and switch Workstreams
- start Sessions
- show human, AI-system, and AI-agent activity
- surface changed systems and files
- display progress and verification
- create Checkpoints
- inspect history
- review source and semantic changes
- replay execution history
- show risk and approval requirements
- initiate safe restore flows

Routine operations should not require leaving the editor.

## Desktop app

High-bandwidth local development workstation.

- repository management
- Workstream management
- source history
- local/offline operation
- local runners
- execution history
- multi-repository workflows
- filesystem and OS integration
- verification
- review
- synchronization
- releases
- recovery and restore

## Mobile app

Operational awareness, review, and approval surface.

- Workstream and Session status
- progress
- review requests
- approval requests
- verification failures
- release and deployment health
- recovery readiness
- restore authorization
- concise engineering summaries

Mobile is not intended to be a miniature IDE.

## CLI

Fast local and automation interface.

Canonical native command direction:

```text
sessions init
sessions status
sessions workstream create
sessions workstream switch
sessions checkpoint
sessions history
sessions diff
sessions verify
sessions review
sessions integrate
sessions publish
sessions sync
sessions timeline
sessions replay
sessions restore
sessions release
sessions deploy
```

## API / SDK / MCP

Machine-facing surface for AI systems, AI agents, developer tools, automation, and first-party Sessions clients.

- repositories
- Workstreams
- Sessions
- actors
- events
- Checkpoints
- diffs
- verification evidence
- reviews
- integration
- publication
- synchronization
- timelines
- replay
- recovery
- releases
- deployments
- permissions and governed execution

## Shared interaction language

Every product surface uses the same concepts:

- Repository
- Workstream
- Session
- Checkpoint
- Change Review
- Verify
- Integrate
- Publish
- Release
- Deploy
- Replay
- Restore

The interfaces may adapt to their environment, but the mental model must not change from surface to surface.

## Developer-experience requirement

Every surface must reduce friction and expose visible proof of progress. Sessions should automatically capture context it already knows and avoid asking developers to perform redundant bookkeeping.
