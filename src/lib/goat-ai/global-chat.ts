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

export interface ChatPatient {
  id: string;
  fullName: string;
  dob: string;
  dateOfLoss: string;
}

export interface ChatChoice {
  patientId: string;
  label: string;
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
  /** The question waiting on that choice. */
  pendingQuestion?: string;
  quotes?: ChatQuote[];
  warnings?: string[];
  smart?: boolean;
  ms?: number;
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

function wordRe(w: string) {
  return new RegExp(`(?<![A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "i");
}

export interface PatientLookup {
  /** The question names someone (even if no one matched). */
  named: string | null;
  matches: ChatPatient[];
}

/**
 * Find the patient(s) a question names. Full first + last name wins; a single
 * name after "for / about / on" ("…for Garcia?") also counts. Doctors ("Dr. Armen")
 * are never treated as patients.
 */
export function findPatientsInQuestion(question: string, patients: ChatPatient[]): PatientLookup {
  const q = question.replace(/\b(?:dr|doctor)\.?\s+[A-Za-z'-]+(?:\s+[A-Z][a-z'-]+)?/gi, " ");
  const full = patients.filter((p) => {
    const { first, last } = nameParts(p.fullName);
    return first.length >= 2 && last.length >= 2 && wordRe(first).test(q) && wordRe(last).test(q);
  });
  if (full.length) {
    const { first, last } = nameParts(full[0].fullName);
    return { named: `${first} ${last}`, matches: full };
  }
  // "for Smith", "about John Smith", "on Maria Garcia"
  const m = /\b(?:for|about|on|patient)\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2})\s*\??\s*$/.exec(q.trim()) ??
    /\b(?:for|about|patient)\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2})\b/.exec(q);
  if (!m) return { named: null, matches: [] };
  const named = m[1];
  const tokens = named.split(/\s+/);
  const matches = patients.filter((p) => {
    const { first, last } = nameParts(p.fullName);
    return tokens.length === 1 ? [first, last].some((x) => x.toLowerCase() === tokens[0].toLowerCase()) : false;
  });
  return { named, matches };
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
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Drop the patient's name from the question before searching their file. */
export function stripPatientName(question: string, fullName: string): string {
  const { first, last } = nameParts(fullName);
  let q = question;
  for (const w of [first, last].filter((x) => x.length >= 2)) q = q.replace(new RegExp(`(?<![A-Za-z])${w}(?![A-Za-z])`, "gi"), " ");
  return q.replace(/\b(for|about|on)\s*(\?|$)/i, "$2").replace(/\s{2,}/g, " ").trim();
}
