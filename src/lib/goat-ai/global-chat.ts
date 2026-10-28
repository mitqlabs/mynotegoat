import { acceptHits, isNeverName, isShortTypo, matchNameToken, type TokenHit } from "@/lib/goat-name-guard";
import type { OfficeMemory } from "@/lib/goat-office";
import type { BookingDraft } from "@/lib/goat-booking";
import type { OmPlan } from "@/lib/goat-om";
import type { OmSnapshot } from "@/lib/goat-om-apply";
/**
 * Global G.O.A.T. (sidebar popup) — who is the question about, and the chat
 * history. Pure helpers plus browser-only storage.
 *
 * Patient lookup only reads the patient LIST (names, birth dates, dates of
 * injury). No patient's file is opened until exactly one patient is chosen.
 *
 * Chat history stays in this browser only (localStorage, per workspace). It is
 * deliberately NOT a "casemate.*" key, because those are pushed to the cloud;
 * it is cleared on sign-out and when the workspace changes (cloud-state.ts).
 */

import { caseNumberOf } from "@/lib/follow-up-queue";
import { activeFirst, isActiveCase } from "@/lib/patient-name-match";

export interface ChatPatient {
  id: string;
  fullName: string;
  dob: string;
  dateOfLoss: string;
  /** Case status ("Active", "Discharged", …); active cases are offered first. */
  caseStatus?: string;
}

export interface ChatChoice {
  /** A patient to answer the waiting question about… */
  patientId?: string;
  label: string;
  /** …or an office question to ask when tapped (contact pick, "List them"). */
  question?: string;
  /** "Show inactive (N)": reveals the message's moreChoices in place. */
  showMore?: boolean;
}

