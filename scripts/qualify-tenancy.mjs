#!/usr/bin/env node
import assert from "node:assert/strict";

const base = process.env.SESSIONS_API_URL ?? "http://127.0.0.1:4000";
const tokenA = process.env.TOKEN_A ?? "qualification-token-a";
const tokenB = process.env.TOKEN_B ?? "qualification-token-b";
const tokenReadonly = process.env.TOKEN_READONLY ?? "qualification-token-readonly";

async function call(path, token, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}

const missing = await call("/api/sessions", null);
assert.equal(missing.status, 401, "missing credential must be rejected");

const listA = await call("/api/sessions", tokenA);
assert.equal(listA.status, 200);
assert.ok(listA.body.some((row) => row.id === "session_a"));
assert.ok(!listA.body.some((row) => row.id === "session_b"), "tenant A list leaked tenant B session");

const listB = await call("/api/sessions", tokenB);
assert.equal(listB.status, 200);
assert.ok(listB.body.some((row) => row.id === "session_b"));
assert.ok(!listB.body.some((row) => row.id === "session_a"), "tenant B list leaked tenant A session");

const crossRead = await call("/api/sessions/session_b", tokenA);
assert.equal(crossRead.status, 404, "cross-tenant direct read must not reveal resource existence");

const readOwn = await call("/api/sessions/session_a", tokenReadonly);
assert.equal(readOwn.status, 200);

const forbiddenWrite = await call("/api/sessions/session_a/events", tokenReadonly, {
  method: "POST",
  body: JSON.stringify({ type: "HumanActionRecorded", payload: { message: "must be denied" } }),
});
assert.equal(forbiddenWrite.status, 403, "read-only credential must not mutate session");

const wrongRepo = await call("/api/sessions", tokenA, {
  method: "POST",
  body: JSON.stringify({ objective: "cross-tenant repository attempt", repositoryId: "repo_b", projectId: "project_a" }),
});
assert.equal(wrongRepo.status, 404, "tenant A must not create a session against tenant B repository");

console.log(JSON.stringify({ qualification: "tenant-isolation", passed: true, assertions: 9 }, null, 2));
