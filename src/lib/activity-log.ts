"use client";

/**
 * Activity Log — who did what, for the admin Dashboard.
 *
 * Writes to public.audit_log (see supabase/activity_log.sql). Logging is
 * fire-and-forget and NEVER throws: an audit write must never break the
 * action it records. If the migration hasn't been run yet (no category /
 * patient columns), the entry is retried with the base columns only, with
 * the category kept inside `details`.
 *
 * Only milestones are logged — never keystrokes. A note is logged when it's
 * created, closed, reopened or deleted, not while it's being typed.
 */

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { getCurrentMembershipSync } from "@/lib/workspace-membership";
import { roleTierOf } from "@/lib/admin-access";
import { loadOfficeSettings } from "@/lib/office-settings";

export const ACTIVITY_CATEGORIES = [
  { key: "appointments", label: "Appointments" },
  { key: "patients", label: "Patients" },
  { key: "notes", label: "Notes" },
  { key: "files", label: "Files" },
  { key: "tasks", label: "Tasks" },
  { key: "billing", label: "Billing" },
  { key: "treatmentPlans", label: "Treatment Plans" },
  { key: "keyDates", label: "Key Dates" },
  { key: "messages", label: "Messages" },
  { key: "team", label: "Team" },
  { key: "log", label: "Log" },
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]["key"];

export interface ActivityEntryInput {
  category: ActivityCategory;
  /** Machine-readable action, e.g. "appointment.canceled". */
  action: string;
  /** Human-readable summary, e.g. "Canceled 09/07/2026 10:00 AM visit". */
  summary: string;
  patientId?: string;
  patientName?: string;
  /** Extra structured detail (before/after values, copied text…). */
  details?: Record<string, unknown>;
}

export interface ActivityEntry {
  id: string;
  createdAt: string;
  actorLabel: string;
  actorEmail: string;
  /** The role the actor held when they did it: owner/admin/manager/staff. */
  actorRole: string;
  category: string;
  action: string;
  summary: string;
  patientId: string;
  patientName: string;
  details: Record<string, unknown>;
}

/** "2026-09-07" → "09/07/2026"; US dates pass through. */
export function activityDate(value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[2]}/${iso[3]}/${iso[1]}` : raw;
}

/** "14:30" → "2:30 PM"; anything else passes through. */
export function activityTime(value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return raw;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

function actorLabel(): string {
  const membership = getCurrentMembershipSync();
  if (membership?.isMember) return membership.label || "Team Member";
  try {
    return loadOfficeSettings().doctorName?.trim() || "Owner";
  } catch {
    return "Owner";
  }
}

/** Record an activity. Safe to call from anywhere; never throws or awaits. */
export function logActivity(entry: ActivityEntryInput): void {
  void writeActivity(entry).catch(() => {
    // Logging must never surface an error into the action being logged.
  });
}

async function writeActivity(entry: ActivityEntryInput): Promise<void> {
  if (typeof window === "undefined") return;
  const supabase = getSupabaseBrowserClient();
  const workspaceId = getActiveWorkspaceIdSync();
  if (!supabase || !workspaceId) return;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  const base = {
    workspace_id: workspaceId,
    actor_user_id: user.id,
    actor_email: user.email ?? "",
    actor_label: actorLabel(),
    action: entry.action,
    target: entry.summary,
  };
  const { error } = await supabase.from("audit_log").insert({
    ...base,
    actor_role: roleTierOf(getCurrentMembershipSync()),
    category: entry.category,
    patient_id: entry.patientId ?? "",
    patient_name: entry.patientName ?? "",
    details: entry.details ?? {},
  });
  if (!error) return;
  // Pre-migration fallback: keep the entry, carry the extra fields in details.
  await supabase.from("audit_log").insert({
    ...base,
    details: {
      ...(entry.details ?? {}),
      actorRole: roleTierOf(getCurrentMembershipSync()),
      category: entry.category,
      patientId: entry.patientId ?? "",
      patientName: entry.patientName ?? "",
    },
  });
}

function rowToEntry(row: Record<string, unknown>): ActivityEntry {
  const details = (row.details && typeof row.details === "object" ? row.details : {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    createdAt: String(row.created_at ?? ""),
    actorLabel: String(row.actor_label ?? "") || String(row.actor_email ?? "") || "Unknown",
    actorEmail: String(row.actor_email ?? ""),
    actorRole: String(row.actor_role || details.actorRole || ""),
    category: String(row.category || details.category || ""),
    action: String(row.action ?? ""),
    summary: String(row.target ?? ""),
    patientId: String(row.patient_id || details.patientId || ""),
    patientName: String(row.patient_name || details.patientName || ""),
    details,
  };
}

/** Newest-first page of the log for the active workspace. Null = can't read. */
export async function fetchActivity(options: {
  categories?: string[];
  sinceIso?: string;
  limit?: number;
}): Promise<ActivityEntry[] | null> {
  const supabase = getSupabaseBrowserClient();
  const workspaceId = getActiveWorkspaceIdSync();
  if (!supabase || !workspaceId) return null;
  let query = supabase
    .from("audit_log")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 500);
  if (options.sinceIso) query = query.gte("created_at", options.sinceIso);
  if (options.categories && options.categories.length > 0) query = query.in("category", options.categories);
  const { data, error } = await query;
  if (error) return null;
  return (data ?? []).map((row) => rowToEntry(row as Record<string, unknown>));
}

/**
 * Delete entries older than `olderThanIso` (or all, when omitted). The
 * database refuses to delete "log.cleared" entries. Records the clearing
 * itself when `recordClear` is set.
 */
export async function clearActivity(options: {
  olderThanIso?: string;
  recordClear?: { summary: string };
}): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  const workspaceId = getActiveWorkspaceIdSync();
  if (!supabase || !workspaceId) return false;
  let query = supabase.from("audit_log").delete().eq("workspace_id", workspaceId).neq("action", "log.cleared");
  if (options.olderThanIso) query = query.lt("created_at", options.olderThanIso);
  const { error } = await query;
  if (error) return false;
  if (options.recordClear) {
    logActivity({ category: "log", action: "log.cleared", summary: options.recordClear.summary });
  }
  return true;
}
