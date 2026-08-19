#!/usr/bin/env node

import { handleHostedCommand, loadHostedEnvironment } from "./hosted.js";
import { handleNativeCommand } from "./native.js";

const help = `Sessions

Source control
  sessions init [name]
  sessions status
  sessions add <path...|.>
  sessions unstage <path...|.>
  sessions staged
  sessions diff [--staged|--unstaged]
  sessions commit <message>
  sessions log
  sessions branch [name]
  sessions switch <name-or-id>
  sessions remote <list|add|set|remove>
  sessions push [remote]
  sessions fetch [remote]
  sessions pull [remote]
  sessions clone <Sessions-repository-URL> <destination>
  sessions tag <list|create|delete>
  sessions revert <commit>
  sessions restore <commit> [--apply]
  sessions integrity

Execution + intelligence
  sessions start <objective>
  sessions record <EventType> [message]
  sessions verify <kind> <passed|failed|requires_review> <summary>
  sessions timeline
  sessions replay
  sessions recovery <commit-id>

Hosted Sessions
  sessions login <https://host> <email>
  sessions logout
  sessions billing
  sessions upgrade [developer|team|business|enterprise]
  sessions export [file]
  sessions cancel

Legacy migration only
  sessions import [legacy-git-repository] [destination]

Compatibility
  sessions connect <https://host> [token]
  sessions disconnect
  workstream = branch
  checkpoint = commit
  history = log
`;

const [, , command, ...args] = process.argv;
await loadHostedEnvironment();
if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(help);
} else {
  const hosted = await handleHostedCommand(command, args);
  if (!hosted) {
    const handled = await handleNativeCommand(command, args, process.cwd());
    if (!handled) await import("./index.js");
  }
}
