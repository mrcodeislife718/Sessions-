export type ActorType = "human" | "ai_agent" | "ai_system" | "service";

export type StartSessionInput = {
  projectId: string;
  repositoryId: string;
  objective: string;
  actor: { id: string; type: ActorType; displayName: string };
};

export type SessionRecord = StartSessionInput & {
  id: string;
  status: "active" | "completed" | "failed" | "rolled_back";
  startedAt: string;
};

export type SessionEventInput = {
  sessionId: string;
  type: string;
  actor: { id: string; type: ActorType; displayName: string };
  payload?: Record<string, unknown>;
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
    if (!response.ok) throw new Error(`Sessions API ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }
}

export class SessionsClient {
  constructor(private readonly transport: SessionsTransport) {}

  startSession(input: StartSessionInput) {
    return this.transport.request<SessionRecord>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  appendEvent(input: SessionEventInput) {
    return this.transport.request<{ id: string; accepted: true }>(`/v1/sessions/${input.sessionId}/events`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  getSession(id: string) {
    return this.transport.request<SessionRecord>(`/v1/sessions/${id}`);
  }

  getTimeline(id: string) {
    return this.transport.request<{ sessionId: string; events: unknown[] }>(`/v1/sessions/${id}/timeline`);
  }
}
