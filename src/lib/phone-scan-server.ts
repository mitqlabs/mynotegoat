/** Server-only helpers for phone hand-off scanning. Same token scheme as form links:
 *  32 random bytes (base64url); only sha256(token) is stored. */
import { createHash, randomBytes } from "node:crypto";

export function newScanToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashScanToken(token: string): string {
  return createHash("sha256").update(`scan:${token}`, "utf8").digest("hex");
}

export function isScanTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
