/**
 * G.O.A.T. conversation memory for follow-ups. Pure (mock-testable).
 *
 * The chat remembers the last thing it DID (or is waiting on): a saved Case
 * Notes line, a team message (asked "which patient?", drafted or sent), or a
 * booking (open or booked). A short follow-up then acts on that thing:
 *   note:     "add it with yesterday's date", "change the date to 10/12",
 *             "undo that" / "delete it", "change it to …", "also add …"
 *   message:  "no patient" / "none" (after "which patient?"),
 *             "send it to Greg instead", "also tell Abi"
 *   booking:  "make it 2pm instead"
 * Anything else that is not clearly a file question gets a short, context-aware
 * clarification instead of "I couldn't find that in this patient's file".
 */

export type LastAct =
  | { kind: "note"; msgId: string; patientId: string; patientName: string; line: string }
  | { kind: "msgAsk"; msgId: string; toLabel: string; toUserId?: string; alsoTo?: Array<{ label: string; userId?: string }>; text: string }
  | { kind: "message"; msgId: string; toLabel: string; toUserId?: string; text: string; patientId?: string; patientName?: string; caseLabel?: string; state: "open" | "sent" | "canceled" }
  | { kind: "booking"; msgId: string; state: "open" | "booked" | "canceled" };

export type FollowUpAction =
  | { kind: "noteDate"; iso: string }
  | { kind: "noteDelete" }
  | { kind: "noteReplace"; text: string }
  | { kind: "noteAppend"; text: string }
  | { kind: "generalMessage" }
  | { kind: "messageTo"; to: string; mode: "instead" | "also" }
  | { kind: "bookingTime"; time: string }
  | { kind: "clarify"; say: string; choice?: { label: string; question: string } };

