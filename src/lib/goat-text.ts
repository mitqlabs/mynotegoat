/**
 * G.O.A.T. "/text": who gets a text, and what it says (rules only, pure, offline).
 *
 *  /text                          → "Who should get the text?" (buttons)
 *  text all active patients that we're closed Friday → audience + message found
 *  text everyone "Hey, we're closed tomorrow"        → "everyone" is AMBIGUOUS:
 *        G.O.A.T. asks "All active patients or everyone scheduled tomorrow?"
 *  text Ann Sample that her visit moved               → a patient (always confirmed with a button)
 *
 * This file only reads words. It never sends, never touches the database and never
 * decides a patient: the flow (goat-slash-flow.ts) turns the result into buttons / a
 * confirm card, and nothing leaves the office until the Send button is clicked.
 */
import { findDate } from "@/lib/goat-understand";

/** Who a text goes to. "booked" = patients with a visit on `date`; "patients" = exact patients already chosen. */
export type TextAudience =
  | { kind: "active" }
  | { kind: "booked"; date: string }
  | { kind: "patients"; ids: string[]; label: string };

/** One read of a typed request. */
export interface TextParse {
  /** The audience, when the words were unambiguous. */
  audience: TextAudience | null;
  /** "everyone" / "all patients": must ask All active vs Scheduled <day>. */
  ambiguous: boolean;
  /** "Scheduled" named but no day: must ask which day. */
  needsDay: boolean;
  /** A day mentioned anywhere (the message) that the "Scheduled …" button should offer. */
  dateHint?: string;
  /** Text left over that may start with a patient's name ("Ann Sample that her visit moved"). */
  nameRest: string;
  /** The message to send ("" when none was given). */
  message: string;
}

/** SMS one-segment-ish limit the composer uses. */
export const TEXT_MAX = 640;

const POLITE = String.raw`(?:(?:hey|hi|ok|okay|so|goat|g\.o\.a\.t\.?|please|pls|plz|can\s+you|could\s+you|would\s+you|will\s+you|i(?:'d|\s+would)?\s+(?:want|need|like)\s+to|i\s+wanna|we\s+need\s+to|let's|lets|go\s+ahead\s+and|just)[\s,]+)*`;
const TEXTVERB = String.raw`(?:text|txt|sms)`;
const WEAKVERB = String.raw`(?:message|msg|notify|sms|text)`;

const FORMS: Array<{ re: RegExp; join: (m: RegExpExecArray) => string; weak?: boolean }> = [
  // text … / txt … / sms …
  { re: new RegExp(String.raw`^${POLITE}${TEXTVERB}(?:\s+out)?\s+(.+)$`, "i"), join: (m) => m[1] },
  // send (out) a text (message) (to) …
  { re: new RegExp(String.raw`^${POLITE}send\s+(?:out\s+)?(?:a\s+|an\s+|the\s+)?(?:text|sms|txt)(?:\s+message)?\s+(?:out\s+)?(?:to\s+)?(.+)$`, "i"), join: (m) => m[1] },
  // send everyone a text (that) …
  { re: new RegExp(String.raw`^${POLITE}send\s+(.+?)\s+(?:a\s+|an\s+)?(?:text|sms|txt)(?:\s+message)?\b[\s,:]*(.*)$`, "i"), join: (m) => `${m[1]} ${m[2] ?? ""}` },
  // message all active patients … (only a patient audience: "message hannah" is a team message)
  { re: new RegExp(String.raw`^${POLITE}${WEAKVERB}\s+(?:out\s+)?(.+)$`, "i"), join: (m) => m[1], weak: true },
  // let / tell all patients (know) …
  { re: new RegExp(String.raw`^${POLITE}(?:let|tell)\s+((?:all(?:\s+of)?\s+(?:the\s+|my\s+|our\s+)?(?:active\s+)?patients?|(?:all\s+|every\s+)?active\s+patients?|(?:all\s+)?(?:scheduled|booked)\s+patients?|patients?\s+(?:scheduled|booked)\s+\S+)\b)\s+(?:know\s+)?(.*)$`, "i"), join: (m) => `${m[1]} ${m[2] ?? ""}`, weak: true },
];

