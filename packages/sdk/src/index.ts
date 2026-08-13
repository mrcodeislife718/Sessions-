export type ActorKind = "human" | "ai_agent" | "ai_system" | "service";

export type Actor = {
  id: string;
  kind: ActorKind;
  displayName: string;
  provider?: string;
  model?: string;
};

export type StartSessionInput = {
  workspaceId?: string;
  projectId?: string;
  repositoryId: string;
  objective: string;
  actor?: Actor;
};

export type SessionAggregate = {
  session: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  snapshots: Array<Record<string, unknown>>;
  verifications: Array<Record<string, unknown>>;
};

export interface SessionsTransport {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

export class FetchTransport implements SessionsTransport {
  constructor(private readonly baseUrl: string, private readonly apiKey?: string) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (this.apiKey) headers.set("authorization", `Bearer ${this.apiKey}`);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers });
    const text = await response.text();
    if (!response.ok) throw new Error(`Sessions API ${response.status}: ${text}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

export class SessionsClient {
  constructor(private readonly transport: SessionsTransport) {}

  listSessions() {
    return this.transport.request<Array<Record<string, unknown>>>("/api/sessions");
  }

  startSession(input: StartSessionInput) {
    return this.transport.request<SessionAggregate>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getSession(id: string) {
    return this.transport.request<SessionAggregate>(`/api/sessions/${id}`);
  }

  appendEvent(id: string, type: string, payload: Record<string, unknown> = {}, actor?: Actor) {
    return this.transport.request<Record<string, unknown>>(`/api/sessions/${id}/events`, {
      method: "POST",
      body: JSON.stringify({ type, payload, actor }),
    });
  }

  createSnapshot(id: string, entries: Array<{ path: string; contentHash: string; size: number }>, actor?: Actor) {
    return this.transport.request<Record<string, unknown>>(`/api/sessions/${id}/snapshots`, {
      method: "POST",
      body: JSON.stringify({ entries, actor }),
    });
  }

  recordVerification(id: string, input: { kind: string; status: string; summary: string; snapshotId?: string; actor?: Actor }) {
    return this.transport.request<Record<string, unknown>>(`/api/sessions/${id}/verifications`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  replay(id: string) {
    return this.transport.request<Record<string, unknown>>(`/api/sessions/${id}/replay`, { method: "POST", body: "{}" });
  }

  rollback(id: string, snapshotId: string, actor?: Actor) {
    return this.transport.request<Record<string, unknown>>(`/api/sessions/${id}/rollback`, {
      method: "POST",
      body: JSON.stringify({ snapshotId, actor }),
    });
  }
}
