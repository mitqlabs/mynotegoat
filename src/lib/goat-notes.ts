/**
 * "add note to kara's file: spoke to atty, waiting for reduction" → a preview,
 * saved to the patient's Notes only after Confirm, signed " -Dr. Mike" (doctors)
 * or " -Hannah" (everyone else), with a timestamp.
 *
 * Accounts: NoteGoat has per-user logins (workspace members), but a member's
 * record only carries a role label ("Front Desk"), not a first name or whether
 * they're a doctor. So signatures come from a small team list in G.O.A.T.
 * Settings (first name + Doctor flag), optionally linked to a login. The linked
 * login signs automatically; otherwise the note card shows "Signed as".
 * The list is kept in this browser only (nothing new goes to the cloud).
 */
import { editDistance } from "@/lib/goat-ai/global-chat";

export interface NoteSigner {
  id: string;
  firstName: string;
  doctor: boolean;
  /** Login (auth user id) this person signs in with, if linked. */
  userId?: string;
}

export const SIGNERS_KEY = "notegoat.note-signers.v1";
export const LAST_SIGNER_KEY = "notegoat.note-signer-last.v1";

const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : "");

/** "-Dr. Mike" for doctors, "-Hannah M." for everyone else (first name + last initial). */
export function signatureFor(s: Pick<NoteSigner, "firstName" | "doctor">): string {
  const parts = s.firstName.trim().replace(/^dr\.?\s+/i, "").split(/\s+/).filter(Boolean);
  const first = cap(parts[0] ?? "");
  if (!first) return "";
  if (s.doctor) return `-Dr. ${first}`;
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return last ? `-${first} ${last.charAt(0).toUpperCase()}.` : `-${first}`;
}

/** Words in a member label that are a role, not a name ("Front Desk"). */
const ROLE_LABEL = /\b(front|desk|admin|manager|billing|staff|team|member|office|reception|receptionist|assistant|therapist|owner|biller|scheduler)\b/i;

/**
 * Who signs a note, derived from the logged-in login (no setup):
 *  - a team member: their roster name (member label), Doctor if they're on the office's doctor list;
 *  - the owner (no member record): the profile / office doctor name.
 */
export function signerFromLogin(input: {
  userId: string | null;
  isMember: boolean;
  memberLabel: string;
  ownerName: string;
  doctors: Array<{ name: string; memberUserId?: string }>;
  email?: string;
}): Pick<NoteSigner, "firstName" | "doctor"> | null {
  const doc = input.userId ? input.doctors.find((d) => d.memberUserId === input.userId) : undefined;
  let name = "";
  if (input.isMember) name = input.memberLabel && !ROLE_LABEL.test(input.memberLabel) ? input.memberLabel : doc?.name ?? "";
  else name = input.ownerName || doc?.name || "";
  if (!name && input.email) name = /^[a-z]+/i.exec(input.email)?.[0] ?? "";
  name = name.trim();
  if (!name) return null;
  const doctor = Boolean(doc) || (!input.isMember && /^dr\.?\s/i.test(input.ownerName.trim()));
  return { firstName: name.replace(/^dr\.?\s+/i, ""), doctor };
}