export interface ChatQuote {
  title: string;
  page?: number;
  quote: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "goat";
  text: string;
  at: string;
  /** Office manager: patients this message listed ("these", "them"). */
  omListed?: string[];
  /** Office manager confirm card (money / case status / attorney). */
  om?: { plan: Exclude<OmPlan, { kind: "undo" }>; state: "open" | "done" | "canceled" | "undone"; snapshot?: OmSnapshot[]; result?: string };
  /** Office manager undo card for the card `targetId`. */
  omUndo?: { targetId: string; state: "open" | "done" | "canceled"; result?: string };
  patientId?: string;
  patientName?: string;
  /** Clarifying question: pick one of these patients. */
  choices?: ChatChoice[];
  /** The choice the user tapped (shown highlighted in the same bubble). */
  picked?: string;
  /** The question waiting on that choice. */
  pendingQuestion?: string;
  quotes?: ChatQuote[];
  warnings?: string[];
  /** Raw report text behind structured findings ("Show original"). */
  originals?: Array<{ label: string; text: string }>;
  ms?: number;
  /** Plain text for Copy (e.g. recommendations in the regular format). */
  copy?: string;
  /** An office-level (not patient) exchange. */
  practice?: boolean;
  /** Memory of an office answer, for follow-ups ("and tomorrow?", "list them"). */
  office?: OfficeMemory;
  /** A quick schedule / case change (reschedule, cancel, check in/out, no-show, DOI) waiting for Confirm. */
  quick?: import("@/lib/goat-quick").QuickPlan & { state: "open" | "done" | "canceled"; result?: string };
  /** "That's not what I meant": open = showing the action chips; picked = the action chosen. */
  missed?: { state: "open" | "picked" | "noted"; picked?: string };
  /** The user message this reply answered (for "not what I meant"). */
  replyTo?: string;
  /** A booking waiting for Confirm (nothing is saved before that). */
  booking?: BookingDraft & { state: "open" | "booked" | "canceled"; appointmentId?: string; replacesId?: string; newPatient?: { firstName: string; lastName: string; phone: string; provider: string; location: string; patientId?: string } };
  /** In-chat new patient + first visit: waiting for one missing detail (phone / day / time). */
  npAsk?: { field: "phone" | "time" | "day"; pending: import("@/lib/goat-new-patient-booking").PendingNewPatientBooking; state: "open" | "done" };
  /** A change to a Case Notes line G.O.A.T. just added (redate / retext / undo), waiting for Confirm. */
  noteEdit?: { patientId: string; patientName: string; oldLine: string; newLine: string | null; state: "open" | "done" | "canceled" | "missing" };
  /** "Which patient is this about?" for a team message; "no patient" sends it as a general message. */
  msgAsk?: { toLabel: string; toUserId?: string; alsoTo?: Array<{ label: string; userId?: string }>; text: string };
  /** Inactive-case choices revealed by "Show inactive (N)". */
  moreChoices?: ChatChoice[];
  /** A team message waiting for Confirm (posted to Messages only then). */
  msgDraft?: { /** Everyone (General), no @mention. */ toTeam?: boolean; toLabel: string; toUserId?: string; /** More @mentioned recipients on the same card. */ alsoTo?: Array<{ label: string; userId?: string }>; text: string; patientId?: string; patientName?: string; caseLabel?: string; state: "open" | "sent" | "canceled"; sent?: string };
  /** A note waiting for Confirm before it's added to the patient's Notes. */
  /** Pasted-contacts review card (one card for the whole batch). */
  contactImport?: {
    rows: Array<{ key: string; name: string; phone: string; fax: string; email: string; address: string; extra: string[]; category: string; checked: boolean; flag: string }>;
    category: string;
    categoryGuessed: boolean;
    state: "open" | "saving" | "saved" | "canceled" | "undone";
    addedIds?: string[];
    result?: string;
  };
  /** Recategorize (or undo) exactly the contacts one import added. One confirm card. */
  contactRecat?: { importMsgId: string; ids: string[]; from: string; to: string; mode: "recat" | "undo"; state: "open" | "done" | "canceled" | "reverted"; prev?: Record<string, string>; result?: string };
  /** "/contact" edit card. */
  contactEdit?: { contactId: string; name: string; category: string; phone: string; fax: string; email: string; address: string; state: "open" | "saved" | "canceled"; result?: string };
  /** "/todo" confirm card. */
  todoDraft?: { title: string; dueDate: string; patientId?: string; patientName?: string; state: "open" | "saved" | "canceled" };
  /** "/note" and "/todo": the patient type-ahead (name / case # / phone). `picked` once a patient is chosen. */
  flowPicker?: { next: "note" | "todo" | "text"; prefill?: string; allowNone?: boolean; picked?: string };
  /** "/text": who gets it, the message, and the Send card. Nothing is queued until the user taps Send. Names only — never phone numbers. */
  textDraft?: {
    audience: import("@/lib/goat-text").TextAudience;
    message: string;
    state: "open" | "queuing" | "queued" | "canceled" | "error";
    recipients?: Array<{ id: string; name: string }>;
    skipped?: { optedOut: number; noPhone: number; sharedPhone: number };
    deferred?: boolean;
    /** The "Queued…" line, or the reason nothing was queued. */
    result?: string;
  };
  /** Bulk cancel: the checklist of visits. Nothing is canceled until the red button is tapped. */
  bulkCancel?: {
    heading: string;
    /** "tomorrow" / "Fri 10/30", for the card. */
    dayWord: string;
    rows: Array<{ id: string; patientId: string; patientName: string; time: string; type: string; provider: string; prevStatus: string; checked: boolean }>;
    state: "open" | "done" | "canceled" | "undone";
    result?: string;
    /** Set after cancel: "Also text these patients?" has been offered. */
    offerText?: boolean;
  };
  noteDraft?: { patientId: string; patientName: string; text: string; state: "open" | "saved" | "canceled"; saved?: string };
  /** A button that opens an existing form prefilled (New Patient / New Appointment). Nothing is saved until the user saves the form. */
  formLaunch?:
    | { kind: "newPatient"; label: string; draft: Record<string, string | boolean | number | undefined>; ask: string[] }
    | { kind: "newAppointment"; label: string; patientId?: string; date?: string; time?: string; newPatient?: { lastName?: string; firstName?: string; phone?: string; attorney?: string; dateOfLoss?: string; notes?: string }; taskId?: string };
  /** Waiting for the day/time of a booking. */
  bookingAsk?: { patientId: string; question: string };
  /** Clickable links under the answer (e.g. the Settings page that changes something). */
  links?: Array<{ label: string; href: string }>;
  /** Clickable to-do lines (Morning Rundown, /view todo), then textAfter. */
  todoRows?: Array<{ id: string; href: string; before: string; after: string; patientName?: string; patientHref?: string }>;
  textAfter?: string;
}

export interface ChatState {
  messages: ChatMessage[];
  patientId: string | null;
}

export const GOAT_CHAT_PREFIX = "notegoat.goat-chat.v1:";

function chatKey(): string {
  let ws = "";
  try {
    ws = window.localStorage.getItem("casemate.active-workspace-id.v1") ?? "";
  } catch {
    ws = "";
  }
  return `${GOAT_CHAT_PREFIX}${ws || "default"}`;
}

