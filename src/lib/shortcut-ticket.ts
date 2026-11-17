/**
 * A short-lived sealed copy of the device code, so the iPhone can download
 * a shortcut that already contains it. The code is not readable from the link.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const TOKEN_RE = /^ngr_[0-9a-f]{64}$/;

export function isDeviceToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

function keyFor(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** 15 minutes. The Shortcuts app fetches the file once, right away. */
export function sealDeviceToken(token: string, secret: string, now = Date.now()): string {
  if (!isDeviceToken(token)) throw new Error("Bad device code.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const exp = Buffer.alloc(8);
  exp.writeBigUInt64BE(BigInt(now + 15 * 60 * 1000));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, exp, encrypted]).toString("base64url");
}

export function openDeviceToken(ticket: string, secret: string, now = Date.now()): string | null {
  try {
    const buf = Buffer.from(ticket, "base64url");
    if (buf.length < 12 + 16 + 8 + 10) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const exp = Number(buf.readBigUInt64BE(28));
    if (!Number.isFinite(exp) || exp < now) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), iv);
    decipher.setAuthTag(tag);
    const token = Buffer.concat([decipher.update(buf.subarray(36)), decipher.final()]).toString("utf8");
    return isDeviceToken(token) ? token : null;
  } catch {
    return null;
  }
}
