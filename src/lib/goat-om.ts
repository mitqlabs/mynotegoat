/**
 * G.O.A.T. office manager (phase 1: money + cases). Rules only — no cloud AI.
 *
 * Understands casual front-desk wording:
 *   "mark these paid: John Smith, 3200 / Alex Malex 5400"
 *   "Nazaryan paid 2800 on Smith, we asked 3200"
 *   "what's still waiting on checks from Nazaryan", "how much came in this month"
 *   "discharge Smith, Malex and Lee today", "move these to ready to submit"
 *   "who's ready to bill", "who hasn't been seen in 2 weeks"
 *   "Smith switched to Yepremyan", "add 500 more to her", "do the same for Lee", "undo that"
 *
 * Pure: no React, no storage, no network. Every data change comes back as a
 * plan for ONE confirm card; nothing is written here. Names are matched
 * fuzzily but never guessed: ambiguous / unknown lines are flagged on the card.
 */
import { editDistance } from "@/lib/goat-ai/global-chat";

export type OmStatus = "Active" | "Discharged" | "Ready To Submit" | "Submitted" | "Dropped" | "Paid";

export interface OmPatient {
  id: string;
  fullName: string;
  caseStatus: string;
  attorney: string;
  /** Billing store (or matrix) billed / paid amounts. */
  billed: number;
  paid: number;
  /** MM/DD/YYYY or "" */
  paidDate: string;
  /** YYYY-MM-DD of the last visit (appointments / encounters), or "". */
  lastVisit?: string;
  cash?: boolean;
}

export interface OmData {
  patients: OmPatient[];
  /** Attorney / law-firm names from Contacts. */
  attorneys: string[];
  /** YYYY-MM-DD */
  today: string;
}

export interface OmRow {
  /** What was typed for this patient. */
  typed: string;
  /** Chosen patient (null = needs a pick or is skipped). */
  patientId: string | null;
  /** Possible patients when the name was ambiguous or close. */
  candidates: string[];
  /** Why this row needs attention, if it does. */
  flag?: "ambiguous" | "unmatched" | "noAmount";
  amount?: number;
  skip?: boolean;
}

export type OmPlan =
  | { kind: "markPaid"; rows: OmRow[]; date: string }
  | { kind: "addPaid"; rows: OmRow[]; date: string }
  | { kind: "reduction"; rows: OmRow[]; date: string; asked: number; payer: string }
  | { kind: "status"; rows: OmRow[]; status: OmStatus; date: string }
  | { kind: "attorney"; rows: OmRow[]; attorney: string; known: boolean; attorneyChoices: string[] }
  | { kind: "undo" };

export interface OmMemory {
  /** Patients the last answer/card listed ("these", "them"). */
  listed: string[];
  /** The last plan that was confirmed (for "do the same for Lee"). */
  lastPlan: Exclude<OmPlan, { kind: "undo" }> | null;
  /** True when the last confirmed plan can still be undone. */
  canUndo: boolean;
}

export const emptyOmMemory = (): OmMemory => ({ listed: [], lastPlan: null, canUndo: false });

export type OmReply =
  | { kind: "answer"; text: string; listed: string[] }
  | { kind: "confirm"; plan: Exclude<OmPlan, { kind: "undo" }>; text: string }
  | { kind: "undo"; text: string }
  | { kind: "say"; text: string };

// ---------------------------------------------------------------------------
// Small parsers
// ---------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function isoAdd(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
function dow(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
const pad = (n: number) => String(n).padStart(2, "0");
export function isoToUs(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}
export function usToIso(us: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(us.trim());
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(+m[1])}-${pad(+m[2])}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(us.trim()) ? us.trim() : "";
}

const DATE_RE = new RegExp(
  String.raw`\b(?:(?:paid|on|dated|as of|from|received|rcvd|came in)\s+)?(today|yesterday|tdy|yday|yest|this morning|last\s+(?:${DAYS.join("|")})|(?:on\s+)?(?:${DAYS.join("|")})|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:${MONTHS.join("|")})[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)\b`,
  "i",
);

/** A single date in the text ("paid yesterday", "10/12", "on friday", "oct 3"), as ISO, plus the text without it. */
export function takeDate(text: string, today: string): { iso: string | null; rest: string } {
  const m = DATE_RE.exec(text);
  if (!m) return { iso: null, rest: text };
  const raw = m[1].toLowerCase().replace(/^on\s+/, "");
  let iso: string | null = null;
  if (/^(today|tdy|this morning)$/.test(raw)) iso = today;
  else if (/^(yesterday|yday|yest)$/.test(raw)) iso = isoAdd(today, -1);
  else if (/^last\s+/.test(raw) || DAYS.includes(raw)) {
    const target = DAYS.indexOf(raw.replace(/^last\s+/, ""));
    let back = (dow(today) - target + 7) % 7;
    if (back === 0) back = 7;
    iso = isoAdd(today, -back);
  } else if (/^\d/.test(raw)) {
    const [mo, d, y] = raw.split("/");
    const year = y ? (y.length === 2 ? 2000 + +y : +y) : +today.slice(0, 4);
    iso = `${year}-${pad(+mo)}-${pad(+d)}`;
    if (!y && iso > today) iso = `${year - 1}-${pad(+mo)}-${pad(+d)}`;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) iso = null;
  } else {
    const mm = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(raw);
    if (mm) {
      const mo = MONTHS.indexOf(mm[1].slice(0, 3)) + 1;
      const year = mm[3] ? +mm[3] : +today.slice(0, 4);
      iso = `${year}-${pad(mo)}-${pad(+mm[2])}`;
      if (!mm[3] && iso > today) iso = `${year - 1}-${pad(mo)}-${pad(+mm[2])}`;
    }
  }
  if (!iso) return { iso: null, rest: text };
  return { iso, rest: (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ") };
}

const MONEY_RE = /(?<![\w/])\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k|grand|K)?(?![\w/])/g;

