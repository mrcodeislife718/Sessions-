import type { SessionEvent } from "@sessions/shared";

export interface TimelineStore {
  append(event: SessionEvent): Promise<void>;
  list(sessionId: string): Promise<SessionEvent[]>;
}

export class InMemoryTimelineStore implements TimelineStore {
  private readonly events = new Map<string, SessionEvent[]>();

  async append(event: SessionEvent): Promise<void> {
    const current = this.events.get(event.sessionId) ?? [];
    if (current.some((existing) => existing.id === event.id)) return;
    this.events.set(event.sessionId, [...current, event]);
  }

  async list(sessionId: string): Promise<SessionEvent[]> {
    return [...(this.events.get(sessionId) ?? [])].sort((a, b) => {
      const byTime = a.occurredAt.localeCompare(b.occurredAt);
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    });
  }
}

export interface ReplayPlan {
  sessionId: string;
  orderedEvents: SessionEvent[];
  actorIds: string[];
  containsModelReexecution: boolean;
}

export async function createReplayPlan(store: TimelineStore, sessionId: string): Promise<ReplayPlan> {
  const orderedEvents = await store.list(sessionId);
  const actorIds = [...new Set(orderedEvents.map((event) => event.actor.id))];
  const containsModelReexecution = orderedEvents.some(
    (event) => event.type === "AgentExecuted" || event.type === "SystemExecuted",
  );

  return {
    sessionId,
    orderedEvents,
    actorIds,
    containsModelReexecution,
  };
}
