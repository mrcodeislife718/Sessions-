import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowRateLimiter, hashBearerToken, hasScope, workspaceAllowed, type RequestIdentity } from "./security.js";

const identity: RequestIdentity = {
  credentialId: "cred_a",
  workspaceId: "workspace_a",
  principalId: "principal_a",
  principalKind: "human",
  displayName: "A",
  scopes: ["sessions:read", "sessions:write"],
};

test("bearer tokens are stored as deterministic SHA-256 hashes", () => {
  assert.equal(hashBearerToken("secret-token"), "930bbdc51b6aed5c2a5678fd6e28dee7a05e8a4b643cfc0b4427c3efb86c0d94");
  assert.notEqual(hashBearerToken("secret-token"), "secret-token");
});

test("scopes deny capabilities that were not granted", () => {
  assert.equal(hasScope(identity, "sessions:read"), true);
  assert.equal(hasScope(identity, "sessions:rollback"), false);
});

test("workspace boundary rejects cross-tenant access", () => {
  assert.equal(workspaceAllowed(identity, "workspace_a"), true);
  assert.equal(workspaceAllowed(identity, "workspace_b"), false);
});

test("local development bypass requires explicit local identity", () => {
  assert.equal(hasScope({ ...identity, scopes: [], localDevelopment: true }, "sessions:rollback"), true);
  assert.equal(workspaceAllowed({ ...identity, localDevelopment: true }, "workspace_b"), true);
});

test("fixed-window limiter rejects requests after quota and resets", () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000);
  assert.deepEqual(limiter.check("cred", 0), { allowed: true, remaining: 1, resetAt: 1_000 });
  assert.deepEqual(limiter.check("cred", 10), { allowed: true, remaining: 0, resetAt: 1_000 });
  assert.deepEqual(limiter.check("cred", 20), { allowed: false, remaining: 0, resetAt: 1_000 });
  assert.deepEqual(limiter.check("cred", 1_000), { allowed: true, remaining: 1, resetAt: 2_000 });
});
