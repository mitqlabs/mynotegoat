/**
 * Server-only helpers for patient questionnaire links (API routes).
 * Tokens: 32 random bytes (base64url, 43 chars). Only sha256(token) is stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export const FORM_TABLE = "patient_form_requests";
export const DEFAULT_EXPIRY_DAYS = 14;
export const MAX_EXPIRY_DAYS = 30;

/** Columns staff / server code may read (never token_hash). */
export const STAFF_COLUMNS =
  "id, owner_id, workspace_id, patient_id, form_id, form_name, office_name, snapshot, answers, step, status, raw_submission, submitted_at, review_status, reviewed_by, reviewed_by_label, reviewed_at, inserted_encounter_id, expires_at, revoked_at, created_by, created_by_label, created_at, updated_at, last_saved_at";

export function newFormToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashFormToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Well-formed token? (Cheap reject before touching the database.) */
export function isTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function serverConfig(): { url: string; anonKey: string; serviceKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && anonKey && serviceKey ? { url, anonKey, serviceKey } : null;
}

export function adminClient(cfg: { url: string; serviceKey: string }): SupabaseClient {
  return createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface StaffCaller {
  userId: string;
  ownerId: string;
  label: string;
}

/**
 * The signed-in staff member behind a Bearer token: the owner themself, or a
 * team member who is not deactivated (their owner's office). null = refuse.
 */
export async function verifyStaff(request: NextRequest, cfg: { url: string; anonKey: string }, admin: SupabaseClient): Promise<StaffCaller | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const authClient = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await authClient.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return null;
  const { data: member } = await admin
    .from("workspace_members")
    .select("workspace_owner_id, label, permissions")
    .eq("member_user_id", user.id)
    .maybeSingle();
  if (member) {
    const perms = (member.permissions ?? {}) as Record<string, unknown>;
    if (perms.disabled === true) return null;
    return { userId: user.id, ownerId: String(member.workspace_owner_id), label: String(member.label || user.email || "Team Member") };
  }
  return { userId: user.id, ownerId: user.id, label: user.email || "Owner" };
}

/** The caller's office owns this workspace id ("<ownerId>:<officeId>"). */
export function ownsWorkspace(caller: StaffCaller, workspaceId: string): boolean {
  return typeof workspaceId === "string" && workspaceId.startsWith(`${caller.ownerId}:`) && workspaceId.length < 200;
}

// ---- Rate limiting --------------------------------------------------------

const memoryHits = new Map<string, { start: number; hits: number }>();

/** In-instance limiter: a first line of defense even if the database limiter is unavailable. */
export function memoryRateOk(bucket: string, max: number, windowMs: number, now = Date.now()): boolean {
  const cur = memoryHits.get(bucket);
  if (!cur || now - cur.start > windowMs) {
    memoryHits.set(bucket, { start: now, hits: 1 });
    if (memoryHits.size > 5000) for (const [k, v] of memoryHits) if (now - v.start > windowMs) memoryHits.delete(k);
    return true;
  }
  cur.hits++;
  return cur.hits <= max;
}

/** Both limiters must allow it. A database error counts as "allowed" only for the DB layer. */
export async function rateOk(admin: SupabaseClient, bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  if (!memoryRateOk(bucket, max, windowSeconds * 1000)) return false;
  const { data, error } = await admin.rpc("form_rate_hit", { p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });
  if (error) {
    console.warn("[forms] rate limiter unavailable:", error.message);
    return true;
  }
  return data !== false;
}

/** The caller's IP, hashed (never stored raw). */
export function ipBucket(request: NextRequest): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`forms:${ip}`).digest("hex").slice(0, 32);
}

/** Public base URL for links: NEXT_PUBLIC_SITE_URL, else the request's own host. */
export function publicOrigin(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

export const NO_STORE = { "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };

export function tableMissing(message: string | undefined): boolean {
  return /patient_form_requests|relation .* does not exist|schema cache/i.test(message ?? "");
}
