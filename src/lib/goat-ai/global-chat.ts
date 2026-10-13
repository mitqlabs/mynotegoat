import type { OfficeMemory } from "@/lib/goat-office";
import type { BookingDraft } from "@/lib/goat-booking";
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

import { buildCaseNumber } from "@/lib/follow-up-queue";
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
  ms?: number;
  /** Plain text for Copy (e.g. recommendations in the regular format). */
  copy?: string;
  /** An office-level (not patient) exchange. */
  practice?: boolean;
  /** Memory of an office answer, for follow-ups ("and tomorrow?", "list them"). */
  office?: OfficeMemory;
  /** A booking waiting for Confirm (nothing is saved before that). */
  booking?: BookingDraft & { state: "open" | "booked" | "canceled" };
  /** Inactive-case choices revealed by "Show inactive (N)". */
  moreChoices?: ChatChoice[];
  /** A team message waiting for Confirm (posted to Messages only then). */
  msgDraft?: { toLabel: string; toUserId?: string; text: string; patientId?: string; patientName?: string; caseLabel?: string; state: "open" | "sent" | "canceled"; sent?: string };
  /** A note waiting for Confirm before it's added to the patient's Notes. */
  noteDraft?: { patientId: string; patientName: string; text: string; state: "open" | "saved" | "canceled"; saved?: string };
  /** Waiting for the day/time of a booking. */
  bookingAsk?: { patientId: string; question: string };
  /** Clickable links under the answer (e.g. the Settings page that changes something). */
  links?: Array<{ label: string; href: string }>;
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
  const w = word.toLowerCase();
  const p = part.toLowerCase();
  if (w.length < 2 || p.length < 2) return 0;
  if (w === p) return 1;
  // A finished word ("armen " / "armen next visit") never matches the start of a longer name (Armenuhi).
  if (!whole && w.length >= 3 && p.startsWith(w)) return 0.85;
  if (w.length >= 4) {
    const d = editDistance(w, p);
    if (d === 1) return 0.8;
    if (d === 2 && w.length >= 6 && p.length >= 6) return 0.6;
  }
  return 0;
}

/** Words of a question that could be a name: doctors ("Dr. Armen") and everyday words left out; "sam's" → "sam". */
export function nameWords(question: string): string[] {
  const q = question.replace(/\b(?:dr|doctor)\.?\s+[A-Za-z'-]+(?:\s+[A-Z][a-z'-]+)?/gi, " ");
  const words = (q.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).map((w) => w.replace(/'s$/i, "").replace(/['-]+$/, ""));
  return [...new Set(words.filter((w) => w.length >= 3 && !NOT_A_NAME.has(w.toLowerCase())))];
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
    if (score >= 0.6) out.push({ patient, score, words: used });
  }
  return out.sort((a, b) => b.score - a.score || a.patient.fullName.localeCompare(b.patient.fullName));
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
  const caseNo = buildCaseNumber(p.dateOfLoss, p.fullName);
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