/** MM/DD/YY, the date the existing Case Notes use. */
function stamp(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${String(d.getFullYear() % 100).padStart(2, "0")}`;
}

/** Note text as the existing Case Notes read: no leading "i ", first letter capitalized. */
export function tidyNoteText(text: string): string {
  let t = text.trim().replace(/\s+-\s*$/, "").replace(/\s+/g, " ");
  t = t.replace(/^i\s+(?=[a-z])/i, "");
  return cap(t);
}

/** One note line: "10/14/26 - Spoke to atty about red req -Dr. Mike" (date only, no time). */
export function formatNote(text: string, signer: Pick<NoteSigner, "firstName" | "doctor"> | null, at: Date): string {
  const body = tidyNoteText(text);
  const sig = signer ? signatureFor(signer) : "";
  return `${stamp(at)} - ${body}${sig ? ` ${sig}` : ""}`;
}

/**
 * Drop the patient's name words (typos too: "eliliot" for Elliott) from the
 * start of the note text, so "collin eliliot i spoke to atty" → "i spoke to atty".
 */
export function stripNameTokens(text: string, fullName: string): string {
  const parts = fullName.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(Boolean);
  const ws = text.trim().split(/\s+/);
  let i = 0;
  while (i < ws.length) {
    const w = ws[i].toLowerCase().replace(/[^a-z']/g, "").replace(/'s$/, "");
    const hit = w && parts.some((p) => p === w || (w.length >= 4 && p.length >= 4 && w[0] === p[0] && editDistance(w, p) <= (p.length >= 5 ? 2 : 1)));
    if (!hit) break;
    i++;
  }
  return ws.slice(i).join(" ").replace(/^[\s,:;\-–—]+/, "");
}

/** The Notes box with the new line added at the end (blank line kept tidy). */
export function appendNote(existing: string, line: string): string {
  const cur = existing.replace(/\s+$/, "");
  return cur ? `${cur}\n${line}` : line;
}

const ADD_NOTE_RE =
  /^\s*(?:please\s+|can you\s+)?(?:add|put|write|leave|make|log)\s+(?:a\s+|this\s+)?note\s+(?:to|on|in|into|for)\s+(.+?)\s*(?:'s|’s|s')?\s*(?:file|chart|notes?|case)?\s*[:\-–—]\s*([\s\S]+)$/i;
const NOTE_FOR_RE = /^\s*note\s+(?:for|to|on)\s+(.+?)\s*(?:'s|’s|s')?\s*(?:file|chart|notes?)?\s*[:\-–—]\s*([\s\S]+)$/i;

/** { name, text } when the message asks to add a note to a patient's file. */
export function parseAddNote(question: string): { name: string; text: string } | null {
  const m = ADD_NOTE_RE.exec(question) ?? NOTE_FOR_RE.exec(question);
  if (!m) return null;
  const name = m[1].replace(/\b(the|patient|file|chart)\b/gi, "").replace(/['’]s$/i, "").trim();
  const text = m[2].trim();
  return name && text ? { name, text } : null;
}

export function isAddNoteRequest(question: string): boolean {
  return /^\s*(?:please\s+|can you\s+)?(?:add|put|write|leave|make|log)\s+(?:a\s+|this\s+)?note\b|^\s*note\s+(?:for|to|on)\b/i.test(question);
}

/**
 * Patients the name means, by first OR last name (typo tolerant). A full-name
 * match wins outright; otherwise every patient whose first or last name fits.
 */
export function matchPatientsByName<T extends { id: string; fullName: string }>(name: string, patients: T[]): T[] {
  const ws = name.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(Boolean);
  if (!ws.length) return [];
  const parts = (p: T) => p.fullName.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(Boolean);
  const exactAll = patients.filter((p) => ws.every((w) => parts(p).includes(w)));
  if (ws.length > 1 && exactAll.length) return exactAll;
  const exact = patients.filter((p) => ws.some((w) => parts(p).includes(w)));
  if (exact.length) return exact;
  return patients.filter((p) => ws.some((w) => w.length >= 4 && parts(p).some((x) => x.length >= 4 && editDistance(w, x) <= 1)));
}

export function loadSigners(): NoteSigner[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(window.localStorage.getItem(SIGNERS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((s) => s && typeof s.firstName === "string").map((s) => ({ id: String(s.id), firstName: s.firstName, doctor: Boolean(s.doctor), userId: s.userId || undefined })) : [];
  } catch {
    return [];
  }
}

export function saveSigners(list: NoteSigner[]) {
  window.localStorage.setItem(SIGNERS_KEY, JSON.stringify(list));
}

/** The logged-in person's signer (linked login), else the last one picked here. */
export function defaultSigner(list: NoteSigner[], userId: string | null, lastId: string | null): { signer: NoteSigner | null; linked: boolean } {
  const linked = userId ? list.find((s) => s.userId === userId) : undefined;
  if (linked) return { signer: linked, linked: true };
  return { signer: list.find((s) => s.id === lastId) ?? (list.length === 1 ? list[0] : null), linked: false };
}
