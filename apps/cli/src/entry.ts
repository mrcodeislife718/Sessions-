#!/usr/bin/env node

import { handleNativeCommand } from "./native.js";

const help = `Sessions

Source control
  sessions init [name]
  sessions status
  sessions add <path...|.>
  sessions unstage <path...|.>
  sessions staged
  sessions diff [--staged|--unstaged]
  sessions checkpoint <name>
  sessions history
  sessions work <objective>
  sessions workstream list
  sessions workstream create <name> [objective]
  sessions switch <name-or-id>
  sessions integrate <workstream> [--apply]
  sessions restore <checkpoint> [--apply]
  sessions integrity

Execution + intelligence
  sessions start <objective>
  sessions record <EventType> [message]
  sessions verify <kind> <passed|failed|requires_review> <summary>
  sessions timeline
  sessions replay
  sessions recovery <checkpoint-id>
`;

const [, , command, ...args] = process.argv;
if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(help);
} else {
  const handled = await handleNativeCommand(command, args, process.cwd());
  if (!handled) await import("./index.js");
}
