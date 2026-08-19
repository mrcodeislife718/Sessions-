import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd());
const staging = resolve(root, ".sessions-build/cli");
const publicDir = resolve(root, "apps/web/public/downloads");
const artifact = resolve(publicDir, "sessions-cli.tgz");

await rm(staging, { recursive: true, force: true });
await mkdir(resolve(staging, "app/node_modules/@sessions/native-repository/dist"), { recursive: true });
await mkdir(resolve(staging, "bin"), { recursive: true });
await mkdir(publicDir, { recursive: true });

await cp(resolve(root, "apps/cli/dist"), resolve(staging, "app"), { recursive: true });
await cp(resolve(root, "packages/native-repository/dist"), resolve(staging, "app/node_modules/@sessions/native-repository/dist"), { recursive: true });
await writeFile(resolve(staging, "app/node_modules/@sessions/native-repository/package.json"), JSON.stringify({
  name: "@sessions/native-repository",
  version: "0.1.0",
  type: "module",
  main: "dist/index.js",
  exports: {
    ".": { default: "./dist/index.js" },
    "./transport": { default: "./dist/transport.js" }
  }
}, null, 2) + "\n");

const launcher = `#!/bin/sh\nset -eu\nROOT=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")/..\" && pwd)\"\nexec node \"$ROOT/app/entry.js\" \"$@\"\n`;
await writeFile(resolve(staging, "bin/sessions"), launcher);
await chmod(resolve(staging, "bin/sessions"), 0o755);

const installer = `#!/bin/sh\nset -eu\nPREFIX=\"${'${SESSIONS_INSTALL_DIR:-$HOME/.local/share/sessions}'}\"\nBIN=\"${'${SESSIONS_BIN_DIR:-$HOME/.local/bin}'}\"\nHERE=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\"\nmkdir -p \"$PREFIX\" \"$BIN\"\nrm -rf \"$PREFIX/current\"\ncp -R \"$HERE\" \"$PREFIX/current\"\nln -sf \"$PREFIX/current/bin/sessions\" \"$BIN/sessions\"\nprintf 'Sessions installed. Ensure %s is on PATH, then run: sessions login <https://host> <email>\\n' \"$BIN\"\n`;
await writeFile(resolve(staging, "install.sh"), installer);
await chmod(resolve(staging, "install.sh"), 0o755);

await writeFile(resolve(staging, "README.txt"), "Sessions CLI — first-party Sessions-native source control and engineering memory client.\nRequires Node.js 22 or newer.\nRun ./install.sh, then sessions login <https://host> <email>.\n");
await rm(artifact, { force: true });
await execFileAsync("tar", ["-czf", artifact, "-C", staging, "."]);
console.log(artifact);
