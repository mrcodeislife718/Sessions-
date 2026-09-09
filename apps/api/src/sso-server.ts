import http from "node:http";
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { Pool, type PoolClient } from "pg";

const port = Number(process.env.SSO_PORT ?? 4700);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://sessions:sessions@localhost:5432/sessions";
const publicOrigin = String(process.env.SESSIONS_PUBLIC_ORIGIN ?? "").replace(/\/$/, "");
const maxBody = Number(process.env.SESSIONS_MAX_BODY_BYTES ?? 1_048_576);
const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.SESSIONS_SSO_DB_POOL_MAX ?? 10),
});

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Identity = { workspaceId: string; principalId: string; scopes: string[] };
type OidcProvider = {
  organization_id: string;
  workspace_id: string;
  issuer: string;
  client_id: string;
  client_secret_ciphertext: string;
  client_secret_nonce: string;
  client_secret_auth_tag: string;
  allowed_domains: string[];
  jit_role: "member" | "viewer";
  enforce_sso: boolean;
  status: "active" | "disabled";
};
type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
function b64urlJson(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid OIDC token encoding");
  }
}
function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}
function redirect(
  res: http.ServerResponse,
  location: string,
  cookie?: string,
) {
  res.writeHead(302, {
    location,
    "cache-control": "no-store",
    ...(cookie ? { "set-cookie": cookie } : {}),
  });
  res.end();
}
async function jsonBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBody) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}
function masterKey() {
  const raw = process.env.SESSIONS_SSO_MASTER_KEY;
  if (!raw) throw new HttpError(503, "SSO master key is not configured");
  const key = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new HttpError(503, "SSO master key must decode to 32 bytes");
  }
  return key;
}
function encryptSecret(secret: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}
function decryptSecret(provider: OidcProvider) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(provider.client_secret_nonce, "base64"),
  );
  decipher.setAuthTag(Buffer.from(provider.client_secret_auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(provider.client_secret_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
function requireHttps(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, `${label} must be a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new HttpError(400, `${label} must use HTTPS without embedded credentials`);
  }
  return url.toString().replace(/\/$/, "");
}
function normalizeDomains(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new HttpError(400, "allowedDomains must be an array of at most 100 domains");
  }
  const domains = [
    ...new Set(
      value
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (
    domains.some(
      (domain) =>
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain),
    )
  ) {
    throw new HttpError(400, "allowedDomains contains an invalid domain");
  }
  return domains;
}
function safeReturnTo(value: unknown) {
  const path = String(value ?? "/");
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path)) {
    throw new HttpError(400, "returnTo must be a local absolute path");
  }
  return path.slice(0, 2000);
}
function cookieValue(req: http.IncomingMessage, name: string) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
function constantEqual(a: string, b: string) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
async function apiIdentity(req: http.IncomingMessage): Promise<Identity> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "bearer token required");
  const result = await pool.query(
    `select c.workspace_id,c.principal_id,c.scopes
       from api_credentials c join principals p on p.id=c.principal_id
      where c.token_hash=$1 and c.status='active' and p.status='active'
        and (c.expires_at is null or c.expires_at>now())`,
    [sha256(auth.slice(7).trim())],
  );
  if (!result.rows.length) throw new HttpError(401, "invalid or expired credential");
  return {
    workspaceId: result.rows[0].workspace_id,
    principalId: result.rows[0].principal_id,
    scopes: result.rows[0].scopes ?? [],
  };
}
async function requireEnterpriseAdmin(identity: Identity) {
  const result = await pool.query(
    `select w.organization_id,m.role,p.kind,e.plan_key,e.status entitlement_status
       from workspaces w
       join workspace_memberships m on m.workspace_id=w.id and m.principal_id=$2
       join principals p on p.id=m.principal_id
       left join workspace_entitlements e on e.workspace_id=w.id
      where w.id=$1`,
    [identity.workspaceId, identity.principalId],
  );
  const row = result.rows[0];
  if (!row || row.kind !== "human" || !["owner", "admin"].includes(row.role)) {
    throw new HttpError(403, "SSO configuration requires a human workspace owner or admin");
  }
  if (row.entitlement_status !== "active" || row.plan_key !== "enterprise") {
    throw new HttpError(402, "SSO requires an active Enterprise entitlement");
  }
  return row as { organization_id: string };
}
async function audit(
  workspaceId: string,
  principalId: string | null,
  action: string,
  resourceId: string,
  outcome: "allowed" | "denied" | "error",
  metadata: Record<string, unknown> = {},
) {
  await pool.query(
    `insert into audit_events(
      id,workspace_id,principal_id,action,resource_type,resource_id,outcome,metadata
    ) values($1,$2,$3,$4,'organization',$5,$6,$7)`,
    [
      `audit_${randomUUID()}`,
      workspaceId,
      principalId,
      action,
      resourceId,
      outcome,
      JSON.stringify(metadata),
    ],
  );
}

async function discovery(provider: OidcProvider): Promise<Discovery> {
  const response = await fetch(
    `${provider.issuer}/.well-known/openid-configuration`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new HttpError(502, "OIDC discovery failed");
  const value = (await response.json()) as Discovery;
  if (value.issuer.replace(/\/$/, "") !== provider.issuer.replace(/\/$/, "")) {
    throw new HttpError(502, "OIDC discovery issuer mismatch");
  }
  for (const [label, endpoint] of [
    ["authorization_endpoint", value.authorization_endpoint],
    ["token_endpoint", value.token_endpoint],
    ["jwks_uri", value.jwks_uri],
  ] as const) {
    if (!endpoint || new URL(endpoint).protocol !== "https:") {
      throw new HttpError(502, `OIDC ${label} must use HTTPS`);
    }
  }
  return value;
}

async function verifyIdToken(
  token: string,
  provider: OidcProvider,
  config: Discovery,
  expectedNonceHash: string,
) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "invalid OIDC ID token");
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (!["RS256", "PS256", "ES256", "EdDSA"].includes(header.alg)) {
    throw new HttpError(401, "unsupported OIDC ID token signing algorithm");
  }
  const jwksResponse = await fetch(config.jwks_uri, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!jwksResponse.ok) throw new HttpError(502, "OIDC JWKS retrieval failed");
  const jwks = (await jwksResponse.json()) as { keys?: JsonWebKey[] };
  const jwk = (jwks.keys ?? []).find((key: any) => key.kid === header.kid);
  if (!jwk) throw new HttpError(401, "OIDC signing key not found");
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const input = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  let verified = false;
  if (header.alg === "RS256") {
    verified = verifySignature("RSA-SHA256", input, key, signature);
  } else if (header.alg === "PS256") {
    verified = verifySignature(
      "sha256",
      input,
      { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
      signature,
    );
  } else if (header.alg === "ES256") {
    verified = verifySignature(
      "sha256",
      input,
      { key, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } else {
    verified = verifySignature(null, input, key, signature);
  }
  if (!verified) throw new HttpError(401, "OIDC ID token signature verification failed");
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss?.replace(/\/$/, "") !== provider.issuer.replace(/\/$/, "")) {
    throw new HttpError(401, "OIDC ID token issuer mismatch");
  }
  if (!audiences.includes(provider.client_id)) throw new HttpError(401, "OIDC audience mismatch");
  if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new HttpError(401, "OIDC ID token expired");
  if (claims.iat && claims.iat > now + 120) throw new HttpError(401, "OIDC ID token issued in the future");
  if (!claims.nonce || sha256(String(claims.nonce)) !== expectedNonceHash) {
    throw new HttpError(401, "OIDC nonce mismatch");
  }
  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(401, "OIDC provider did not return a valid email");
  }
  if (claims.email_verified === false) throw new HttpError(401, "OIDC email is not verified");
  if (provider.allowed_domains.length) {
    const domain = email.split("@").at(-1) ?? "";
    if (!provider.allowed_domains.includes(domain)) {
      throw new HttpError(403, "email domain is not allowed for this organization");
    }
  }
  return { claims, email };
}

async function providerForOrganization(organizationId: string) {
  const result = await pool.query(
    "select * from enterprise_oidc_providers where organization_id=$1 and status='active'",
    [organizationId],
  );
  if (!result.rows.length) throw new HttpError(404, "active OIDC provider not configured");
  return result.rows[0] as OidcProvider;
}

async function startLogin(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const match = url.pathname.match(/^\/api\/sso\/([^/]+)\/start$/);
  if (!match) return false;
  if (req.method !== "GET") throw new HttpError(405, "method not allowed");
  if (!publicOrigin.startsWith("https://")) {
    throw new HttpError(503, "SESSIONS_PUBLIC_ORIGIN must be configured with HTTPS for SSO");
  }
  const organizationId = decodeURIComponent(match[1]);
  const provider = await providerForOrganization(organizationId);
  const config = await discovery(provider);
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  await pool.query(
    `insert into oidc_authorization_states(
       state_hash,organization_id,workspace_id,nonce_hash,return_to,expires_at
     ) values($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
    [sha256(state), organizationId, provider.workspace_id, sha256(nonce), returnTo],
  );
  const authorize = new URL(config.authorization_endpoint);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", provider.client_id);
  authorize.searchParams.set("redirect_uri", `${publicOrigin}/api/sso/callback`);
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  const cookie = `sessions_sso_state=${encodeURIComponent(state)}; Path=/api/sso/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
  redirect(res, authorize.toString(), cookie);
  return true;
}

async function callback(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (url.pathname !== "/api/sso/callback") return false;
  if (req.method !== "GET") throw new HttpError(405, "method not allowed");
  const state = String(url.searchParams.get("state") ?? "");
  const code = String(url.searchParams.get("code") ?? "");
  const cookie = cookieValue(req, "sessions_sso_state");
  if (!state || !code || !cookie || !constantEqual(state, cookie)) {
    throw new HttpError(400, "OIDC state validation failed");
  }
  const client = await pool.connect();
  let stateRow: any;
  try {
    await client.query("begin");
    const result = await client.query(
      `delete from oidc_authorization_states
        where state_hash=$1 and expires_at>now()
        returning organization_id,workspace_id,nonce_hash,return_to`,
      [sha256(state)],
    );
    if (!result.rows.length) throw new HttpError(400, "OIDC state expired or already used");
    stateRow = result.rows[0];
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const provider = await providerForOrganization(stateRow.organization_id);
  if (provider.workspace_id !== stateRow.workspace_id) {
    throw new HttpError(409, "OIDC workspace configuration changed during login");
  }
  const config = await discovery(provider);
  const secret = decryptSecret(provider);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${publicOrigin}/api/sso/callback`,
    client_id: provider.client_id,
  });
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  const methods = config.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
  if (methods.includes("client_secret_basic")) {
    headers.set(
      "authorization",
      `Basic ${Buffer.from(`${provider.client_id}:${secret}`).toString("base64")}`,
    );
  } else if (methods.includes("client_secret_post")) {
    form.set("client_secret", secret);
  } else {
    throw new HttpError(502, "OIDC provider does not support a compatible client authentication method");
  }
  const tokenResponse = await fetch(config.token_endpoint, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const tokenBody = (await tokenResponse.json().catch(() => ({}))) as any;
  if (!tokenResponse.ok || !tokenBody.id_token) {
    await audit(
      provider.workspace_id,
      null,
      "organization.sso.login",
      provider.organization_id,
      "denied",
      { reason: "token_exchange_failed" },
    );
    throw new HttpError(401, "OIDC token exchange failed");
  }
  const verified = await verifyIdToken(
    String(tokenBody.id_token),
    provider,
    config,
    stateRow.nonce_hash,
  );
  const displayName = String(
    verified.claims.name ?? verified.claims.preferred_username ?? verified.email,
  ).slice(0, 120);
  const identityClient = await pool.connect();
  let principalId: string;
  try {
    await identityClient.query("begin");
    const existing = await identityClient.query(
      "select id from principals where lower(email)=lower($1) and status='active' order by created_at limit 1",
      [verified.email],
    );
    principalId = existing.rows[0]?.id ?? `principal_${randomUUID()}`;
    if (!existing.rows.length) {
      await identityClient.query(
        "insert into principals(id,kind,display_name,email) values($1,'human',$2,$3)",
        [principalId, displayName, verified.email],
      );
    }
    await identityClient.query(
      `insert into workspace_memberships(workspace_id,principal_id,role)
       values($1,$2,$3) on conflict(workspace_id,principal_id) do nothing`,
      [provider.workspace_id, principalId, provider.jit_role],
    );
    const rawTicket = `sso_ticket_${randomBytes(32).toString("hex")}`;
    await identityClient.query(
      `insert into oidc_login_tickets(ticket_hash,workspace_id,principal_id,expires_at)
       values($1,$2,$3,now()+interval '2 minutes')`,
      [sha256(rawTicket), provider.workspace_id, principalId],
    );
    await identityClient.query("commit");
    await audit(
      provider.workspace_id,
      principalId,
      "organization.sso.login",
      provider.organization_id,
      "allowed",
      { email: verified.email, issuer: provider.issuer },
    );
    const destination = new URL(stateRow.return_to, publicOrigin);
    destination.searchParams.set("sso_ticket", rawTicket);
    redirect(
      res,
      destination.toString(),
      "sessions_sso_state=; Path=/api/sso/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    );
    return true;
  } catch (error) {
    await identityClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    identityClient.release();
  }
}

async function exchangeTicket(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (url.pathname !== "/api/sso/exchange") return false;
  if (req.method !== "POST") throw new HttpError(405, "method not allowed");
  const payload = await jsonBody(req);
  const ticket = String(payload.ticket ?? "");
  if (!ticket.startsWith("sso_ticket_")) throw new HttpError(400, "valid SSO ticket required");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `update oidc_login_tickets set used_at=now()
        where ticket_hash=$1 and used_at is null and expires_at>now()
        returning workspace_id,principal_id`,
      [sha256(ticket)],
    );
    if (!result.rows.length) throw new HttpError(400, "SSO ticket expired or already used");
    const row = result.rows[0];
    const raw = `sess_${randomBytes(32).toString("hex")}`;
    await client.query(
      `insert into api_credentials(id,workspace_id,principal_id,token_hash,scopes)
       values($1,$2,$3,$4,$5)`,
      [
        `credential_${randomUUID()}`,
        row.workspace_id,
        row.principal_id,
        sha256(raw),
        ["sessions:read", "sessions:write", "sessions:verify"],
      ],
    );
    await client.query("commit");
    return send(res, 200, {
      token: raw,
      workspaceId: row.workspace_id,
      principalId: row.principal_id,
    });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function admin(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (url.pathname !== "/api/organization/sso") return false;
  const identity = await apiIdentity(req);
  const authority = await requireEnterpriseAdmin(identity);
  if (req.method === "GET") {
    const result = await pool.query(
      `select organization_id,workspace_id,issuer,client_id,allowed_domains,jit_role,
              enforce_sso,status,created_at,updated_at
         from enterprise_oidc_providers where organization_id=$1`,
      [authority.organization_id],
    );
    send(res, 200, result.rows[0] ?? { configured: false });
    return true;
  }
  if (req.method !== "PUT") throw new HttpError(405, "method not allowed");
  const payload = await jsonBody(req);
  const issuer = requireHttps(String(payload.issuer ?? ""), "issuer");
  const clientId = String(payload.clientId ?? "").trim();
  const clientSecret = String(payload.clientSecret ?? "");
  if (!clientId || clientId.length > 500) throw new HttpError(400, "clientId is required");
  if (clientSecret.length < 8 || clientSecret.length > 4000) {
    throw new HttpError(400, "clientSecret must be between 8 and 4000 characters");
  }
  const allowedDomains = normalizeDomains(payload.allowedDomains ?? []);
  const jitRole = payload.jitRole === "viewer" ? "viewer" : "member";
  const encrypted = encryptSecret(clientSecret);
  const result = await pool.query(
    `insert into enterprise_oidc_providers(
       organization_id,workspace_id,issuer,client_id,client_secret_ciphertext,
       client_secret_nonce,client_secret_auth_tag,allowed_domains,jit_role,
       enforce_sso,status,created_by,updated_by
     ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$11)
     on conflict(organization_id) do update set
       workspace_id=excluded.workspace_id,issuer=excluded.issuer,client_id=excluded.client_id,
       client_secret_ciphertext=excluded.client_secret_ciphertext,
       client_secret_nonce=excluded.client_secret_nonce,
       client_secret_auth_tag=excluded.client_secret_auth_tag,
       allowed_domains=excluded.allowed_domains,jit_role=excluded.jit_role,
       enforce_sso=excluded.enforce_sso,status='active',updated_by=excluded.updated_by,
       updated_at=now()
     returning organization_id,workspace_id,issuer,client_id,allowed_domains,jit_role,
               enforce_sso,status,created_at,updated_at`,
    [
      authority.organization_id,
      identity.workspaceId,
      issuer,
      clientId,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.authTag,
      allowedDomains,
      jitRole,
      payload.enforceSso === true,
      identity.principalId,
    ],
  );
  await audit(
    identity.workspaceId,
    identity.principalId,
    "organization.sso.configure",
    authority.organization_id,
    "allowed",
    { issuer, clientId, allowedDomains, jitRole, enforceSso: payload.enforceSso === true },
  );
  send(res, 200, result.rows[0]);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      await pool.query("select 1");
      return send(res, 200, { ok: true, service: "sessions-sso" });
    }
    if (await startLogin(req, res, url)) return;
    if (await callback(req, res, url)) return;
    if (await exchangeTicket(req, res, url)) return;
    if (await admin(req, res, url)) return;
    throw new HttpError(404, "not found");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "internal error";
    console.error(JSON.stringify({ level: "error", service: "sessions-sso", status, message }));
    return send(res, status, { error: status >= 500 ? "internal error" : message });
  }
});

server.listen(port, "0.0.0.0", () =>
  console.log(JSON.stringify({ level: "info", event: "sso.started", port })),
);
async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
