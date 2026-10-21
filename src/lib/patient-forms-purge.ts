/**
 * When a submitted questionnaire may be permanently deleted.
 *
 * Rule: only after its answers were applied to a visit note (review_status
 * "inserted" for that exact note) AND the cloud copy of that note was saved
 * after the insert was recorded, with an Objective that isn't empty.
 * Dismissed, reopened, never-applied, or not-yet-saved → keep.
 */
export type PurgeRow = {
  status: string;
  review_status: string | null;
  inserted_encounter_id: string | null;
  reviewed_at: string | null;
  workspace_id: string;
  patient_id: string;
};
export type PurgeNote = {
  id: string;
  workspace_id: string;
  patient_id: string;
  updated_at: string;
  soap: { objective?: string } | null;
} | null;

export type PurgeVerdict = { ok: true } | { ok: false; reason: "not-applied" | "wrong-note" | "note-not-saved" };

export function canPurgeQuestionnaire(row: PurgeRow, encounterId: string, note: PurgeNote): PurgeVerdict {
  if (row.status !== "submitted" || row.review_status !== "inserted" || !row.reviewed_at) return { ok: false, reason: "not-applied" };
  if (!encounterId || row.inserted_encounter_id !== encounterId) return { ok: false, reason: "wrong-note" };
  if (!note || note.id !== encounterId || note.workspace_id !== row.workspace_id || note.patient_id !== row.patient_id) {
    return { ok: false, reason: "note-not-saved" };
  }
  const objective = String(note.soap?.objective ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  const savedAt = Date.parse(note.updated_at);
  const insertedAt = Date.parse(row.reviewed_at);
  if (!objective || !Number.isFinite(savedAt) || !Number.isFinite(insertedAt) || savedAt < insertedAt) {
    return { ok: false, reason: "note-not-saved" };
  }
  return { ok: true };
}
