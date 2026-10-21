"use client";

/**
 * Staff side of questionnaire links: send / revoke / review go through the
 * server routes (session-checked, recorded with who and when); lists are read
 * straight from Supabase under RLS (only your own office's rows).
 */
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import type { FormSnapshot, PatientAnswers } from "@/lib/patient-forms";

export interface FormRequestRow {
  id: string;
  patient_id: string;
  form_id: string;
  form_name: string;
  snapshot: FormSnapshot;
  answers: PatientAnswers;
  status: "sent" | "started" | "submitted" | "revoked";
  raw_submission: { answers: PatientAnswers; snapshot: FormSnapshot; submittedAt: string } | null;
  submitted_at: string | null;
  review_status: "new" | "inserted" | "dismissed";
  reviewed_by_label: string | null;
  reviewed_at: string | null;
  inserted_encounter_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_by_label: string | null;
  created_at: string;
  last_saved_at: string | null;
}

const COLUMNS =
  "id, patient_id, form_id, form_name, snapshot, answers, status, raw_submission, submitted_at, review_status, reviewed_by_label, reviewed_at, inserted_encounter_id, expires_at, revoked_at, created_by_label, created_at, last_saved_at";

async function authHeaders(): Promise<Record<string, string> | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
}

export async function sendFormLink(input: {
  patientId: string;
  snapshot: FormSnapshot;
  officeName: string;
  expiresDays: number;
}): Promise<{ ok: true; id: string; url: string; expiresAt: string } | { ok: false; error: string }> {
  const headers = await authHeaders();
  if (!headers) return { ok: false, error: "Not signed in." };
  try {
    const res = await fetch("/api/forms/send", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, workspaceId: getActiveWorkspaceIdSync() }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || "Could not create the link." };
    return { ok: true, id: json.id, url: json.url, expiresAt: json.expiresAt };
  } catch {
    return { ok: false, error: "No connection. Try again." };
  }
}

export async function manageFormRequest(
  id: string,
  action: "revoke" | "inserted" | "dismissed" | "reopen",
  encounterId?: string,
): Promise<{ ok: true; by: string; at: string } | { ok: false; error: string }> {
  const headers = await authHeaders();
  if (!headers) return { ok: false, error: "Not signed in." };
  try {
    const res = await fetch("/api/forms/manage", { method: "POST", headers, body: JSON.stringify({ id, action, encounterId }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || "Could not save." };
    return { ok: true, by: json.by, at: json.at };
  } catch {
    return { ok: false, error: "No connection. Try again." };
  }
}

/**
 * After answers were inserted into a note: ask the server to permanently
 * delete the response. The server deletes only once the note's cloud copy is
 * saved after the insert; until then it answers 409 and we try again a few
 * times (the note save is debounced). Never deletes on its own judgement.
 */
export async function purgeQuestionnaireWhenNoteSaved(id: string, encounterId: string, tries = 8, delayMs = 4000): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const headers = await authHeaders();
    if (!headers) return false;
    try {
      const res = await fetch("/api/forms/manage", { method: "POST", headers, body: JSON.stringify({ id, action: "purge", encounterId }) });
      if (res.ok) return true;
      if (res.status !== 409) return false;
    } catch {
      /* retry */
    }
  }
  return false;
}

/** This office's links: one patient's, or every submitted one still waiting for review. */
export async function listFormRequests(filter: { patientId?: string; awaitingReview?: boolean }): Promise<FormRequestRow[] | null> {
  const supabase = getSupabaseBrowserClient();
  const workspaceId = getActiveWorkspaceIdSync();
  if (!supabase || !workspaceId) return null;
  let q = supabase.from("patient_form_requests").select(COLUMNS).eq("workspace_id", workspaceId);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);
  if (filter.awaitingReview) q = q.eq("status", "submitted").eq("review_status", "new");
  const { data, error } = await q.order("created_at", { ascending: false }).limit(filter.patientId ? 50 : 200);
  if (error) {
    // Table not created yet (migration not run): show nothing rather than an error.
    if (!/does not exist|schema cache/i.test(error.message)) console.warn("[forms] list failed:", error.message);
    return null;
  }
  return (data ?? []) as unknown as FormRequestRow[];
}
