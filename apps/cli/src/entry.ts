#!/usr/bin/env node

import { handleNativeCommand } from "./native.js";

const [, , command, ...args] = process.argv;
const handled = await handleNativeCommand(command, args, process.cwd());
if (!handled) await import("./index.js");
