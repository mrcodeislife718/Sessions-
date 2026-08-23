import { createHash, randomUUID } from "node:crypto";
import type http from "node:http";

export type RequestIdentity = {
  credentialId: string;
  workspaceId: string;
  principalId: string;
  principalKind: "human" | "service" | "ai_worker";
  displayName: string;
  scopes: string[];
  localDevelopment?: boolean;
};

export function hashBearerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function bearerToken(req: http.IncomingMessage): string | null {
  const value = req.headers.authorization;
  if (!value) return null;
  const [scheme, token, ...rest] = value.trim().split(/\s+/);
  if (rest.length || scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export function requestId(req: http.IncomingMessage): string {
  const supplied = req.headers["x-request-id"];
  if (typeof supplied === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)) return supplied;
  return `req_${randomUUID()}`;
}

export function hasScope(identity: RequestIdentity, required: string): boolean {
  return identity.localDevelopment === true || identity.scopes.includes("*") || identity.scopes.includes(required);
}

export function workspaceAllowed(identity: RequestIdentity, workspaceId: string): boolean {
  return identity.localDevelopment === true || identity.workspaceId === workspaceId;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { windowStartedAt: number; count: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {
    if (!Number.isFinite(limit) || limit < 1) throw new Error("rate limit must be >= 1");
    if (!Number.isFinite(windowMs) || windowMs < 1000) throw new Error("rate window must be >= 1000ms");
  }

  check(key: string, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
    const current = this.buckets.get(key);
    if (!current || now - current.windowStartedAt >= this.windowMs) {
      const next = { windowStartedAt: now, count: 1 };
      this.buckets.set(key, next);
      return { allowed: true, remaining: Math.max(0, this.limit - 1), resetAt: now + this.windowMs };
    }

    if (current.count >= this.limit) {
      return { allowed: false, remaining: 0, resetAt: current.windowStartedAt + this.windowMs };
    }

    current.count += 1;
    return { allowed: true, remaining: this.limit - current.count, resetAt: current.windowStartedAt + this.windowMs };
  }
}
