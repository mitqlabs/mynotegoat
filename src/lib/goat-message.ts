import { findNameAnywhere } from "@/lib/goat-commands";
/**
 * "tell hanna i need notes for John" → a team message about John's case,
 * previewed first and posted to NoteGoat Messages only after Confirm.
 */
import { editDistance } from "@/lib/goat-ai/global-chat";

export interface TeamPerson {
  /** First name used to match "tell <name>". */
  firstName: string;
  /** Shown on the card / @mention ("Hannah", "Front Desk"). */
  label: string;
  /** Login to @mention (notified); missing = can't be notified directly. */
  userId?: string;
  /** Last name, so "Dr. Mitchell" finds Dr. Abi Mitchell. */
  lastName?: string;
  /** A doctor ("Dr. <First>" / "Dr. <Last>" match them). */
  doctor?: boolean;
}

/** "tell Dr. Abi …" → "tell dr-Abi …" so the recipient stays one word (only near the start). */
export function joinDrTitle(q: string): string {
  return q.replace(/^(\s*(?:\S+\s+){0,3}?)dr\.?\s+(?=[a-z])/i, "$1dr-");
}

const TELL_RE = /^\s*(?:please\s+|can you\s+|pls\s+)?(?:tell|message|msg|text|ask|remind|ping|let)\s+([A-Za-z][A-Za-z'-]*)\s+(?:know\s+)?(?:that\s+|to\s+)?([\s\S]+?)\s*$/i;

export function isTellRequest(question: string): boolean {
  return /^\s*(?:please\s+|can you\s+|pls\s+)?(?:tell|message|msg|text|remind|ping)\s+[A-Za-z]|^\s*let\s+[A-Za-z]+\s+know\b/i.test(question);
}

/** { to, text, patientName } — patientName from "for / about / re <name>" when given. */
export function parseTell(question: string): { to: string; text: string; patientName: string | null } | null {
  const m = TELL_RE.exec(joinDrTitle(question));
  if (!m) return null;
  const to = m[1].replace(/^dr-/i, "Dr. ");
  if (/^(me|us|them|him|her|everyone|all)$/i.test(to)) return null;
  const text = m[2].trim();
  if (!text) return null;
  const p = /\b(?:for|about|re:?|regarding|on)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)\s*[.?!]*$/i.exec(text);
  const patientName = p ? p[1].replace(/'s$/i, "").replace(/\s+(today|tomorrow|asap|please|pls|now)$/i, "") : null;
  return { to, text, patientName };
}

/** Team members whose first name is that name (one-letter typos ok: "hanna" → Hannah). */
export function matchRecipient(name: string, team: TeamPerson[]): TeamPerson[] {
  const raw = name.toLowerCase().trim();
  const dr = /^dr[.-]?\s*/.test(raw);
  const n = raw.replace(/^dr[.-]?\s*/, "").replace(/\s+/g, " ");
  const first = (p: TeamPerson) => p.firstName.toLowerCase();
  const last = (p: TeamPerson) => (p.lastName ?? "").toLowerCase();
  const pool = dr && team.some((p) => p.doctor) ? team.filter((p) => p.doctor) : team;
  const [w1, w2] = n.split(" ");
  // "abi mitchell": first + last.
  if (w2) {
    const both = pool.filter((p) => first(p) === w1 && last(p) === w2);
    if (both.length) return dedupe(both);
  }
  const exact = pool.filter((p) => first(p) === w1);
  if (exact.length) return dedupe(exact);
  // "Dr. Mitchell" (or just "Mitchell"): the last name.
  const byLast = pool.filter((p) => last(p) && last(p) === w1);
  if (byLast.length) return dedupe(byLast);
  return dedupe(pool.filter((p) => w1.length >= 4 && first(p).length >= 3 && editDistance(w1, first(p)) <= 1));
}

function dedupe(list: TeamPerson[]): TeamPerson[] {
  // The same person from the signatures list and a login: keep the one that can be notified.
  // Two different logins with the same first name (two Hannahs) both stay, so the chat can ask which.
  const out: TeamPerson[] = [];
  for (const p of list) {
    const k = p.firstName.toLowerCase();
    const same = out.filter((x) => x.firstName.toLowerCase() === k);
    if (p.userId && same.some((x) => x.userId === p.userId)) continue;
    if (!p.userId && same.length) continue;
    const unlinked = same.find((x) => !x.userId);
    if (p.userId && unlinked) {
      out[out.indexOf(unlinked)] = { ...unlinked, ...p };
      continue;
    }
    out.push(p);
  }
  return out;
}

/** The team to match against: the Note signatures list plus logins (first word of a person-like label, or the email name). */
export function buildTeam(signers: Array<{ firstName: string; userId?: string; doctor?: boolean }>, logins: Array<{ userId: string; label: string; email: string; doctor?: boolean }>): TeamPerson[] {
  const out: TeamPerson[] = [];
  for (const s of signers) {
    const first = s.firstName.trim().replace(/^dr\.?\s+/i, "").split(/\s+/)[0];
    if (first) out.push({ firstName: first, label: s.doctor ? `Dr. ${first}` : first, userId: s.userId, doctor: Boolean(s.doctor) });
  }
  const ROLE = /\b(front|desk|admin|manager|billing|staff|team|member|office|reception|assistant|therapist|owner)\b/i;
  for (const l of logins) {
    const linked = out.find((p) => p.userId === l.userId);
    if (linked) continue;
    const fromLabel = !ROLE.test(l.label) ? l.label.trim().replace(/^dr\.?\s+/i, "").split(/\s+/)[0] : "";
    const fromEmail = /^[a-z]+(?=[._-]|@)/i.exec(l.email)?.[0] ?? "";
    const first = fromLabel || fromEmail;
    const nameParts = fromLabel ? l.label.trim().replace(/^dr\.?\s+/i, "").split(/\s+/) : [];
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined;
    const doctor = /^dr\.?\s/i.test(l.label.trim()) || Boolean(l.doctor);
    if (first) out.push({ firstName: first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(), label: l.label || first, userId: l.userId, lastName, doctor });
  }
  return out;
}

/** The message as posted: "@Hannah i need notes for John". No signature: the sender's name already shows on the message. */
export function messageBody(to: TeamPerson, text: string): string {
  return `@${to.label} ${text.trim()}`;
}

export type MessageAudience = "eyes-only" | "general";

/** Eyes only → private to the recipient (author is added by postMessage); General → everyone. */
export function privateToFor(audience: MessageAudience, toUserId?: string): string[] | undefined {
  return audience === "eyes-only" && toUserId ? [toUserId] : undefined;
}

/** Choice labels shown before sending. */
export function audienceLabel(audience: MessageAudience, toLabel: string): string {
  return audience === "eyes-only" ? `Eyes only (just ${toLabel})` : "General";
}

/**
 * Patients a team message's text actually names (strict: exact names or one
 * typo; everyday words like "hey", "how", "testing" never match). Empty → a
 * general team message with no patient. Active cases win over inactive ones.
 */
export function patientsMentionedInMessage<T extends { id: string; fullName: string; caseStatus?: string }>(text: string, pool: T[]): T[] {
  const active = (p: T) => !/^(dropped|paid|discharged)$/i.test(p.caseStatus ?? "");
  const hit = findNameAnywhere(text, pool.map((p) => ({ id: p.id, fullName: p.fullName, active: active(p) })));
  if (!hit) return [];
  const ids = hit.matches.filter((m) => m.active).length ? hit.matches.filter((m) => m.active).map((m) => m.id) : hit.matches.map((m) => m.id);
  return pool.filter((p) => ids.includes(p.id));
}
