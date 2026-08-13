import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const api = process.env.SESSIONS_API_URL ?? "http://localhost:4000";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Sessions API ${response.status}`);
  return text ? JSON.parse(text) : {};
}

const server = new McpServer({ name: "sessions", version: "0.1.0" });

server.tool(
  "sessions_start",
  "Start a Sessions execution record for a repository objective.",
  { repositoryId: z.string().min(1), objective: z.string().min(1), actorId: z.string().optional(), actorKind: z.enum(["human", "ai_agent", "ai_system", "service"]).optional(), displayName: z.string().optional() },
  async ({ repositoryId, objective, actorId, actorKind, displayName }) => {
    const body = await request("/api/sessions", { method: "POST", body: JSON.stringify({ repositoryId, objective, actor: actorId ? { id: actorId, kind: actorKind ?? "ai_system", displayName: displayName ?? actorId } : undefined }) });
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

server.tool(
  "sessions_record_event",
  "Append an attributable execution event to a Session.",
  { sessionId: z.string().min(1), type: z.string().min(1), message: z.string().optional(), actorId: z.string().optional(), actorKind: z.enum(["human", "ai_agent", "ai_system", "service"]).optional(), displayName: z.string().optional() },
  async ({ sessionId, type, message, actorId, actorKind, displayName }) => {
    const body = await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type, payload: { message }, actor: actorId ? { id: actorId, kind: actorKind ?? "ai_system", displayName: displayName ?? actorId } : undefined }) });
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

server.tool(
  "sessions_get",
  "Get the current Session aggregate including timeline, snapshots, and verification evidence.",
  { sessionId: z.string().min(1) },
  async ({ sessionId }) => ({ content: [{ type: "text", text: JSON.stringify(await request(`/api/sessions/${sessionId}`), null, 2) }] }),
);

server.tool(
  "sessions_replay",
  "Return the recorded event replay plan for a Session.",
  { sessionId: z.string().min(1) },
  async ({ sessionId }) => ({ content: [{ type: "text", text: JSON.stringify(await request(`/api/sessions/${sessionId}/replay`, { method: "POST", body: "{}" }), null, 2) }] }),
);

server.tool(
  "sessions_rollback",
  "Prepare a rollback request targeting a recorded CodeVault snapshot.",
  { sessionId: z.string().min(1), snapshotId: z.string().min(1), actorId: z.string().optional(), actorKind: z.enum(["human", "ai_agent", "ai_system", "service"]).optional(), displayName: z.string().optional() },
  async ({ sessionId, snapshotId, actorId, actorKind, displayName }) => {
    const body = await request(`/api/sessions/${sessionId}/rollback`, { method: "POST", body: JSON.stringify({ snapshotId, actor: actorId ? { id: actorId, kind: actorKind ?? "ai_system", displayName: displayName ?? actorId } : undefined }) });
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