/** "$3,200", "3200", "3.2k", "3k", "3200.50" → number. */
export function parseMoney(s: string): number | null {
  const m = /^\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k|grand)?$/i.exec(s.trim());
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : ""));
  if (m[3]) n *= 1000;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const NAME_STOP = new Set(
  ("mark marked set put log record make the a an following these those them they this that paid pay payment payments with amount amounts of for as is was were are to from and on in at by got get received rcvd came check checks cheque " +
    "dollars bucks usd please pls plz can you could would ok okay also then each all list below here's heres here is it its patient patients case cases mr mrs ms dr " +
    "discharge discharged move moved submit submitted ready bill billed drop dropped active reopen status change switch switched today yesterday now done just " +
    "attorney atty lawyer law firm office new went goes going over w with he she his her him who whos what whats thanks thank thx ty we us our in full collected collect settled").split(/\s+/),
);

const words = (s: string) => (s.toLowerCase().replace(/[’']s\b/g, "").match(/[a-z][a-z'-]*/g) ?? []).map((w) => w.replace(/'/g, ""));

function partMatch(w: string, part: string): 0 | 1 | 2 {
  if (w === part) return 2;
  if (w.length === 3 && part.length <= 5 && w[0] === part[0] && editDistance(w, part) === 1) return 1;
  if (w.length >= 4 && part.length >= 4 && w[0] === part[0] && editDistance(w, part) <= (part.length >= 7 ? 2 : 1)) return 1;
  return 0;
}

export interface NameHit {
  candidates: string[];
  exact: boolean;
}

/** Patients a typed name means. Every typed name word must fit a name part; never guesses between several. */
export function matchName(typed: string, patients: Pick<OmPatient, "id" | "fullName">[]): NameHit {
  const ws = words(typed).filter((w) => !NAME_STOP.has(w));
  if (!ws.length) return { candidates: [], exact: false };
  const scored: Array<{ id: string; score: number; exact: boolean; full: boolean }> = [];
  for (const p of patients) {
    const parts = words(p.fullName);
    let score = 0;
    let exact = true;
    const used = new Set<number>();
    let ok = true;
    for (const w of ws) {
      let best = 0;
      let bi = -1;
      parts.forEach((pt, i) => {
        if (used.has(i)) return;
        const s = partMatch(w, pt);
        if (s > best) {
          best = s;
          bi = i;
        }
      });
      if (!best) {
        ok = false;
        break;
      }
      used.add(bi);
      score += best;
      if (best < 2) exact = false;
    }
    if (ok) scored.push({ id: p.id, score, exact, full: used.size === parts.length });
  }
  if (!scored.length) return { candidates: [], exact: false };
  const top = Math.max(...scored.map((s) => s.score));
  let best = scored.filter((s) => s.score === top);
  // "John Smith" typed in full: a full-name match beats a partial one.
  if (best.length > 1 && best.filter((s) => s.full && s.exact).length === 1 && ws.length >= 2) best = best.filter((s) => s.full && s.exact);
  return { candidates: best.map((s) => s.id), exact: best.length === 1 && best[0].exact };
}

function rowFor(typed: string, patients: OmPatient[], amount?: number): OmRow {
  const hit = matchName(typed, patients);
  const row: OmRow = { typed: typed.trim(), patientId: null, candidates: hit.candidates, amount };
  if (hit.candidates.length === 1) row.patientId = hit.candidates[0];
  else if (hit.candidates.length > 1) row.flag = "ambiguous";
  else {
    row.flag = "unmatched";
    // Close-but-not-sure names are offered as picks, never chosen.
    const loose = patients.filter((p) => words(typed).some((w) => !NAME_STOP.has(w) && w.length >= 3 && words(p.fullName).some((pt) => pt.startsWith(w.slice(0, 3)) && editDistance(w, pt) <= 2)));
    row.candidates = loose.slice(0, 5).map((p) => p.id);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Pasted paid lists
// ---------------------------------------------------------------------------

/** Name + amount pairs from a pasted list in any format. */
export function parsePaidList(body: string): Array<{ name: string; amount: number | null }> {
  // Mark money so commas inside "$3,200" survive the split.
  const tokens: Array<{ t: "name"; v: string } | { t: "amt"; v: number }> = [];
  let last = 0;
  const src = body.replace(/\t/g, " ");
  for (const m of src.matchAll(MONEY_RE)) {
    const n = parseMoney(m[0]);
    if (n === null || n < 10) continue; // "2 of them" etc.
    const before = src.slice(last, m.index);
    tokens.push({ t: "name", v: before });
    tokens.push({ t: "amt", v: n });
    last = (m.index ?? 0) + m[0].length;
  }
  tokens.push({ t: "name", v: src.slice(last) });
  const amountFirst = tokens.length > 2 && tokens[0].t === "name" && !words(tokens[0].v).filter((w) => !NAME_STOP.has(w)).length && tokens[1].t === "amt";
  const out: Array<{ name: string; amount: number | null }> = [];
  const nameChunks = (s: string) =>
    s
      .split(/\n|\/|;|\||,|\band\b|&|\s-\s|–|—|:|\(|\)/i)
      .map((x) => x.trim())
      .filter((x) => words(x).some((w) => !NAME_STOP.has(w)));
  if (amountFirst) {
    for (let i = 1; i < tokens.length; i += 2) {
      const amt = tokens[i];
      const nm = tokens[i + 1];
      if (amt?.t !== "amt") continue;
      const chunks = nm?.t === "name" ? nameChunks(nm.v) : [];
      if (chunks.length) {
        out.push({ name: chunks[0], amount: amt.v });
        chunks.slice(1).forEach((c) => out.push({ name: c, amount: null }));
      }
    }
    return out;
  }
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t !== "name") continue;
    const chunks = nameChunks(tk.v);
    const amt = tokens[i + 1]?.t === "amt" ? (tokens[i + 1] as { v: number }).v : null;
    chunks.forEach((c, j) => out.push({ name: c, amount: j === chunks.length - 1 ? amt : null }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

function clean(raw: string): string {
  return raw
    .replace(/[‘’]/g, "'")
    .replace(/^(hey|hi|yo|ok|okay)\s+(goat|g\.o\.a\.t\.?)[,!:]?\s*/i, "")
    .replace(/^(goat|g\.o\.a\.t\.?)[,!:]?\s+/i, "")
    .replace(/^(please|pls|plz|can you|could you|can u|would you|go ahead and|i need you to|i need to|lets|let's|quick(ly)?|just)\s+/gi, "")
    .replace(/^(please|pls|can you|could you)\s+/gi, "")
    .trim();
}

const QUESTION = /^(who|whos|who's|how|what|whats|what's|which|show|list|any|did|do|does|is|are|give me|tell me|pull up|get me|find)\b/i;
const STATUS_WORDS: Array<[RegExp, OmStatus]> = [
  [/\bready\s*(to|2)\s*(submit|bill)\b|\brts\b|\bready for billing\b/i, "Ready To Submit"],
  [/\bsubmitted\b|\bsubmit\b|\bsent (the )?(bill|r&b|rb)\b/i, "Submitted"],
  [/\bdischarg\w*\b|\bd\/c\b|^dc\b|\bdc'?d\b|\bdischarge\b|\breleased?\b/i, "Discharged"],
  [/\bdrop(ped)?\b/i, "Dropped"],
  [/\bre-?open\w*\b|\bback to active\b|\bactive\b/i, "Active"],
  [/\bpaid\b/i, "Paid"],
];

function statusIn(q: string): OmStatus | null {
  for (const [re, s] of STATUS_WORDS) if (re.test(q)) return s;
  return null;
}

const PRONOUN = /\b(her|him|them|they|these|those|this one|that one|the same ones|same ones|all of them|em|'em|these guys|these people|both)\b/i;

/** Patients the message names (comma / "and" lists), or the pronoun's patients from memory. */
function namedRows(text: string, data: OmData, mem: OmMemory): OmRow[] {
  const t = text.replace(PRONOUN, " ");
  const pieces = t
    .split(/\n|,|;|\/|\band\b|&|\+/i)
    .map((x) => x.trim())
    .filter((x) => words(x).some((w) => !NAME_STOP.has(w)));
  const rows = pieces.map((p) => rowFor(p, data.patients));
  if (!rows.length && PRONOUN.test(text) && mem.listed.length) return mem.listed.map((id) => ({ typed: nameOf(data, id), patientId: id, candidates: [id] }));
  return rows;
}

const nameOf = (data: OmData, id: string) => data.patients.find((p) => p.id === id)?.fullName ?? id;

function matchAttorney(typed: string, data: OmData): string[] {
  const all = [...new Set([...data.attorneys, ...data.patients.map((p) => p.attorney).filter((a) => a && a !== "Self")])];
  const ws = words(typed).filter((w) => !["law", "firm", "office", "the", "group", "attorney", "atty", "at", "of", "offices", "apc", "llp", "pc", "inc"].includes(w));
  if (!ws.length) return [];
  const score = (a: string) => {
    const aw = words(a);
    return ws.every((w) => aw.some((x) => partMatch(w, x) || (w.length >= 4 && x.startsWith(w)))) ? 1 : 0;
  };
  return all.filter((a) => score(a));
}

// ---------------------------------------------------------------------------
// Money questions
// ---------------------------------------------------------------------------

function rangeFor(q: string, today: string): { from: string; to: string; label: string } | null {
  const y = today.slice(0, 4);
  const mo = today.slice(5, 7);
  if (/\btoday\b/.test(q)) return { from: today, to: today, label: "today" };
  if (/\byesterday\b/.test(q)) return { from: isoAdd(today, -1), to: isoAdd(today, -1), label: "yesterday" };
  if (/\blast week\b/.test(q)) {
    const start = isoAdd(today, -((dow(today) + 6) % 7) - 7);
    return { from: start, to: isoAdd(start, 6), label: "last week" };
  }
  if (/\b(this week|so far this week)\b/.test(q)) return { from: isoAdd(today, -((dow(today) + 6) % 7)), to: today, label: "this week" };
  if (/\blast month\b/.test(q)) {
    const d = new Date(Date.UTC(+y, +mo - 2, 1));
    const from = d.toISOString().slice(0, 10);
    const to = isoAdd(new Date(Date.UTC(+y, +mo - 1, 1)).toISOString().slice(0, 10), -1);
    return { from, to, label: "last month" };
  }
  if (/\b(this year|ytd|year to date|so far this year)\b/.test(q)) return { from: `${y}-01-01`, to: today, label: "this year" };
  const nd = /\b(?:last|past)\s+(\d+)\s+days?\b/.exec(q);
  if (nd) return { from: isoAdd(today, -+nd[1] + 1), to: today, label: `the last ${nd[1]} days` };
  const mn = new RegExp(String.raw`\b(?:in|for|during)?\s*(${MONTHS.join("|")})[a-z]*\b`).exec(q);
  if (mn && !/\bmay\b/.test(mn[0]) || (mn && /\bin may\b/.test(q))) {
    const m = MONTHS.indexOf(mn![1]) + 1;
    let yr = +y;
    if (`${yr}-${pad(m)}-01` > today) yr -= 1;
    const from = `${yr}-${pad(m)}-01`;
    const to = isoAdd(new Date(Date.UTC(yr, m, 1)).toISOString().slice(0, 10), -1);
    return { from, to, label: `in ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]}` };
  }
  if (/\b(this month|month to date|so far this month|mtd)\b/.test(q)) return { from: `${y}-${mo}-01`, to: today, label: "this month" };
  return null;
}

function paidIn(data: OmData, r: { from: string; to: string }) {
  return data.patients.filter((p) => p.paid > 0 && p.paidDate && usToIso(p.paidDate) >= r.from && usToIso(p.paidDate) <= r.to);
}

const listNames = (ps: OmPatient[], extra?: (p: OmPatient) => string) => ps.map((p) => `- ${p.fullName}${extra ? ` — ${extra(p)}` : ""}`).join("\n");
const byName = (a: OmPatient, b: OmPatient) => {
  const k = (p: OmPatient) => { if (p.fullName.includes(",")) return p.fullName.toLowerCase(); const w = p.fullName.trim().split(/\s+/); return `${w[w.length - 1]} ${w.slice(0, -1).join(" ")}`.toLowerCase(); };
  return k(a).localeCompare(k(b));
};

function answerQuestion(q: string, data: OmData): OmReply | null {
  const l = q.toLowerCase();
  // Checks we're waiting on (Submitted cases), optionally from one attorney.
  if (/\b(checks?|payments?|money|paid)\b/.test(l) && /\b(wait|waiting|pending|outstanding|owed|owe|expect|haven't|havent|still|not paid|unpaid|out)\b/.test(l) || /\bsubmitted\b.*\b(from|with|by|for)\b/.test(l) || /\b(owe|owes|owing|still out|outstanding)\b/.test(l)) {
    const tail = q.trim().replace(/[?.!]+$/, "");
    const fm0 = /.*\b(?:from|by|with)\s+(?:the\s+)?([a-z][a-z .&'-]+?)(?:\s+(?:cases?|right now|still|yet|atm))?$/i.exec(tail) ?? /.*\b(?:for|on)\s+(?:the\s+)?([a-z][a-z .&'-]+?)(?:\s+(?:cases?|right now|still|yet|atm))?$/i.exec(tail);
    const fm = fm0 && !/^(us|them|checks?|payments?|money|the month|this month|me|now|it)\b/i.test(fm0[1].trim()) ? fm0 : null;
    let firm: string[] = [];
    if (fm) firm = matchAttorney(fm[1], data);
    if (!fm) {
      const qw = words(q);
      const all = [...new Set([...data.attorneys, ...data.patients.map((p) => p.attorney).filter((a) => a && a !== "Self")])];
      firm = all.filter((a) => { const k = words(a).find((w) => !["law", "the", "group", "firm", "of", "and"].includes(w) && w.length >= 4); return Boolean(k && qw.some((w) => partMatch(w, k))); });
    }
    if (fm && !firm.length) {
      return { kind: "answer", text: `I couldn't find an attorney named "${fm[1].trim()}" in Contacts or on any case.`, listed: [] };
    }
    const subs = data.patients.filter((p) => p.caseStatus === "Submitted" && (!firm.length || firm.some((f) => f.toLowerCase() === (p.attorney ?? "").toLowerCase()))).sort(byName);
    const total = subs.reduce((s, p) => s + p.billed, 0);
    const who = firm.length ? ` from ${firm.join(" / ")}` : "";
    if (!subs.length) return { kind: "answer", text: `No submitted cases waiting on checks${who}.`, listed: [] };
    return {
      kind: "answer",
      text: `${subs.length} submitted case${subs.length === 1 ? "" : "s"} waiting on checks${who} — ${money(total)} billed:\n${listNames(subs, (p) => `${p.billed ? money(p.billed) : "no billed amount"}${firm.length ? "" : p.attorney ? ` · ${p.attorney}` : ""}`)}`,
      listed: subs.map((p) => p.id),
    };
  }
  // Not seen in N days/weeks.
  const ns = /\b(?:hasn'?t|haven'?t|not|nobody|no one|havnt|hasnt|have not|has not)\b.*\b(?:seen|been in|come in|came in|visited|been back|showed up|shown up|in)\b.*?\b(?:in|for|over|past|the last)?\s*(?:(\d+|a|one|two|three|four|a couple(?: of)?)\s*)?(days?|weeks?|wks?|months?)\b/.exec(l) ?? /\b(?:no visits?|not seen|missing)\b.*?(\d+|a|one|two|three|four)?\s*(days?|weeks?|wks?|months?)\b/.exec(l);
  if (ns) {
    const nmap: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, "a couple": 2, "a couple of": 2 };
    const n = ns[1] ? nmap[ns[1]] ?? +ns[1] : 1;
    const unit = ns[2].startsWith("d") ? 1 : ns[2].startsWith("w") ? 7 : 30;
    const cutoff = isoAdd(data.today, -n * unit);
    const ps = data.patients.filter((p) => p.caseStatus === "Active" && (!p.lastVisit || p.lastVisit < cutoff)).sort(byName);
    const span = `${n} ${ns[2].replace(/^wks?$/, "week").replace(/s$/, "")}${n === 1 ? "" : "s"}`;
    return { kind: "answer", text: ps.length ? `${ps.length} active case${ps.length === 1 ? "" : "s"} not seen in ${span}:\n${listNames(ps, (p) => (p.lastVisit ? `last visit ${isoToUs(p.lastVisit)}` : "no visit on file"))}` : `Every active case was seen in the last ${span}.`, listed: ps.map((p) => p.id) };
  }
  // Money in.
  const range = rangeFor(l, data.today);
  if (/\b(how much|total|sum|collected|collections|came in|come in|brought in|did we (make|get|collect)|received|income|revenue)\b/.test(l) && !/\bwho\b/.test(l)) {
    const r = range ?? rangeFor("this month", data.today)!;
    const ps = paidIn(data, r).sort(byName);
    const total = ps.reduce((s, p) => s + p.paid, 0);
    return { kind: "answer", text: `${money(total)} came in ${r.label} from ${ps.length} case${ps.length === 1 ? "" : "s"}${ps.length ? ":\n" + listNames(ps, (p) => `${money(p.paid)} on ${p.paidDate}`) : "."}`, listed: ps.map((p) => p.id) };
  }
  if (/\bwho\b.*\b(paid|pay|paying|checks?|payments?)\b|\b(list|show)\b.*\bpaid\b|\bpaid cases\b/.test(l) && !/\bnot\b|hasn'?t|haven'?t|waiting/.test(l)) {
    const r = range ?? rangeFor("this month", data.today)!;
    const ps = paidIn(data, r).sort(byName);
    return { kind: "answer", text: ps.length ? `${ps.length} paid ${r.label} (${money(ps.reduce((s, p) => s + p.paid, 0))}):\n${listNames(ps, (p) => `${money(p.paid)} on ${p.paidDate}`)}` : `Nobody paid ${r.label}.`, listed: ps.map((p) => p.id) };
  }
  // Ready to bill.
  if (/\bready\s*(to|2|for)\s*(bill|submit|billing|go out)\b|\bwho can (we|i) bill\b|\bwhat can (we|i) bill\b|\bneeds? (to be )?(billed|submitted)\b|\bbillable\b/.test(l)) {
    const ps = data.patients.filter((p) => p.caseStatus === "Ready To Submit").sort(byName);
    return { kind: "answer", text: ps.length ? `${ps.length} ready to submit:\n${listNames(ps, (p) => (p.attorney && p.attorney !== "Self" ? p.attorney : "no attorney"))}` : "No cases are Ready To Submit right now.", listed: ps.map((p) => p.id) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

const UNDO = /^(undo|undo (that|it|this|the last (one|change|thing))|revert( that| it)?|take (that|it) back|reverse (that|it)|never ?mind,? undo( that)?|put (it|that|them) back|oops,? undo( that)?|undo please|cancel (that|the last) change|roll ?back( that)?)\b/i;
const SAME = /^(?:and\s+|now\s+|also\s+)?(?:do|same)\s+(?:the\s+)?same(?:\s+thing)?\s+(?:for|with|to)\s+(.+)$|^(?:same|ditto)\s+(?:for|with)\s+(.+)$|^(?:and\s+)?(?:for\s+)?(.+?)\s+too$/i;
const ADD_MORE = /\b(?:add|another|plus|extra|put)\s+\$?([\d.,]+k?)\s*(?:more|extra)?\b.*?\b(?:to|for|on)\s+(.+)$|\b(?:add|another)\s+\$?([\d.,]+k?)\s+(?:more\s+)?(?:to|for|on)\s*(.+)$|^(.+?)\s+paid\s+(?:another|an extra|\$?[\d.,]+k?\s+more)\s*\$?([\d.,]+k?)?/i;

/**
 * One turn. Returns null when this isn't an office-manager message (the rest
 * of G.O.A.T. handles it). `followUps` = the last action card was ours, so
 * "undo that" / "do the same for Lee" / "add 500 more to her" are about it.
 */
export function omTurn(raw: string, data: OmData, mem: OmMemory, followUps = true): OmReply | null {
  const q = clean(raw.replace(/\s+$/, ""));
  const one = q.replace(/\s+/g, " ").replace(/[.!]+$/, "");
  const l = one.toLowerCase();
  if (!one) return null;
  // Leave messages, notes and bookings to the rest of G.O.A.T.
  if (/^(tell|let|message|msg|text|ask|remind|ping|email|dm)\b/i.test(one) || /\b(add|put|write|leave|log)\s+(a\s+)?(quick\s+)?note\b/i.test(one) || /^note\b/i.test(one) || /^(book|schedule|reschedule)\b/i.test(one) || /\b(message|msg|dm|email|e-mail)\b/i.test(one) || (/^how many\b/i.test(one) && !/\b(seen|been in|come in|came in)\b/i.test(one))) return null;

  // Undo / same / add-more: only right after one of our own actions.
  if (followUps && mem.lastPlan) {
    if (UNDO.test(l)) return mem.canUndo ? { kind: "undo", text: "Undo the last change? Everything goes back exactly as it was." } : { kind: "say", text: "That change was already undone." };
    const same = SAME.exec(one);
    if (same && !/\bpaid\b/i.test(same[3] ?? "")) {
      const who = (same[1] ?? same[2] ?? same[3] ?? "").trim();
      const rows = namedRows(who, data, mem);
      if (rows.length) {
        const p = mem.lastPlan;
        const amt = p.kind === "markPaid" || p.kind === "addPaid" || p.kind === "reduction" ? p.rows.find((r) => r.patientId && !r.skip)?.amount : undefined;
        const date = takeDate(who, data.today).iso;
        const next = { ...p, rows: rows.map((r) => ({ ...r, amount: r.amount ?? amt })), ...(date && "date" in p ? { date } : {}) } as Exclude<OmPlan, { kind: "undo" }>;
        return { kind: "confirm", plan: next, text: cardText(next, data) };
      }
    }
  }
  const more = ADD_MORE.exec(one);
  if (more && (followUps || !PRONOUN.test(one))) {
    const amtS = more[1] ?? more[3] ?? more[6];
    const who = (more[2] ?? more[4] ?? more[5] ?? "").trim();
    const amt = amtS ? parseMoney(amtS.replace(/,$/, "")) : null;
    const pr = PRONOUN.test(who) || !words(who).filter((w) => !NAME_STOP.has(w)).length;
    let rows = pr ? (mem.listed.length ? mem.listed.map((id) => ({ typed: nameOf(data, id), patientId: id, candidates: [id] })) : []) : namedRows(who, data, mem);
    if (amt && rows.length) {
      rows = rows.map((r) => ({ ...r, amount: amt }));
      const plan: OmPlan = { kind: "addPaid", rows, date: takeDate(one, data.today).iso ?? data.today };
      return { kind: "confirm", plan, text: cardText(plan, data) };
    }
    if (amt && !rows.length) return { kind: "say", text: "Who should I add that to? (e.g. \"add 500 more to Smith\")" };
  }

  // Questions.
  if (QUESTION.test(one) || /\?$/.test(raw.trim())) {
    const a = answerQuestion(one, data);
    if (a) return a;
    return null;
  }
  {
    // Bare question shapes without a question word ("checks still waiting from nazaryan", "money in last week").
    if (/^(checks?|payments?|money|collections?|total)\b/.test(l) && ![...one.matchAll(MONEY_RE)].some((m) => (parseMoney(m[0]) ?? 0) >= 10)) {
      const a = answerQuestion(one, data);
      if (a) return a;
    }
  }

  // Attorney change.
  const att =
    /^(.+?)\s+(?:switched|changed|moved|went|switching|changing|is switching|has switched|switched over|transferred|swapped)\s+(?:attorneys?\s+|atty\s+|lawyers?\s+|firms?\s+)?(?:over\s+)?(?:to|with)\s+(.+)$/i.exec(one) ??
    /^(?:change|switch|set|update|make|put)\s+(.+?)(?:'s|s')?\s+(?:attorney|atty|lawyer|law firm|firm)\s+(?:to|as|=|is)\s+(.+)$/i.exec(one) ??
    /^(.+?)(?:'s|s')\s+(?:new\s+)?(?:attorney|atty|lawyer|law firm|firm)\s+(?:is\s+(?:now\s+)?|=\s*|now\s+|:\s*|is\s+gonna\s+be\s+)(.+)$/i.exec(one) ??
    /^(.+?)\s+(?:has|got)\s+(?:a\s+)?new\s+(?:attorney|atty|lawyer|firm)\s*[:,-]?\s*(?:now\s*)?(?:,\s*)?(?:it's\s+|its\s+)?(.+)$/i.exec(one) ??
    /^(?:attorney|atty|lawyer)\s+(?:for|on)\s+(.+?)\s+(?:is\s+(?:now\s+)?|to\s+|now\s+)(.+)$/i.exec(one) ??
    /^(?:assign|give)\s+(.+?)\s+to\s+(.+?)\s+(?:law|firm|attorney|atty)\b.*$/i.exec(one);
  if (att && !/\b(paid|discharg|ready|submit|status|drop|active)\b/i.test(att[2])) {
    const rows = namedRows(att[1], data, mem);
    const typedAtt = att[2].replace(/\b(now|instead|please|pls|thanks?)\b/gi, "").replace(/\s+/g, " ").trim().replace(/[.,]$/, "");
    if (rows.length && typedAtt) {
      const choices = matchAttorney(typedAtt, data);
      const plan: OmPlan = { kind: "attorney", rows, attorney: choices.length === 1 ? choices[0] : typedAtt, known: choices.length === 1, attorneyChoices: choices };
      return { kind: "confirm", plan, text: cardText(plan, data) };
    }
  }

  // Reduction: "Nazaryan paid 2800 on Smith, we asked 3200".
  if (/\b(asked|requested|req|billed|wanted|reduc\w*|instead of|accepted|took|settled|from\s+\$?[\d.,]+k?\s+to)\b/i.test(one) && /\bpaid|accept|settled|took|reduc|came in|check\b/i.test(one)) {
    const amts = [...one.matchAll(MONEY_RE)].map((m) => ({ n: parseMoney(m[0]), at: m.index ?? 0, s: m[0] })).filter((x) => x.n !== null && x.n! >= 10) as Array<{ n: number; at: number; s: string }>;
    if (amts.length >= 2) {
      const ctx = (a: { at: number }) => one.slice(Math.max(0, a.at - 22), a.at).toLowerCase();
      let asked = amts.find((a) => /(asked|requested|req|billed|wanted|instead of|from|bill was|was|of)\s*(for\s*)?\$?\s*$/.test(ctx(a)));
      let paid = amts.find((a) => a !== asked && /(paid|accepted|accept|took|settled|to|for|check|came in|sent|gave)\s*(us\s*)?(for\s*)?(only\s*)?(just\s*)?\$?\s*$/.test(ctx(a)));
      if (!asked && paid) asked = amts.find((a) => a !== paid);
      if (!paid && asked) paid = amts.find((a) => a !== asked);
      if (!asked || !paid) {
        const sorted = [...amts].sort((a, b) => a.n - b.n);
        paid = sorted[0];
        asked = sorted[sorted.length - 1];
      }
      if (paid.n > asked.n) [paid, asked] = [asked, paid];
      let text = one;
      for (const a of amts) text = text.replace(a.s, " ");
      const { iso, rest } = takeDate(text, data.today);
      // Payer: "Nazaryan paid … on Smith" / "from Nazaryan". The patient: "on/for Smith" or the name before "paid".
      let who = "";
      let payer = "";
      const on = /\b(?:on|for)\s+([a-z][a-z' -]+?)(?:'s)?(?:\s+(?:case|file|bill))?(?:,|:|\s+we\b|\s+they\b|\s+but\b|\s+asked\b|\s+accepted\b|\s+after\b|$)/i.exec(rest);
      const pre = /^([a-z][a-z' -]+?)\s+(?:paid|accepted|took|settled|sent|reduced)/i.exec(rest.trim());
      if (on) {
        who = on[1];
        if (pre) payer = pre[1];
      } else if (pre) who = pre[1];
      const fr = /\bfrom\s+([a-z][a-z' -]+?)(?:\s+law|\s+firm|,|$)/i.exec(rest);
      if (fr && !payer) payer = fr[1];
      if (payer && !matchAttorney(payer, data).length && matchName(payer, data.patients).candidates.length) {
        // "Smith paid 2800 on 3200" — the "payer" was actually the patient.
        who = who || payer;
        payer = "";
      }
      const rows = namedRows(who, data, mem).slice(0, 1);
      if (rows.length) {
        rows[0].amount = paid.n;
        const payerName = payer ? (matchAttorney(payer, data)[0] ?? payer.trim()) : "";
        const plan: OmPlan = { kind: "reduction", rows, date: iso ?? data.today, asked: asked.n, payer: payerName };
        return { kind: "confirm", plan, text: cardText(plan, data) };
      }
      if (PRONOUN.test(one) && mem.listed.length === 1) {
        const plan: OmPlan = { kind: "reduction", rows: [{ typed: nameOf(data, mem.listed[0]), patientId: mem.listed[0], candidates: [mem.listed[0]], amount: paid.n }], date: iso ?? data.today, asked: asked.n, payer: payer ? (matchAttorney(payer, data)[0] ?? payer) : "" };
        return { kind: "confirm", plan, text: cardText(plan, data) };
      }
    }
  }

  // Mark paid from a list.
  const paidish = /\b(paid|payments?|checks?|cheques?|received|rcvd|came in|got paid|settled|collected)\b/i.test(one);
  if (paidish && !/\b(not|hasn'?t|haven'?t|didn'?t|never)\s+(been\s+)?paid\b/i.test(one)) {
    const { iso, rest } = takeDate(q.replace(/^(?:mark|set|log|record|enter|put)\b/i, ""), data.today);
    const body = rest.replace(/\b(?:the following|following|these|below)\b\s*(?:as\s+)?(?:paid)?\s*(?:with\s+(?:the\s+)?amounts?)?\s*[:-]?/i, " ");
    const items = parsePaidList(body);
    const withAmt = items.filter((i) => i.amount !== null);
    if (withAmt.length) {
      const rows = items.map((i) => {
        const r = rowFor(i.name, data.patients, i.amount ?? undefined);
        if (i.amount === null && !r.flag) r.flag = "noAmount";
        return r;
      });
      const plan: OmPlan = { kind: "markPaid", rows, date: iso ?? data.today };
      return { kind: "confirm", plan, text: cardText(plan, data) };
    }
    // "mark them paid" / "smith paid" (no amount): amount comes from billed, flagged.
    if (/^(?:mark|set|make|put|move)?\s*.+\b(?:as\s+)?paid(?:\s+in\s+full)?$/i.test(one.replace(DATE_RE, "").trim()) || /\bpaid in full\b/i.test(one)) {
      const rows = namedRows(rest.replace(/\b(paid|in full|as|mark|set|make|put|move|to)\b/gi, " "), data, mem).map((r) => {
        const p = data.patients.find((x) => x.id === r.patientId);
        const amount = p && p.billed > 0 ? p.billed : undefined;
        return { ...r, amount, flag: r.flag ?? (amount === undefined ? ("noAmount" as const) : undefined) };
      });
      if (rows.length) {
        const plan: OmPlan = { kind: "markPaid", rows, date: iso ?? data.today };
        return { kind: "confirm", plan, text: cardText(plan, data) };
      }
    }
  }

  // Bulk case status.
  const st = statusIn(one);
  const statusVerb = /^(?:move|mark|set|change|put|switch|make|update|flip|bump|send)\b|^(?:discharge|drop|submit|re-?open|d\/c|dc)\b|\b(?:to|as|into|is|are|got|get|were|was)\s+(?:now\s+)?(?:ready|submitted|discharged|dropped|active|re-?opened)\b|\b(?:discharged|dropped|submitted)\b(?:\s+(?:today|yesterday|on\b.*))?$/i;
  if (st && st !== "Paid" && statusVerb.test(one)) {
    const { iso, rest } = takeDate(one, data.today);
    const names = rest
      .replace(/^(?:move|mark|set|change|put|switch|make|update|flip|bump|send|discharge|drop|submit|re-?open|d\/c|dc)\b/i, " ")
      .replace(/\b(?:the\s+)?(?:status|case status|cases?|files?)\b(?:\s+(?:of|for))?/gi, " ")
      .replace(/\b(?:to|as|into|is|are|got|get|were|was|now|back)\b\s*(?:ready\s*(?:to|2)\s*(?:submit|bill)|submitted|discharged|dropped|active|re-?opened|rts)?/gi, " ")
      .replace(/\b(?:ready\s*(?:to|2)\s*(?:submit|bill)|submitted|discharged?|dropped|active|re-?opened|rts|d\/c)\b/gi, " ");
    const rows = namedRows(names, data, mem);
    if (rows.length) {
      const plan: OmPlan = { kind: "status", rows, status: st, date: iso ?? data.today };
      return { kind: "confirm", plan, text: cardText(plan, data) };
    }
    if (PRONOUN.test(one)) return { kind: "say", text: "Which patients? I don't have a list from earlier to go by — name them (e.g. \"move Smith and Lee to ready to submit\")." };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Card text and the change list
// ---------------------------------------------------------------------------

export function cardText(plan: Exclude<OmPlan, { kind: "undo" }>, data: OmData): string {
  const n = plan.rows.length;
  const need = plan.rows.filter((r) => r.flag && r.flag !== "noAmount").length;
  const tail = need ? ` ${need} line${need === 1 ? "" : "s"} need${need === 1 ? "s" : ""} a pick (or skip).` : "";
  if (plan.kind === "markPaid") return `Mark ${n} case${n === 1 ? "" : "s"} paid on ${isoToUs(plan.date)}?${tail}`;
  if (plan.kind === "addPaid") return `Add to the paid amount on ${isoToUs(plan.date)}?${tail}`;
  if (plan.kind === "reduction") return `Log a reduced payment${plan.payer ? ` from ${plan.payer}` : ""}: paid ${money(plan.rows[0]?.amount ?? 0)}, asked ${money(plan.asked)} (reduction ${money(plan.asked - (plan.rows[0]?.amount ?? 0))})?${tail}`;
  if (plan.kind === "status") return `Change ${n} case${n === 1 ? "" : "s"} to ${plan.status}${plan.status === "Discharged" ? ` (discharge date ${isoToUs(plan.date)})` : ""}?${tail}`;
  return `Change the attorney to ${plan.attorney}${plan.known ? "" : plan.attorneyChoices.length > 1 ? " — pick which one" : " (not in Contacts — saved as typed)"}?${tail}`;
}

/** What a confirmed row changes, given the patient's current values. */
export interface OmChange {
  patientId: string;
  billing?: { paidAmount: number; paidDate: string };
  adjustment?: { label: string; amount: number; note: string };
  caseStatus?: OmStatus;
  attorney?: string;
  /** Patient file mirror (matrix), ISO dates. */
  matrix?: { paidAmount?: string; paidDate?: string; discharge?: string };
  note: string;
}

export function planChanges(plan: Exclude<OmPlan, { kind: "undo" }>, data: OmData): OmChange[] {
  const out: OmChange[] = [];
  for (const r of plan.rows) {
    if (r.skip || !r.patientId) continue;
    const p = data.patients.find((x) => x.id === r.patientId);
    if (!p) continue;
    if (plan.kind === "markPaid" || plan.kind === "addPaid" || plan.kind === "reduction") {
      if (r.amount === undefined || !(r.amount > 0)) continue;
      const paid = plan.kind === "addPaid" ? Math.round((p.paid + r.amount) * 100) / 100 : r.amount;
      const date = plan.date;
      const c: OmChange = {
        patientId: p.id,
        billing: { paidAmount: paid, paidDate: isoToUs(date) },
        matrix: { paidAmount: String(paid), paidDate: date },
        caseStatus: "Paid",
        note:
          plan.kind === "addPaid"
            ? `Added ${money(r.amount)} to paid amount (now ${money(paid)}), paid ${isoToUs(date)}`
            : plan.kind === "reduction"
              ? `Paid ${money(paid)} on ${isoToUs(date)}${plan.payer ? ` by ${plan.payer}` : ""}; reduction accepted (requested ${money(plan.asked)}, reduced ${money(plan.asked - paid)})`
              : `Marked paid ${money(paid)} on ${isoToUs(date)}`,
      };
      if (plan.kind === "reduction" && plan.asked > paid) c.adjustment = { label: "Reduction", amount: Math.round((plan.asked - paid) * 100) / 100, note: `Requested ${money(plan.asked)}, accepted ${money(paid)}${plan.payer ? ` (${plan.payer})` : ""}` };
      out.push(c);
    } else if (plan.kind === "status") {
      out.push({
        patientId: p.id,
        caseStatus: plan.status,
        matrix: plan.status === "Discharged" ? { discharge: plan.date } : undefined,
        note: plan.status === "Discharged" ? `Case status ${p.caseStatus} → Discharged (discharge date ${isoToUs(plan.date)})` : `Case status ${p.caseStatus} → ${plan.status}`,
      });
    } else if (plan.kind === "attorney") {
      out.push({ patientId: p.id, attorney: plan.attorney, note: `Attorney changed ${p.attorney || "none"} → ${plan.attorney}` });
    }
  }
  return out;
}

/** The memory after a plan is confirmed. */
export function rememberApplied(mem: OmMemory, plan: Exclude<OmPlan, { kind: "undo" }>): OmMemory {
  return { listed: plan.rows.filter((r) => r.patientId && !r.skip).map((r) => r.patientId!), lastPlan: plan, canUndo: true };
}