export function loadChat(): ChatState {
  if (typeof window === "undefined") return { messages: [], patientId: null };
  try {
    const raw = window.localStorage.getItem(chatKey());
    const v = raw ? (JSON.parse(raw) as Partial<ChatState>) : {};
    return { messages: Array.isArray(v.messages) ? v.messages.slice(-200) : [], patientId: typeof v.patientId === "string" ? v.patientId : null };
  } catch {
    return { messages: [], patientId: null };
  }
}

export function saveChat(state: ChatState) {
  if (typeof window === "undefined") return;
  try {
    if (!state.messages.length && !state.patientId) {
      window.localStorage.removeItem(chatKey());
      return;
    }
    window.localStorage.setItem(chatKey(), JSON.stringify({ messages: state.messages.slice(-200), patientId: state.patientId }));
  } catch {
    // storage full: history just isn't kept
  }
}

/** Remove every stored G.O.A.T. chat in this browser (sign-out / workspace change / Clear chat). */
export function clearAllChats() {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(GOAT_CHAT_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

export function clearChat() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(chatKey());
  } catch {
    // ignore
  }
}

/** "Smith, John" → { first: "John", last: "Smith" }; "John Smith" → same. */
export function nameParts(fullName: string): { first: string; last: string } {
  const s = (fullName ?? "").trim();
  if (s.includes(",")) {
    const [last, rest = ""] = s.split(",").map((x) => x.trim());
    return { first: rest.split(/\s+/)[0] ?? "", last };
  }
  const parts = s.split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

export function displayName(fullName: string): string {
  const { first, last } = nameParts(fullName);
  return [first, last].filter(Boolean).join(" ") || fullName;
}

// ---------------------------------------------------------------------------
// Which patient a question is about (fuzzy: first, last, partial, typos)
// ---------------------------------------------------------------------------

/** Words that are never a patient's name in a question. */
const NOT_A_NAME = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have how i if in is it its me my of on or our so the their them then there they this to too was we were what when where which who whom whose why will with would you your " +
    "any all about tell show give find get got much many more most last first next recent latest previous upcoming ever never again still yet today yesterday tomorrow week weeks month months year years day days ago since until " +
    "visit visits visited appointment appointments appt appts seen came come coming scheduled schedule booked cancel canceled cancelled noshow show missed reschedule rescheduled checked check out " +
    "patient patients pts case file files chart note notes soap encounter encounters plan plans treatment treatments " +
    "summary summarize summarise overview recap brief status balance bill billing billed paid payment charges cost costs fee fees " +
    "doctor doc ortho neuro specialist specialists referral referrals referred report reports recommend recommended recommendation recommendations recs rec recos " +
    "mri mris xray xrays x-ray imaging findings finding impression results result rom range motion exam reexam re-exam initial discharge discharged " +
    "cervical thoracic lumbar spine neck back shoulder knee hip wrist hand elbow ankle foot left right bilateral " +
    "decompression decomp adjustment adjustments therapy injection injections epidural esi " +
    "attorney lawyer lien insurance doi dob injury accident date dates phone email address driver passenger " +
    "please thanks thank need want know say said says"
  ).split(/\s+/),
);

/** Damerau-Levenshtein distance (adjacent swaps count as one). Above 2 is reported as 3. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return Math.min(3, d[a.length][b.length]);
}

/** How well one word of the question fits one part of a name: 1 exact, 0.85 start of the name, 0.8 / 0.6 typo, else 0. */
export function namePartScore(word: string, part: string, whole = false): number {
  // One shared rule (goat-name-guard): never an everyday word / EHR abbreviation, no short-token
  // typos, a typo needs both words ≥ 4 letters and the same first letter.
  const m = matchNameToken(word, part, { allowPrefix: !whole });
  if (!m) return isShortTypo(word, part) ? 0.6 : 0; // 3-letter typo: only counts beside the other name part (acceptHits)
  if (m === "exact") return 1;
  if (m === "prefix") return 0.85;
  const w = word.toLowerCase();
  const p = part.toLowerCase();
  return editDistance(w, p) <= 1 ? 0.8 : 0.6;
}

/** Words of a question that could be a name: doctors ("Dr. Armen") and everyday words left out; "sam's" → "sam". */
export function nameWords(question: string): string[] {
  const q = question.replace(/\b(?:dr|doctor)\.?\s+[A-Za-z'-]+(?:\s+[A-Z][a-z'-]+)?/gi, " ");
  const words = (q.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).map((w) => w.replace(/'s$/i, "").replace(/['-]+$/, ""));
  return [...new Set(words.filter((w) => w.length >= 3 && !NOT_A_NAME.has(w.toLowerCase()) && !isNeverName(w)))];
}

