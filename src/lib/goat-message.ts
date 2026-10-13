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
}

const TELL_RE = /^\s*(?:please\s+|can you\s+|pls\s+)?(?:tell|message|msg|text|ask|remind|ping|let)\s+([A-Za-z][A-Za-z'-]*)\s+(?:know\s+)?(?:that\s+|to\s+)?([\s\S]+?)\s*$/i;

export function isTellRequest(question: string): boolean {
  return /^\s*(?:please\s+|can you\s+|pls\s+)?(?:tell|message|msg|text|remind|ping)\s+[A-Za-z]|^\s*let\s+[A-Za-z]+\s+know\b/i.test(question);
}

/** { to, text, patientName } — patientName from "for / about / re <name>" when given. */
export function parseTell(question: string): { to: string; text: string; patientName: string | null } | null {
  const m = TELL_RE.exec(question);
  if (!m) return null;
  const to = m[1];
  if (/^(me|us|them|him|her|everyone|all)$/i.test(to)) return null;
  const text = m[2].trim();
  if (!text) return null;
  const p = /\b(?:for|about|re:?|regarding|on)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)\s*[.?!]*$/i.exec(text);
  const patientName = p ? p[1].replace(/'s$/i, "").replace(/\s+(today|tomorrow|asap|please|pls|now)$/i, "") : null;
  return { to, text, patientName };
}

/** Team members whose first name is that name (one-letter typos ok: "hanna" → Hannah). */
export function matchRecipient(name: string, team: TeamPerson[]): TeamPerson[] {
  const n = name.toLowerCase();
  const first = (p: TeamPerson) => p.firstName.toLowerCase();
  const exact = team.filter((p) => first(p) === n);
  if (exact.length) return dedupe(exact);
  return dedupe(team.filter((p) => n.length >= 4 && first(p).length >= 3 && editDistance(n, first(p)) <= 1));
}

function dedupe(list: TeamPerson[]): TeamPerson[] {
  const seen = new Map<string, TeamPerson>();
  for (const p of list) {
    const k = p.firstName.toLowerCase();
    const cur = seen.get(k);
    // The same person from the signatures list and a login: keep the one that can be notified.
    if (!cur || (!cur.userId && p.userId)) seen.set(k, { ...p, ...(cur && !p.userId ? { userId: cur.userId } : {}) });
  }
  return [...seen.values()];
}

/** The team to match against: the Note signatures list plus logins (first word of a person-like label, or the email name). */
export function buildTeam(signers: Array<{ firstName: string; userId?: string; doctor?: boolean }>, logins: Array<{ userId: string; label: string; email: string }>): TeamPerson[] {
  const out: TeamPerson[] = [];
  for (const s of signers) {
    const first = s.firstName.trim().replace(/^dr\.?\s+/i, "").split(/\s+/)[0];
    if (first) out.push({ firstName: first, label: s.doctor ? `Dr. ${first}` : first, userId: s.userId });
  }
  const ROLE = /\b(front|desk|admin|manager|billing|staff|team|member|office|reception|assistant|therapist|owner)\b/i;
  for (const l of logins) {
    const linked = out.find((p) => p.userId === l.userId);
    if (linked) continue;
    const fromLabel = !ROLE.test(l.label) ? l.label.trim().replace(/^dr\.?\s+/i, "").split(/\s+/)[0] : "";
    const fromEmail = /^[a-z]+(?=[._-]|@)/i.exec(l.email)?.[0] ?? "";
    const first = fromLabel || fromEmail;
    if (first) out.push({ firstName: first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(), label: l.label || first, userId: l.userId });
  }
  return out;
}

/** The message as posted: "@Hannah i need notes for John -Dr. Mike". */
export function messageBody(to: TeamPerson, text: string, signature: string): string {
  return `@${to.label} ${text.trim()}${signature ? ` ${signature}` : ""}`;
}