export const NOT_CAUGHT = "I didn't catch that. I can add notes, message the team, book, or look things up.";

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A past-leaning date in the text: today, yesterday, "2 days ago", 10/12, 10/12/26, 2026-10-12. */
export function noteDateIn(text: string, todayIso: string): string | null {
  const q = text.toLowerCase();
  if (/\b(yesterday|yesterdays|yday|yest)\b|yesterday'?s/.test(q)) return addDays(todayIso, -1);
  if (/\bday before yesterday\b/.test(q)) return addDays(todayIso, -2);
  const ago = /\b(\d+|two|three)\s+days?\s+ago\b/.exec(q);
  if (ago) return addDays(todayIso, -({ two: 2, three: 3 }[ago[1] as "two" | "three"] ?? Number(ago[1])));
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(q);
  if (iso) return iso[0];
  const md = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(q);
  if (md) {
    const ty = Number(todayIso.slice(0, 4));
    let y = md[3] ? Number(md[3].length === 2 ? `20${md[3]}` : md[3]) : ty;
    let out = `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    if (!md[3] && out > todayIso) out = `${(y = ty - 1)}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    return out;
  }
  if (/\btoday'?s?\b/.test(q)) return todayIso;
  return null;
}

/** "2026-10-13" → "10/13/26" (the Case Notes date). */
export function shortUs(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}`;
}

const LEAD_DATE = /^\s*\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*[AP]M)?\s*(?:-\s*)?/i;
const TRAIL_SIG = /\s+(-(?:Dr\.\s*)?[A-Z][\w'-]*(?:\s[A-Z]\.)?)\s*$/;

/** The same Case Notes line with a new date ("10/14/26 - X -Dr. Mike" → "10/13/26 - X -Dr. Mike"). */
export function withNoteDate(line: string, iso: string): string {
  return LEAD_DATE.test(line) ? line.replace(LEAD_DATE, `${shortUs(iso)} - `) : `${shortUs(iso)} - ${line}`;
}

/** The same line with new text, keeping its date and signature. */
export function withNoteText(line: string, text: string): string {
  const date = LEAD_DATE.exec(line)?.[0] ?? "";
  const sig = TRAIL_SIG.exec(line.replace(LEAD_DATE, ""))?.[1] ?? "";
  const t = text.trim().replace(/^i\s+(?=[a-z])/i, "");
  const body = t.charAt(0).toUpperCase() + t.slice(1);
  return `${date}${body}${sig ? ` ${sig}` : ""}`;
}

/** Replace (or, with null, remove) the LAST occurrence of `oldLine` in the Case Notes text. */
export function editNoteLine(notes: string, oldLine: string, newLine: string | null): string | null {
  const lines = notes.split("\n");
  const i = lines.lastIndexOf(oldLine);
  if (i < 0) return null;
  if (newLine === null) lines.splice(i, 1);
  else lines[i] = newLine;
  return lines.join("\n");
}

const DATE_VERB = /\b(change|fix|set|make|put|move|use|switch|update|redate|re-date|backdate|add|save|date)\b.*\b(date|dated|day|yesterday|today|\d{1,2}\/\d{1,2})|\bwith\b.*\b(date|yesterday|\d{1,2}\/\d{1,2})|\b(should (?:be|have been)|was (?:actually )?(?:on|for))\b.*\b(yesterday|\d{1,2}\/\d{1,2})|^(date|dated)\b/i;
const UNDO = /^(?:please\s+|pls\s+|actually\s+|oops,?\s+)?(?:undo(?:\s+(?:that|it|the note|this))?|delete\s+(?:it|that|the note|this(?: note)?)|remove\s+(?:it|that|the note|this(?: note)?)|take\s+(?:it|that)\s+(?:out|off|back)|scratch\s+that|never ?mind,? delete it)\b/i;
const REPLACE = /^(?:please\s+|actually\s+)?(?:change|edit|reword|replace|update)\s+(?:it|that|the note|this|the text)\s+to\s*[:\-]?\s*([\s\S]+)$|^(?:it\s+should\s+say|make\s+it\s+say|should\s+say|instead\s+say)\s*[:\-]?\s*([\s\S]+)$/i;
const APPEND = /^(?:please\s+|and\s+|oh\s+and\s+)?(?:also\s+)?(?:add|put|write|note)\s+(?:also\s+)?(?:that\s+)?([\s\S]+)$/i;
const APPEND_ALSO = /^(?:and\s+|oh\s+and\s+)?also\b/i;
const NO_PATIENT = /^(?:no(?:ne)?|nobody|no one|n\/a|na|nope|not (?:about )?(?:a |any )?patients?|no patients?|(?:it'?s |its )?(?:just )?(?:a )?general(?: message)?|(?:it'?s )?not (?:about|for) (?:a |any )?(?:patient|one)|nothing|no one in particular|just send it|send it(?: anyway)?)[.!]*$/i;
const SEND_INSTEAD = /^(?:no,?\s+|actually,?\s+)?(?:send|give|forward|message|msg|tell|text)\s+(?:it\s+|that\s+|this\s+)?(?:to\s+)?([a-z][a-z.'-]*)\s+instead\b|^(?:no,?\s+|actually,?\s+)?(?:to\s+)?([a-z][a-z.'-]*)\s+instead\b|^(?:wrong person|not (?:her|him)),?\s+(?:send it to\s+|i meant\s+)?([a-z][a-z.'-]*)$/i;
const ALSO_TELL = /^(?:cc|copy|loop in)\s+([a-z][a-z.'-]*)(?:\s+(?:on it|in|too))?$|^(?:and\s+)?(?:also|and)\s+(?:tell|send(?:\s+it)?\s+to|message|msg|cc|copy|loop in|let)\s+([a-z][a-z.'-]*)(?:\s+know)?\b|^(?:send|copy|cc)\s+(?:it\s+|that\s+)?(?:to\s+)?([a-z][a-z.'-]*)\s+too\b|^([a-z][a-z.'-]*)\s+too$/i;
const TIME_CHANGE = /^(?:no,?\s+|actually,?\s+)?(?:make|change|move|switch|push|bump)\s+(?:it|that|the time|the appt|the appointment)\s+(?:to\s+)?(?:at\s+)?([0-9]{1,2}(?::[0-9]{2})?\s*(?:a|p|am|pm)?)(?:\s+instead)?\.?$|^(?:no,?\s+|actually,?\s+)?(?:at\s+)?([0-9]{1,2}(?::[0-9]{2})?\s*(?:a|p|am|pm)?)\s+instead\.?$|^(?:how about|what about|can we do|let'?s do)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:a|p|am|pm)?)\??$/i;

/** What a follow-up means for the last action, or null (not a follow-up: route it normally). */
export function followUpFor(text: string, last: LastAct | null, todayIso: string): FollowUpAction | null {
  if (!last) return null;
  const q = text.trim().replace(/\s+/g, " ");
  if (!q) return null;
  if (last.kind === "note") {
    if (UNDO.test(q)) return { kind: "noteDelete" };
    const rep = REPLACE.exec(q);
    if (rep && !noteDateIn(q, todayIso)) return { kind: "noteReplace", text: (rep[1] ?? rep[2]).trim() };
    const iso = noteDateIn(q, todayIso);
    if (iso && DATE_VERB.test(q) && !APPEND_ALSO.test(q)) return { kind: "noteDate", iso };
    if (APPEND_ALSO.test(q) || /^(?:add|put|write)\s+(?:that\s+)?\S/i.test(q)) {
      const m = APPEND.exec(q.replace(APPEND_ALSO, "").trim().replace(/^add\b/i, "add")) ?? APPEND.exec(q);
      const t = (m?.[1] ?? q.replace(APPEND_ALSO, "")).trim().replace(/^(?:to (?:it|the note|that)[:,]?\s*)/i, "");
      // "also add that she called back" — not a new patient note ("add a note for kara…").
      if (t && !/^(?:a\s+)?note\s+(?:for|to|on)\b/i.test(t)) return { kind: "noteAppend", text: t };
    }
    if (iso && q.split(" ").length <= 6) return { kind: "clarify", say: `Want me to change the date on the note I just added to ${shortUs(iso)}?`, choice: { label: `Yes, change it to ${shortUs(iso)}`, question: `change the date to ${shortUs(iso)}` } };
    return null;
  }
  if (last.kind === "msgAsk") {
    if (NO_PATIENT.test(q)) return { kind: "generalMessage" };
    return null;
  }
  if (last.kind === "message") {
    const also = ALSO_TELL.exec(q);
    if (also) return { kind: "messageTo", to: (also[1] ?? also[2] ?? also[3] ?? also[4]).trim(), mode: "also" };
    const ins = SEND_INSTEAD.exec(q);
    if (ins) return { kind: "messageTo", to: (ins[1] ?? ins[2] ?? ins[3]).trim(), mode: "instead" };
    return null;
  }
  if (last.kind === "booking" && last.state !== "canceled") {
    const t = TIME_CHANGE.exec(q);
    if (t) return { kind: "bookingTime", time: (t[1] ?? t[2] ?? t[3]).trim() };
  }
  return null;
}

/** Context-aware "didn't catch that" for a message that isn't a file question. */
export function clarifyFor(last: LastAct | null): string {
  if (last?.kind === "note") return `I didn't catch that. Want me to change the date or the text of the note I just added for ${last.patientName}, or undo it? I can also add notes, message the team, book, or look things up.`;
  if (last?.kind === "message") return `I didn't catch that. I can send that message to someone else ("send it to Greg instead"), or add notes, book, or look things up.`;
  if (last?.kind === "booking") return `I didn't catch that. I can change the time ("make it 2pm instead"), or add notes, message the team, or look things up.`;
  return NOT_CAUGHT;
}