export interface PatientMatch {
  patient: ChatPatient;
  score: number;
  /** Words of the question that are this patient's name (taken out before searching their file). */
  words: string[];
}

function nameTokens(fullName: string): string[] {
  const { first, last } = nameParts(fullName);
  const all = [first, ...last.split(/[\s-]+/), ...fullName.replace(/,/g, " ").split(/\s+/)];
  return [...new Set(all.map((t) => t.replace(/[^A-Za-z'-]/g, "")).filter((t) => t.length >= 2))];
}

/** Every patient whose name the question might mean, best first. */
export function scorePatients(question: string, patients: ChatPatient[]): PatientMatch[] {
  const words = nameWords(question);
  if (!words.length) return [];
  // Only the last word, still being typed (no space or punctuation after it), may be part of a name.
  const tail = /([A-Za-z][A-Za-z'-]*)$/.exec(question)?.[1]?.replace(/'s$/i, "").toLowerCase() ?? null;
  const whole = (w: string) => w.toLowerCase() !== tail;
  const out: PatientMatch[] = [];
  for (const patient of patients) {
    let score = 0;
    const used: string[] = [];
    for (const part of nameTokens(patient.fullName)) {
      let best = 0;
      let bestWord = "";
      for (const w of words) {
        if (used.includes(w)) continue;
        const s = namePartScore(w, part, whole(w));
        if (s > best) {
          best = s;
          bestWord = w;
        }
      }
      if (best > 0) {
        score += best;
        used.push(bestWord);
      }
    }
    if (score < 0.6) continue;
    // Context rules: a lone typo hit or an ambiguous word (may, will) needs more than itself.
    const hits: TokenHit[] = used.map((w) => {
      const at = question.toLowerCase().indexOf(w.toLowerCase());
      const raw = at >= 0 ? question.slice(at, at + w.length) : w;
      const m = nameTokens(patient.fullName).map((part) => ({ part, m: matchNameToken(w, part, { allowPrefix: !whole(w) }) })).find((x) => x.m);
      const short = !m && nameTokens(patient.fullName).some((part) => isShortTypo(w, part));
      return { index: at, raw, kind: short ? "short" : (m?.m ?? "exact"), part: m?.part.toLowerCase() ?? w } as TokenHit;
    });
    if (acceptHits(hits).length === 0) continue;
    out.push({ patient, score, words: used });
  }
  return out.sort((a, b) => b.score - a.score || a.patient.fullName.localeCompare(b.patient.fullName));
}

const COMMON_AFTER_NAME = /^(?:needs?|wants?|says?|said|came|comes|left|owes|paid|is|has|was|had|will|can|cancel\w*|resched\w*|booked|sent|got|gets|called|calls|asked|asks|says|still|also|just|needs|reduction|lop|lien|records|report|chart|info|number|phone|email|address|dob|doi|their|his|her|ok|okay|again|back|in|out|now|later|soon)$/;
const SURNAME_STOP = new Set("for at on in to tomorrow tmrw today next this new initial first appt appointment visit eval np follow followup re reexam exam massage friday monday tuesday wednesday thursday saturday sunday morning afternoon evening pm am please pls asap balance bill attorney atty file note notes mri xray x-ray case status".split(" "));

/**
 * "John Smith" typed as first + last name, where the first word is some patient's first name.
 * Returns the text and the ids of patients with that first AND last name (typos ≤ small).
 */
export function typedFullName(question: string, patients: ChatPatient[]): { text: string; ids: Set<string> } | null {
  const q = question.replace(/\b(?:dr|doctor)\.?\s+[A-Za-z'-]+/gi, " ");
  const re = /\b([A-Za-z][A-Za-z'-]{1,})\s+([A-Za-z][A-Za-z'-]{2,})(?:'s)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    const [w1, w2] = [m[1].toLowerCase(), m[2].toLowerCase().replace(/'s$/, "")];
    if (NOT_A_NAME.has(w1) || NOT_A_NAME.has(w2) || SURNAME_STOP.has(w1) || SURNAME_STOP.has(w2)) { re.lastIndex = m.index + m[1].length; continue; }
    if (/(?:ed|ing|ly)$/.test(w2) || COMMON_AFTER_NAME.test(w2)) { re.lastIndex = m.index + m[1].length; continue; }
    const firstHits = patients.filter((p) => namePartScore(w1, nameParts(p.fullName).first, true) >= 0.8);
    if (!firstHits.length) { re.lastIndex = m.index + m[1].length; continue; }
    // w2 is someone's first-name too ("kara john")? then it isn't a surname claim.
    const lastFits = (p: ChatPatient) => nameParts(p.fullName).last.split(/[\s-]+/).some((part) => namePartScore(w2, part, true) >= 0.8 || isShortTypo(w2, part));
    const ids = new Set(firstHits.filter(lastFits).map((p) => p.id));
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
    return { text: `${cap(m[1])} ${cap(m[2].replace(/'s$/i, ""))}`, ids };
  }
  return null;
}

export interface PatientLookup {
  /** The words of the question that look like a name (even if nobody matched), e.g. "sam". */
  named: string | null;
  /** One patient, sure enough to answer right away. */
  confident: PatientMatch | null;
  /** Several or unsure: every matching patient with an active case (or every match when none is active). */
  candidates: PatientMatch[];
  /** Inactive matches held back while active ones are shown ("Show inactive"). */
  inactive: PatientMatch[];
  /** The confident one, else the candidates. */
  matches: ChatPatient[];
}


/**
 * Find the patient a question is about. One clear match (a whole first or last
 * name, or the full name with a small typo, and nobody else close) is answered
 * right away; several or unsure gives up to 5 to pick from.
 */
export function findPatientsInQuestion(question: string, patients: ChatPatient[]): PatientLookup {
  const scored = scorePatients(question, patients);
  if (!scored.length) {
    // Only an explicit "for / about Someone" counts as naming a patient nobody matches.
    const m = /\b(?:for|about|patient)\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2})\b/.exec(question.replace(/\b(?:dr|doctor)\.?\s+[A-Za-z'-]+/gi, " "));
    return { named: m && !NOT_A_NAME.has(m[1].toLowerCase()) ? m[1] : null, confident: null, candidates: [], inactive: [], matches: [] };
  }
  // A typed first AND last name ("john smith") only matches patients with that last name
  // (small typos allowed). Never jump to another John just because the first name fits.
  const full = typedFullName(question, patients);
  if (full) {
    const same = scored.filter((m) => full.ids.has(m.patient.id));
    if (!same.length) return { named: full.text, confident: null, candidates: [], inactive: [], matches: [] };
    scored.splice(0, scored.length, ...same);
  }
  const [top, second] = scored;
  const named = top.words.join(" ");
  const exact = (m: PatientMatch) => nameTokens(m.patient.fullName).filter((p) => m.words.some((w) => w.toLowerCase() === p.toLowerCase())).length;
  const topExact = exact(top);
  const strong = top.score >= 1.6 || (topExact >= 1 && top.score >= 1);
  // Nobody else close, or the full name typed exactly while the next one is only near it ("Maria Sample" vs "Mario Sample").
  const sure = strong && (!second || second.score < top.score - 0.3 || (topExact >= 2 && exact(second) < topExact));
  if (sure) return { named, confident: top, candidates: [], inactive: [], matches: [top.patient] };
  // Every close match (no cap), active cases first.
  const close = scored.filter((m) => m.score >= Math.max(0.6, top.score - 0.6));
  const { shown, hidden } = activeFirst(close, (m) => isActiveCase(m.patient.caseStatus));
  return { named, confident: null, candidates: shown, inactive: hidden, matches: shown.map((c) => c.patient) };
}

function usDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : value ?? "";
}

/** "Smith, John · DOB 03/12/1980 · DOI 06/14/2026 · Case # 061426SMJO" for the clarifying question. */
export function choiceLabel(p: ChatPatient): string {
  const caseNo = caseNumberOf(p);
  return [
    displayName(p.fullName),
    p.dob ? `DOB ${usDate(p.dob)}` : "",
    p.dateOfLoss ? `DOI ${usDate(p.dateOfLoss)}` : "",
    caseNo ? `Case # ${caseNo}` : "",
    p.caseStatus && !isActiveCase(p.caseStatus) ? p.caseStatus : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Drop the patient's name (as typed: typos and partial names too) from the question before searching their file. */
export function stripPatientName(question: string, fullName: string): string {
  const parts = nameTokens(fullName);
  const typed = nameWords(question).filter((w) => parts.some((p) => namePartScore(w, p) >= 0.6));
  let q = question;
  for (const w of [...new Set([...parts, ...typed])]) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    q = q.replace(new RegExp(`(?<![A-Za-z])${esc}(?:'s)?(?![A-Za-z])`, "gi"), " ");
  }
  return q.replace(/\b(for|about|on)\s*(\?|$)/i, "$2").replace(/\s{2,}/g, " ").trim();
}
