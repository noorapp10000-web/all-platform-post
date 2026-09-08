import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function keyBytes(): Buffer {
  const raw = process.env["APP_TOKEN_ENCRYPTION_KEY"];
  if (!raw) throw new Error("APP_TOKEN_ENCRYPTION_KEY is not set");
  return createHmac("sha256", "enc").update(raw).digest();
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptJson<T>(stored: string): T {
  const buf = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const out = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  return JSON.parse(out) as T;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input as never)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signPayload(payload: string): string {
  const raw = process.env["APP_TOKEN_ENCRYPTION_KEY"];
  if (!raw) throw new Error("APP_TOKEN_ENCRYPTION_KEY is not set");
  return b64url(createHmac("sha256", raw).update(payload).digest());
}

export function signState(data: Record<string, unknown>, ttlMs = 15 * 60 * 1000): string {
  const payload = b64url(JSON.stringify({ ...data, exp: Date.now() + ttlMs }));
  return `${payload}.${signPayload(payload)}`;
}

export function verifyState<T>(state: string): T | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = signPayload(payload);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data as T;
  } catch {
    return null;
  }
}
