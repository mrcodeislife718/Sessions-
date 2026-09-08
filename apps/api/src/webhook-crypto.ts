import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function masterKey(): Buffer {
  const value = process.env.SESSIONS_WEBHOOK_MASTER_KEY?.trim();
  if (!value) throw new Error("SESSIONS_WEBHOOK_MASTER_KEY is required");
  return createHash("sha256").update(value, "utf8").digest();
}

export function encryptWebhookSecret(secret: string) {
  if (secret.length < 32) throw new Error("webhook signing secret must be at least 32 characters");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

export function decryptWebhookSecret(input: { ciphertext: string; nonce: string; authTag: string }): string {
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(input.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(input.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(input.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function privateIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}

function privateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (isIP(address) === 4) return privateIpv4(address);
  if (isIP(address) !== 6) return true;
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? privateIpv4(mapped[1]) : false;
}

export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("valid webhook URL is required"); }
  const allowHttp = process.env.SESSIONS_ALLOW_INSECURE_WEBHOOKS === "true";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) throw new Error("webhook URL must use HTTPS");
  if (url.username || url.password) throw new Error("webhook URL must not contain credentials");
  if (url.port && !/^\d+$/.test(url.port)) throw new Error("invalid webhook port");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(hostname);
  if (literal && privateAddress(hostname)) throw new Error("webhook target must not use a private or reserved address");
  if (!literal) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("webhook target resolves to a private or reserved address");
  }
  return url;
}
