/**
 * Quick Case Notes — the patient's Notes box as a running log. Type a note,
 * press Enter, and it is saved as one entry stamped with today's date and the
 * signed-in person's name:
 *
 *   10/27/26 Dr. Mike
 *   Spoke with attorney, waiting on the reduction.
 *
 * Stored in the cloud (workspace_kv) as ONE flat list of entries
 * [{ id, patientId, text, date, author, ... }] so the boot merge (kv-merge
 * unionMerge, UNION_MERGE_KEYS) keeps both sides per id, newest `updatedAt`
 * wins, and a delete is a tombstone (`deleted: true`, text kept so it can be
 * restored). Two people adding notes at the same time can't overwrite each
 * other. localStorage is only a cache.
 *
 * The old free-form Case Notes text (casemate.case-notes.v1) is untouched and
 * still shown as "Earlier notes" — nothing is converted or lost.
 */
import { unionMerge } from "@/lib/kv-merge";
import { signatureFor, signerFromLogin } from "@/lib/goat-notes";

export const CASE_NOTE_ENTRIES_KEY = "casemate.case-note-entries.v1";

export const CASE_NOTE_MAX_LENGTH = 10000;

export interface CaseNoteEntry {
  id: string;
  patientId: string;
  text: string;
  /** The note's date, YYYY-MM-DD (today when written; owner/Admin can change it). */
  date: string;
  /** Display name stamped at write time, e.g. "Dr. Mike" or "Hannah M.". */
  author: string;
  /** Login (auth user id) of who wrote it, "" if unknown. */
  authorUserId: string;
  createdAt: string;
  updatedAt: string;
  /** Display name of the last person who edited the text or date (blank until edited). */
  editedBy?: string;
  /** Tombstone: removed from view but kept in the cloud so it can be restored. */
  deleted?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "2026-10-27" → "10/27/26" (the format the existing Case Notes use). */
export function formatEntryDate(iso: string): string {
  const m = ISO_DATE.exec(iso);
  return m ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}` : iso;
}

export function isValidIsoDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00`);
  return !Number.isNaN(d.getTime()) && todayIso(d) === iso;
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `cn-${crypto.randomUUID()}`;
  } catch {
    /* fall through */
  }
  return `cn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Cleans a stored / cloud list: drops anything that isn't a usable entry. */
export function normalizeEntries(value: unknown): CaseNoteEntry[] {
  if (!Array.isArray(value)) return [];
  const out: CaseNoteEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<CaseNoteEntry>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const patientId = typeof r.patientId === "string" ? r.patientId.trim() : "";
    const text = typeof r.text === "string" ? r.text : "";
    if (!id || !patientId) continue;
    if (!text.trim() && r.deleted !== true) continue;
    const createdAt = typeof r.createdAt === "string" ? r.createdAt : "";
    out.push({
      id,
      patientId,
      text: text.slice(0, CASE_NOTE_MAX_LENGTH),
      date: typeof r.date === "string" && ISO_DATE.test(r.date) ? r.date : createdAt.slice(0, 10),
      author: typeof r.author === "string" ? r.author : "",
      authorUserId: typeof r.authorUserId === "string" ? r.authorUserId : "",
      createdAt,
      updatedAt: typeof r.updatedAt === "string" && r.updatedAt ? r.updatedAt : createdAt,
      ...(typeof r.editedBy === "string" && r.editedBy ? { editedBy: r.editedBy } : {}),
      ...(r.deleted === true ? { deleted: true } : {}),
    });
  }
  return out;
}

export function loadCaseNoteEntries(): CaseNoteEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeEntries(JSON.parse(window.localStorage.getItem(CASE_NOTE_ENTRIES_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

/** One patient's live entries, newest date first (ties: newest written first). */
export function entriesForPatient(all: CaseNoteEntry[], patientId: string): CaseNoteEntry[] {
  const pid = patientId.trim();
  return all
    .filter((e) => e.patientId === pid && !e.deleted)
    .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
}

export function makeEntry(input: {
  patientId: string;
  text: string;
  author: string;
  authorUserId?: string;
  now?: Date;
}): CaseNoteEntry | null {
  const text = input.text.trim().slice(0, CASE_NOTE_MAX_LENGTH);
  const patientId = input.patientId.trim();
  if (!text || !patientId) return null;
  const now = input.now ?? new Date();
  return {
    id: newId(),
    patientId,
    text,
    date: todayIso(now),
    author: input.author.trim(),
    authorUserId: input.authorUserId ?? "",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function addEntry(all: CaseNoteEntry[], entry: CaseNoteEntry): CaseNoteEntry[] {
  return [...all.filter((e) => e.id !== entry.id), entry];
}

/** Change an entry's text and/or date. Unknown id, empty text or a bad date leaves the list as is. */
export function updateEntry(
  all: CaseNoteEntry[],
  id: string,
  patch: { text?: string; date?: string },
  editedBy: string,
  now: Date = new Date(),
): CaseNoteEntry[] {
  return all.map((e) => {
    if (e.id !== id || e.deleted) return e;
    const text = patch.text === undefined ? e.text : patch.text.trim().slice(0, CASE_NOTE_MAX_LENGTH);
    const date = patch.date === undefined ? e.date : patch.date;
    if (!text || !isValidIsoDate(date)) return e;
    if (text === e.text && date === e.date) return e;
    return { ...e, text, date, editedBy: editedBy.trim(), updatedAt: now.toISOString() };
  });
}

/** Tombstone: hidden everywhere, text kept in the cloud so it can be restored. */
export function deleteEntry(all: CaseNoteEntry[], id: string, editedBy: string, now: Date = new Date()): CaseNoteEntry[] {
  return all.map((e) => (e.id === id && !e.deleted ? { ...e, deleted: true, editedBy: editedBy.trim(), updatedAt: now.toISOString() } : e));
}

export function restoreEntry(all: CaseNoteEntry[], id: string, editedBy: string, now: Date = new Date()): CaseNoteEntry[] {
  return all.map((e) => {
    if (e.id !== id || !e.deleted) return e;
    const { deleted: _deleted, ...rest } = e;
    void _deleted;
    return { ...rest, editedBy: editedBy.trim(), updatedAt: now.toISOString() };
  });
}

/**
 * Date: only the owner and Admins. Text and delete: the person who wrote it,
 * the owner and Admins. (Managers / Staff keep full control of their OWN notes.)
 */
export function canEditEntryDate(roleTier: string): boolean {
  return roleTier === "owner" || roleTier === "admin";
}

export function canEditEntryText(entry: Pick<CaseNoteEntry, "authorUserId">, userId: string | null | undefined, roleTier: string): boolean {
  if (canEditEntryDate(roleTier)) return true;
  return Boolean(userId) && entry.authorUserId === userId;
}

/** Merge-safe combine of this device's list with the cloud copy (nothing on either side is dropped). */
export function mergeEntries(local: CaseNoteEntry[], cloud: unknown): CaseNoteEntry[] {
  return normalizeEntries(unionMerge(local, normalizeEntries(cloud)));
}

/**
 * The name stamped on a note: "Dr. Mike" for doctors, first name + last
 * initial ("Hannah M.") for everyone else. Team members use the first / last
 * name saved on their Team Member record; the owner uses the office doctor name.
 */
export function authorDisplayName(input: {
  userId: string | null;
  isMember: boolean;
  memberLabel: string;
  memberFirstName?: string;
  memberLastName?: string;
  ownerName: string;
  doctors: Array<{ name: string; memberUserId?: string }>;
  email?: string;
}): string {
  const composed = `${(input.memberFirstName ?? "").trim()} ${(input.memberLastName ?? "").trim()}`.trim();
  const signer = signerFromLogin({
    userId: input.userId,
    isMember: input.isMember,
    memberLabel: composed || input.memberLabel,
    ownerName: input.ownerName,
    doctors: input.doctors,
    email: input.email,
  });
  const sig = signer ? signatureFor(signer).replace(/^-/, "") : "";
  if (sig) return sig;
  return input.isMember ? input.memberLabel.trim() || "Team Member" : input.ownerName.trim() || "Owner";
}

/** Plain text of the log (newest first) plus the old free-form notes, for G.O.A.T. and letter templates. */
export function caseNotesPlainText(entries: CaseNoteEntry[], legacy: string): string {
  const lines = entries.map((e) => `${formatEntryDate(e.date)} - ${e.text.replace(/\s*\n\s*/g, " ").trim()}${e.author ? ` -${e.author}` : ""}`);
  const old = legacy.trim();
  return [...lines, ...(old ? [old] : [])].join("\n");
}

/**
 * Save locally, then merge with the cloud copy before writing it (never drops
 * another person's notes). `cloudOk` is false when the cloud write failed: the
 * list is still on this device and the save queue retries it.
 */
export async function saveCaseNoteEntries(records: CaseNoteEntry[]): Promise<{ records: CaseNoteEntry[]; cloudOk: boolean }> {
  if (typeof window === "undefined") return { records, cloudOk: true };
  const cache = (v: CaseNoteEntry[]) => {
    try {
      window.localStorage.setItem(CASE_NOTE_ENTRIES_KEY, JSON.stringify(v));
    } catch {
      /* cache only; the cloud write below is the record */
    }
  };
  cache(records);
  try {
    const kv = await import("@/lib/kv-cloud");
    const remote = await kv.fetchKvValue<unknown>(CASE_NOTE_ENTRIES_KEY).catch(() => null);
    const merged = mergeEntries(records, remote);
    cache(merged);
    // OrThrow: a failed write is held and retried by the save queue (never silently dropped).
    await kv.dualWriteKvOrThrow(CASE_NOTE_ENTRIES_KEY, "tasks", merged);
    return { records: merged, cloudOk: true };
  } catch (err) {
    console.error("[case-note-entries] cloud save failed; kept on this device and queued:", err);
    return { records: loadCaseNoteEntries(), cloudOk: false };
  }
}
