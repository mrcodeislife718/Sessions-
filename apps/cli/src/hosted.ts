import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type HostedConfig = { apiUrl: string; token: string };

function configPath() {
  const base = process.env.XDG_CONFIG_HOME || (process.platform === "win32" ? process.env.APPDATA : undefined) || join(homedir(), ".config");
  return join(base, "sessions", "hosted.json");
}

export async function loadHostedEnvironment() {
  if (process.env.SESSIONS_API_URL && process.env.SESSIONS_API_TOKEN) return;
  try {
    const config = JSON.parse(await readFile(configPath(), "utf8")) as HostedConfig;
    process.env.SESSIONS_API_URL ||= config.apiUrl;
    process.env.SESSIONS_API_TOKEN ||= config.token;
  } catch { /* explicit environment variables and local mode remain valid */ }
}

async function saveHostedConfig(apiUrl: string, token: string) {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ apiUrl, token }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(path, 0o600);
  process.env.SESSIONS_API_URL = apiUrl;
  process.env.SESSIONS_API_TOKEN = token;
}

async function publicRequest(apiUrl: string, path: string, body: unknown) {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
  return payload;
}

async function request(path: string, init?: RequestInit) {
  await loadHostedEnvironment();
  const api = process.env.SESSIONS_API_URL;
  const token = process.env.SESSIONS_API_TOKEN;
  if (!api || !token) throw new Error("Not signed in. Run: sessions login <https://host> <email>");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${api.replace(/\/$/, "")}${path}`, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof body === "object" && body && "error" in body ? String((body as any).error) : `HTTP ${response.status}`);
  return body;
}

async function hiddenPassword(): Promise<string> {
  if (process.env.SESSIONS_PASSWORD) return process.env.SESSIONS_PASSWORD;
  if (!process.stdin.isTTY) return (await new Promise<string>((resolve) => { let value = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => value += chunk); process.stdin.on("end", () => resolve(value)); })).trim();
  process.stdout.write("Password: ");
  process.stdin.setRawMode?.(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => { process.stdin.setRawMode?.(false); process.stdin.pause(); process.stdin.removeListener("data", onData); process.stdout.write("\n"); };
    const onData = (chunk: string | Buffer) => {
      const text = String(chunk);
      for (const char of text) {
        if (char === "\u0003") { cleanup(); reject(new Error("Login cancelled")); return; }
        if (char === "\r" || char === "\n") { cleanup(); resolve(value); return; }
        if (char === "\u007f" || char === "\b") { if (value.length) { value = value.slice(0, -1); process.stdout.write("\b \b"); } continue; }
        if (char >= " ") { value += char; process.stdout.write("*"); }
      }
    };
    process.stdin.on("data", onData);
  });
}

export async function handleHostedCommand(command: string, args: string[]): Promise<boolean> {
  if (command === "login") {
    const apiUrl = args[0]?.replace(/\/$/, ""); const email = args[1]?.trim();
    if (!apiUrl || !/^https?:\/\//.test(apiUrl) || !email) throw new Error("Usage: sessions login <https://host> <email>");
    const password = await hiddenPassword();
    const result = await publicRequest(apiUrl, "/api/auth/login", { email, password });
    if (!result.token) throw new Error("Sessions auth did not issue a credential");
    await saveHostedConfig(apiUrl, result.token);
    console.log(`Signed in to ${apiUrl}. Workspace ${result.workspaceId}.`);
    return true;
  }
  if (command === "connect") {
    const apiUrl = args[0]?.replace(/\/$/, "");
    const token = args[1] || process.env.SESSIONS_API_TOKEN;
    if (!apiUrl || !/^https?:\/\//.test(apiUrl)) throw new Error("Usage: sessions connect <https://host> [token]");
    if (!token) throw new Error("Provide a workspace token as the second argument or SESSIONS_API_TOKEN");
    const previousUrl = process.env.SESSIONS_API_URL, previousToken = process.env.SESSIONS_API_TOKEN;
    process.env.SESSIONS_API_URL = apiUrl; process.env.SESSIONS_API_TOKEN = token;
    try { await request("/api/sessions"); }
    catch (error) { if (previousUrl) process.env.SESSIONS_API_URL = previousUrl; else delete process.env.SESSIONS_API_URL; if (previousToken) process.env.SESSIONS_API_TOKEN = previousToken; else delete process.env.SESSIONS_API_TOKEN; throw new Error(`Hosted credential verification failed: ${error instanceof Error ? error.message : error}`); }
    await saveHostedConfig(apiUrl, token);
    console.log(`Connected to ${apiUrl}; Sessions credential verified.`);
    return true;
  }
  if (command === "disconnect" || command === "logout") {
    await rm(configPath(), { force: true }); delete process.env.SESSIONS_API_URL; delete process.env.SESSIONS_API_TOKEN;
    console.log("Signed out of hosted Sessions."); return true;
  }
  if (command === "billing") { console.log(JSON.stringify(await request("/api/billing/subscription"), null, 2)); return true; }
  if (command === "upgrade") { const planKey = args[0] || "developer"; const checkout = await request("/api/billing/checkout", { method: "POST", body: JSON.stringify({ planKey }) }) as any; console.log(checkout.url ?? JSON.stringify(checkout)); return true; }
  if (command === "export") { const payload = await request("/api/account/export", { method: "POST", body: "{}" }); const file = args[0] || `sessions-export-${Date.now()}.json`; await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8"); console.log(`Export written to ${file}`); return true; }
  if (command === "cancel") { const result = await request("/api/account/cancel", { method: "POST", body: "{}" }); console.log(JSON.stringify(result, null, 2)); return true; }
  return false;
}