const QUESTION = /^(?:how|what|whats|what's|where|who|why|when|which|does|do|is|are|should|will|did|was)\b/i;

const DAYWORD = String.raw`(?:today|tonight|tomorrow|tmrw|tmw|tomorow|day\s+after\s+tomorrow|(?:next\s+|this\s+|on\s+)?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)`;
const ACTIVE_RE = /^(?:(?:all|every)(?:\s+of)?\s+(?:(?:my|our|the)\s+)?)?(?:current(?:ly)?\s+)?active(?:\s+(?:patients?|pts?|cases?|clients?))?\b/i;
const BOOKED_VERB = String.raw`(?:scheduled|booked|coming\s+in|on\s+the\s+schedule|with\s+(?:an?\s+)?(?:appointments?|appts?)|having\s+(?:an?\s+)?(?:appointments?|appts?)|seen|visiting)`;
const BOOKED_RE = new RegExp(
  String.raw`^(?:` +
    String.raw`(?:everyone|everybody|anyone|all(?:\s+of)?\s+(?:the\s+|my\s+|our\s+)?(?:patients?|pts?|people)|(?:the\s+)?(?:patients?|pts?|people)|all)\s*(?:who(?:\s+is|\s+are|'s)?\s+|that(?:\s+is|\s+are|'s)?\s+|are\s+|is\s+)?${BOOKED_VERB}\b` +
    String.raw`|(?:all\s+)?(?:the\s+)?${BOOKED_VERB}\s+(?:patients?|pts?)\b` +
    String.raw`)(?:\s+(?:for|on|that\s+day))?`,
  "i",
);
const POSSESSIVE_DAY_RE = /^(?:all\s+)?(?:the\s+)?(today|tomorrow|tmrw|tmw)(?:'s|s)?\s+(?:patients?|pts?|appointments?|appts?)\b/i;
const AMBIG_RE = /^(?:everyone|everybody|all(?:\s+of)?\s+(?:(?:my|our|the)\s+)?(?:patients?|pts?|people|clients?)|every\s+(?:single\s+)?(?:patient|pt|one)|(?:my|our|the)\s+patients|patients|all)\b/i;
const LEAD_DAY_RE = new RegExp(String.raw`^\s*(?:(?:for|on|that\s+day|are|is)\s+)?(${DAYWORD})\b`, "i");

/** "tmrw" → "tomorrow" so the shared date reader understands texting shorthand. */
const dayWord = (w: string) => w.replace(/\b(?:tmrw|tmw|tomorow)\b/i, "tomorrow");

/** Today / tomorrow / "Fri 10/30" for button labels and cards. */
export function dayLabel(iso: string, today: string): string {
  if (iso === today) return "today";
  const t = new Date(`${today}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  if (iso === t.toISOString().slice(0, 10)) return "tomorrow";
  return `${new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`))} ${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

/** Same, for a sentence: "scheduled today" / "scheduled on Fri 10/30". */
export const dayPhrase = (iso: string, today: string) => {
  const l = dayLabel(iso, today);
  return l === "today" || l === "tomorrow" ? l : `on ${l}`;
};

/** A human label for an audience ("All active patients", "Everyone scheduled tomorrow"). */
export function audienceLabel(a: TextAudience, today: string): string {
  if (a.kind === "active") return "All active patients";
  if (a.kind === "booked") return `Everyone scheduled ${dayPhrase(a.date, today)}`;
  return a.label;
}

const MONTH_OR_DAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december)\b/gi;

/** Light clean-up of a typed message: trim, one space, capital first letter and weekday names. Never rewrites the words. */
export function tidyTextMessage(raw: string): string {
  let m = raw.replace(/\s+/g, " ").trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  m = m.replace(MONTH_OR_DAY, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return m ? m[0].toUpperCase() + m.slice(1) : "";
}

/** A quoted message anywhere in the text: "…", “…” or a trailing '…'. */
function takeQuoted(text: string): { quoted: string; rest: string } | null {
  const dq = /["“]([\s\S]+)["”]/.exec(text);
  if (dq && dq[1].trim().length >= 2) return { quoted: dq[1], rest: (text.slice(0, dq.index) + " " + text.slice(dq.index + dq[0].length)).trim() };
  const sq = /(?:^|\s)['‘](.{3,})['’]\s*[.!]?$/.exec(text);
  if (sq) return { quoted: sq[1], rest: text.slice(0, sq.index).trim() };
  return null;
}

/** Words that join "<audience> … <message>": "that", "saying", "to say", "tell them", ":" … */
const CONNECTORS = /^[\s,:;\-–—]*(?:and\s+)?(?:(?:to\s+)?(?:say|saying|tell\s+them|telling\s+them|let\s+them\s+know|know|that|the\s+following|message)\b[\s,:;\-–—]*)*/i;
const stripConnectors = (s: string) => s.replace(CONNECTORS, "").trim();

/** Which words start the audience part of `rest`? Returns what it means and where it ends. */
function readAudience(rest: string, today: string): { kind: "active" | "booked" | "ambiguous"; date?: string; end: number } | null {
  const lead = rest.replace(/^\s+/, "");
  const off = rest.length - lead.length;
  let m = ACTIVE_RE.exec(lead);
  if (m) return { kind: "active", end: off + m[0].length };
  m = POSSESSIVE_DAY_RE.exec(lead);
  if (m) {
    const hit = findDate(dayWord(m[1]), today);
    return { kind: "booked", date: hit?.iso, end: off + m[0].length };
  }
  m = BOOKED_RE.exec(lead);
  if (m) {
    const end = off + m[0].length;
    const d = LEAD_DAY_RE.exec(rest.slice(end));
    if (d) {
      const hit = findDate(dayWord(d[1]), today);
      return { kind: "booked", date: hit?.iso, end: end + d[0].length };
    }
    return { kind: "booked", end };
  }
  m = AMBIG_RE.exec(lead);
  if (m) {
    const end = off + m[0].length;
    // "everyone tomorrow" / "all patients friday" = the people booked that day.
    const d = LEAD_DAY_RE.exec(rest.slice(end));
    if (d && !/^(?:are|is|on|for|that)\b/i.test(d[0].trim()) ) {
      const hit = findDate(dayWord(d[1]), today);
      if (hit) return { kind: "booked", date: hit.iso, end: end + d[0].length };
    }
    return { kind: "ambiguous", end };
  }
  return null;
}

/**
 * Read "<verb> <who> <message>" after the verb has been taken off.
 * `weak` verbs (message/notify) only count when the words name a group of patients.
 */
export function parseTextRest(restIn: string, today: string, opts: { weak?: boolean } = {}): TextParse | null {
  let rest = restIn.trim();
  if (!rest) return null;
  const q = takeQuoted(rest);
  let message = "";
  if (q) {
    message = q.quoted;
    rest = q.rest;
  }
  const aud = readAudience(rest, today);
  if (aud) {
    const tail = stripConnectors(rest.slice(aud.end));
    if (!q) message = tail;
    // A day typed in the message ("closed Friday") is what the "Scheduled…" button offers.
    const hint = aud.kind === "ambiguous" ? findDate(dayWord(message || rest), today)?.iso : undefined;
    const base = { nameRest: "", message: tidyTextMessage(message) };
    if (aud.kind === "active") return { ...base, audience: { kind: "active" }, ambiguous: false, needsDay: false };
    if (aud.kind === "booked") {
      return aud.date
        ? { ...base, audience: { kind: "booked", date: aud.date }, ambiguous: false, needsDay: false }
        : { ...base, audience: null, ambiguous: false, needsDay: true };
    }
    return { ...base, audience: null, ambiguous: true, needsDay: false, dateHint: hint };
  }
  if (opts.weak) return null;
  const nameRest = rest.trim();
  if (!nameRest && !message) return null;
  return { audience: null, ambiguous: false, needsDay: false, nameRest, message: tidyTextMessage(message) };
}

/**
 * Is this typed line a request to text patients ("text everyone …", "send a text to all
 * active patients …")? Returns what was understood, or null (not a text request, a how-do-I
 * question, or nothing that names a group). When `nameRest` is set the caller must still
 * confirm a patient exists with that name before claiming the line.
 */
export function parseTextRequest(raw: string, today: string): TextParse | null {
  const line = raw.trim();
  if (!line || line.startsWith("/") || line.startsWith("@")) return null;
  if (QUESTION.test(line.replace(new RegExp(`^${POLITE}`, "i"), ""))) return null; // "how do I text everyone" → help, not a command
  if (!takeQuoted(line) && /\?\s*$/.test(line)) return null; // "how do I text everyone?"
  for (const f of FORMS) {
    const m = f.re.exec(line);
    if (!m) continue;
    const r = parseTextRest(f.join(m), today, { weak: f.weak });
    if (r) return r;
  }
  return null;
}

/** The message a "we're closed" text should start from after a bulk cancel (the user can edit it). */
export function suggestedCancelText(date: string, today: string): string {
  return `Our office needs to cancel your appointment ${dayPhrase(date, today)}. We're sorry for the trouble and will contact you to reschedule.`;
}
