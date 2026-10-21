/**
 * G.O.A.T. understanding (rules only, no cloud AI): message → action + slots.
 *
 * One catalog (GOAT_ACTIONS) lists every action G.O.A.T. can perform, with its
 * trigger words, required details and example phrases. The Handbook's
 * "What you can say" list is built from it, so a new action plugs in by
 * adding one entry here.
 *
 *  - typo tolerant (verbs and names match within one or two letters)
 *  - fuzzy patient match ("jon smth", "smith", "Smith, John"), pronouns ("him")
 *  - relative dates/times ("tmrw at 3", "next wed", "in 2 weeks", "10/24")
 *  - learned phrases (cloud-saved, names generalized to slots) are tried first
 *
 * understand() never changes anything. It returns the action, the slots and a
 * canonical phrase the existing G.O.A.T. paths already handle (each ends on
 * one confirm card), or one short question when a required detail is missing.
 */
import { normalizeCasual } from "@/lib/goat-assistant";

export type ActionId =
  | "book"
  | "reschedule"
  | "cancel"
  | "checkIn"
  | "checkOut"
  | "noShow"
  | "note"
  | "todo"
  | "message"
  | "attorney"
  | "doi"
  | "status"
  | "open"
  | "schedule"
  | "todos"
  | "contact"
  | "lookup";

export type Slot = "patient" | "date" | "time" | "text" | "attorney" | "status" | "person";

export interface GoatAction {
  id: ActionId;
  /** Shown in the Handbook and on the "what did you mean?" chips. */
  label: string;
  /** Regex sources (whole words, after typo-fixing). */
  triggers: string[];
  required: Slot[];
  /** Messy example phrasings (tests run every one; the Handbook shows the first two). */
  examples: string[];
  /** One short question per missing slot. */
  ask?: Partial<Record<Slot, string>>;
}

export const GOAT_ACTIONS: GoatAction[] = [
  {
    id: "reschedule",
    label: "Reschedule a visit",
    triggers: ["re-?schedul\\w*", "resched\\w*", "move (?:his|her|their|the|my)?\\s*(?:appt|appointment|visit)", "(?:move|push|bump|shift|change|switch) \\S+(?: \\S+)?(?:'s)? (?:appt|appointment|visit|time)", "(?:push|bump|move|shift) (?:\\S+ )?(?:\\S+ )?(?:to|back|up|from)\\b", "shift", "mov (?:\\S+ )?(?:\\S+ )?(?:\\S+ )?(?:appointment|visit|to)"],
    required: ["patient", "date"],
    examples: ["reschedule john smith to friday at 10", "move jon smiths appt to tmrw 2pm", "push smith to next tuesday"],
    ask: { patient: "Whose visit should I move?", date: "Move it to when?" },
  },
  {
    id: "cancel",
    label: "Cancel a visit",
    triggers: ["cancel\\w*", "cancl\\w*", "cxl", "call off", "scratch", "delete (?:the |his |her )?(?:appt|appointment|visit)", "(?:can'?t|cannot|not|won'?t|will not) (?:make it|be coming|coming|come in|be in)", "take (?:\\S+ )?(?:\\S+ )?off (?:the )?(?:schedule|books|calendar)"],
    required: ["patient"],
    examples: ["cancel john smiths appt tmrw", "cxl smith friday", "john smith cant make it tomorrow"],
    ask: { patient: "Whose visit should I cancel?" },
  },
  {
    id: "noShow",
    label: "Mark a no-show",
    triggers: ["no[- ]?show\\w*", "didn'?t show", "never showed"],
    required: ["patient"],
    examples: ["mark john smith no show", "smith didnt show today"],
    ask: { patient: "Who didn't show?" },
  },
  {
    id: "checkIn",
    label: "Check in",
    triggers: ["check(?:ed|ing)?[- ]?in", "checkin", "check \\S+(?: \\S+)? in", "(?:is|just) (?:here|in)", "arrived", "showed up", "walked in", "(?:'s|is) here", "in the lobby", "here now", "here$"],
    required: ["patient"],
    examples: ["check in john smith", "smith is here", "jon smith arrived"],
    ask: { patient: "Who should I check in?" },
  },
  {
    id: "checkOut",
    label: "Check out",
    triggers: ["check(?:ed|ing)?[- ]?out", "checkout", "check \\S+(?: \\S+)? out", "(?:is )?(?:all )?done(?: for today)?$", "finished", "leaving", "left", "done with", "gone"],
    required: ["patient"],
    examples: ["check out john smith", "smith is done"],
    ask: { patient: "Who should I check out?" },
  },
  {
    id: "book",
    label: "Book a visit",
    triggers: ["book\\w*", "boo?k", "bk", "schedul\\w*", "sched", "set (?:up|him up|her up)", "make (?:an? )?(?:appt|appointment)", "(?:appt|appointment) for", "bring (?:\\S+ )?in", "put (?:\\S+ )?(?:\\S+ )?(?:in|on the schedule)", "get (?:\\S+ )?(?:\\S+ )?in", "squeeze", "pencil", "fit (?:\\S+ )?(?:\\S+ )?in", "on the books", "(?:wants|needs|like) to come in", "come in"],
    required: ["patient"],
    examples: ["book john smith tmrw at 3", "schedual jon smth wensday 2pm", "can u get smith in next tues morning", "set him up for friday", "appt for john smith 10/24 9:30"],
    ask: { patient: "Who should I book?" },
  },
  {
    id: "note",
    label: "Add a note",
    triggers: ["note", "notes", "jot", "chart (?:for|on|that)", "chart that", "log that", "write (?:down|that)", "add to (?:his|her|the) (?:file|chart)"],
    required: ["patient", "text"],
    examples: ["note for john smith: pain down to 4/10", "add a note to smith that he missed work", "jot down for jon smith mri scheduled"],
    ask: { patient: "Which patient is the note for?", text: "What should the note say?" },
  },
  {
    id: "todo",
    label: "Add a to-do",
    triggers: ["remind(?:er)?", "to[- ]?do", "task", "don'?t (?:let me )?forget", "need to remember"],
    required: ["text"],
    examples: ["remind me to call john smiths lawyer tmrw", "todo call mock law re records friday", "dont forget to fax smiths records"],
    ask: { text: "What's the to-do?" },
  },
  {
    id: "attorney",
    label: "Change the attorney",
    triggers: ["attorney", "atty", "lawyer", "law firm", "firm", "lawer"],
    required: ["patient", "attorney"],
    examples: ["change john smiths attorney to mock injury lawyers", "smith switched to test legal", "jon smith has a new lawyer sample law group"],
    ask: { patient: "Whose attorney changed?", attorney: "Which attorney?" },
  },
  {
    id: "doi",
    label: "Set the date of injury",
    triggers: ["doi", "dol", "date of (?:injury|loss|accident)", "accident (?:date|was)", "injury date", "got hurt on", "accident on"],
    required: ["patient", "date"],
    examples: ["set john smith doi to 9/1/2026", "smiths accident was 8/30", "date of injury for jon smith 09/01/26"],
    ask: { patient: "Whose date of injury?", date: "What's the date of injury?" },
  },
  {
    id: "status",
    label: "Change case status",
    triggers: ["status", "discharg\\w*", "d/c", "dc'?d", "drop(?:ped)?", "ready (?:to|2) (?:submit|bill)", "rts", "submitted", "submit", "re-?open\\w*", "back to active"],
    required: ["patient", "status"],
    examples: ["discharge john smith", "mark smith ready to submit", "jon smith dropped", "reopen smiths case"],
    ask: { patient: "Whose case?", status: "Which status?" },
  },
  {
    id: "message",
    label: "Message the team",
    triggers: ["tell", "let \\S+ know", "message", "msg", "ping", "dm"],
    required: ["person", "text"],
    examples: ["tell greg john smith is running late", "let abi know smith called"],
  },
  {
    id: "open",
    label: "Open a patient's case",
    triggers: ["open", "pull up", "pull", "go to", "bring up", "take me to", "show me", "load", "jump to", "opn"],
    required: ["patient"],
    examples: ["open john smiths case", "pull up smith", "take me to jon smith file", "opn smith chart"],
    ask: { patient: "Whose case should I open?" },
  },
  {
    id: "schedule",
    label: "See the schedule",
    triggers: ["who'?s? (?:is )?(?:coming|on the schedule|in)", "who (?:do we have|have we got|is booked)", "schedule (?:for )?(?:today|tomorrow)", "(?:appts|appointments|visits) (?:today|tomorrow|this week)", "what'?s? (?:on )?(?:the )?(?:schedule|calendar)"],
    required: [],
    examples: ["whos coming in today", "schedule for tmrw", "appointments this week"],
  },
  {
    id: "todos",
    label: "See your to-dos",
    triggers: ["(?:my|the|open) (?:to[- ]?dos?|tasks|list)", "what'?s? on my (?:list|plate)", "to[- ]?do list"],
    required: [],
    examples: ["whats on my to do list", "show my tasks"],
  },
  {
    id: "contact",
    label: "Look up a contact",
    triggers: ["(?:phone|fax|number|email|address)(?: number)? (?:for|of)", "(?:'s|s) (?:phone|fax|number|email)", "(?:phone|fax|email)(?: number)?$"],
    required: [],
    examples: ["fax for mock imaging", "mock injury lawyers phone number"],
  },
];

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m + n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Action words, for typo repair ("cancle" → "cancel", "resceduel" → "reschedule"). */
const VERBS = ["reschedule", "cancel", "schedule", "book", "check", "note", "remind", "reminder", "attorney", "lawyer", "discharge", "dropped", "submitted", "status", "open", "appointment", "tomorrow", "today", "message", "tell", "arrived", "finished", "pull", "injury", "accident"];
const KEEP = new Set(["books", "boom", "noted", "nope", "opens", "check", "chuck", "cancer", "tel", "tall", "toll", "todays", "lawyers", "statue", "pul", "pool", "remain", "remand", "note", "open", "book", "tell"]);

function fixTypos(text: string): string {
  return text.replace(/[A-Za-z]{4,}/g, (w) => {
    const l = w.toLowerCase();
    if (KEEP.has(l) || VERBS.some((v) => l.startsWith(v))) return w;
    let best: string | null = null;
    let bd = 9;
    for (const v of VERBS) {
      if (Math.abs(v.length - l.length) > 2 || v[0] !== l[0]) continue;
      const d = editDistance(l, v);
      const max = v.length >= 8 ? 2 : 1;
      if (d <= max && d < bd) {
        best = v;
        bd = d;
      }
    }
    return best ?? w;
  });
}

export function normalizeForIntent(raw: string): string {
  let t = normalizeCasual(raw.replace(/[’‘]/g, "'"));
  t = t.replace(/^(?:hey|hi|ok|okay|yo)\s+(?:goat\s*)?[,!]?\s*/i, "").replace(/^goat\s*[,:]\s*/i, "");
  t = t.replace(/\b(?:appt|apt|appnt)s?\b/gi, (m) => (m.toLowerCase().endsWith("s") ? "appointments" : "appointment"));
  t = t.replace(/\btues\b/gi, "tuesday").replace(/\bthurs?\b/gi, "thursday").replace(/\bweds?\b/gi, "wednesday");
  t = t.replace(/\bresched\b/gi, "reschedule").replace(/\bcxl\b/gi, "cancel").replace(/\bpt\b/gi, "patient");
  return fixTypos(t).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

export interface UPatient {
  id: string;
  fullName: string;
  caseStatus?: string;
}

/** "Smith, John" → { first: "John", last: "Smith", display: "John Smith" }. */
export function nameParts(fullName: string): { first: string; last: string; display: string } {
  const f = fullName.trim();
  if (f.includes(",")) {
    const [last, rest] = f.split(",");
    const first = rest.trim().split(/\s+/)[0] ?? "";
    return { first, last: last.trim(), display: `${rest.trim()} ${last.trim()}`.trim() };
  }
  const ws = f.split(/\s+/);
  return { first: ws[0] ?? "", last: ws.length > 1 ? ws[ws.length - 1] : "", display: f };
}

const NOT_NAMES = new Set(["the", "a", "an", "to", "for", "and", "at", "on", "in", "me", "my", "his", "her", "him", "them", "their", "today", "tomorrow", "next", "this", "that", "case", "file", "chart", "appointment", "visit", "note", "book", "open", "cancel", "check", "status", "attorney", "lawyer", "new", "is", "was", "out", "here", "done", "with", "of", "from", "pull", "up", "set", "change", "move", "mark", "call", "back", "time", "it", "be", "all", "can", "you", "please", "get", "take", "show", "go"]);

const tokenize = (t: string) => [...t.matchAll(/[A-Za-z][A-Za-z'-]*/g)].map((m) => ({ w: m[0].toLowerCase().replace(/'s$|s'$/, ""), raw: m[0], at: m.index ?? 0 }));

function close(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a === `${b}s`) return true;
  // Sound-alike first letters: kara/cara, katie/catie, phil/fil.
  const snd = (w: string) => w.replace(/^c(?=[aou])/, "k").replace(/^ph/, "f");
  if (a[0] !== b[0] && snd(a)[0] === snd(b)[0]) return close(snd(a), snd(b));
  if (a[0] !== b[0]) return false;
  if (a.length < 4 || b.length < 4) return Math.min(a.length, b.length) >= 3 && a.slice(0, 2) === b.slice(0, 2) && editDistance(a, b) <= 1;
  const d = editDistance(a, b);
  return d <= (Math.min(a.length, b.length) >= 7 ? 2 : 1);
}

export interface PatientHit {
  patient: UPatient | null;
  /** More than one patient fits. */
  ambiguous: UPatient[];
  /** The words that named the patient (removed from the rest). */
  span: [number, number] | null;
  viaPronoun: boolean;
}

const PRONOUN_RE = /\b(?:him|her|them|his|their|he|she|this patient|same patient|that patient|the patient)\b/i;

export function findPatient(text: string, patients: UPatient[], lastPatientId?: string | null): PatientHit {
  const toks = tokenize(text).filter((t) => !NOT_NAMES.has(t.w));
  const scored: Array<{ p: UPatient; score: number; span: [number, number] }> = [];
  for (const p of patients) {
    const { first, last } = nameParts(p.fullName);
    const fl = first.toLowerCase();
    const ll = last.toLowerCase();
    let fi = -1;
    let li = -1;
    toks.forEach((t, i) => {
      if (fi < 0 && close(t.w, fl)) fi = i;
      if (li < 0 && close(t.w, ll)) li = i;
    });
    if (fi < 0 && li < 0) continue;
    const exact = (i: number, n: string) => (i >= 0 && toks[i].w === n ? 0.25 : 0);
    const score = (fi >= 0 ? 1 : 0) + (li >= 0 ? 1.2 : 0) + exact(fi, fl) + exact(li, ll) + (fi >= 0 && li >= 0 && Math.abs(fi - li) === 1 ? 0.5 : 0) + (/active/i.test(p.caseStatus ?? "Active") ? 0.05 : 0);
    const idx = [fi, li].filter((i) => i >= 0);
    const a = toks[Math.min(...idx)];
    const b = toks[Math.max(...idx)];
    scored.push({ p, score, span: [a.at, b.at + b.raw.length] });
  }
  scored.sort((x, y) => y.score - x.score);
  if (scored.length) {
    const top = scored[0];
    const ties = scored.filter((s) => top.score - s.score < 0.3);
    if (ties.length === 1 || top.score >= 2) {
      const same = ties.filter((s) => s.score === top.score);
      if (same.length === 1) return { patient: top.p, ambiguous: [], span: top.span, viaPronoun: false };
    }
    return { patient: null, ambiguous: ties.map((s) => s.p), span: top.span, viaPronoun: false };
  }
  if (lastPatientId && PRONOUN_RE.test(text)) {
    const p = patients.find((x) => x.id === lastPatientId) ?? null;
    if (p) {
      const m = PRONOUN_RE.exec(text)!;
      return { patient: p, ambiguous: [], span: [m.index, m.index + m[0].length], viaPronoun: true };
    }
  }
  return { patient: null, ambiguous: [], span: null, viaPronoun: false };
}

// ---------------------------------------------------------------------------
// Dates / times
// ---------------------------------------------------------------------------

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIso = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const plusDays = (s: string, n: number) => {
  const d = fromIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};

export interface DateHit {
  iso: string;
  span: [number, number];
  words: string;
}

export function findDate(text: string, today: string, allowPast = false): DateHit | null {
  const t = text.toLowerCase();
  const hit = (re: RegExp, f: (m: RegExpExecArray) => string | null): DateHit | null => {
    const m = re.exec(t);
    if (!m) return null;
    const v = f(m);
    return v ? { iso: v, span: [m.index, m.index + m[0].length], words: text.slice(m.index, m.index + m[0].length) } : null;
  };
  return (
    hit(/\bday after tomorrow\b/, () => plusDays(today, 2)) ??
    hit(/\btomorrow\b/, () => plusDays(today, 1)) ??
    hit(/\btoday\b|\btonight\b|\bthis (?:morning|afternoon|evening)\b/, () => today) ??
    hit(/\byesterday\b/, () => plusDays(today, -1)) ??
    hit(/\bin (\d+|a|one|two|three) (day|week)s?\b/, (m) => {
      const n = { a: 1, one: 1, two: 2, three: 3 }[m[1] as "a"] ?? Number(m[1]);
      return plusDays(today, n * (m[2] === "week" ? 7 : 1));
    }) ??
    hit(/\bnext week\b/, () => {
      const d = fromIso(today).getDay();
      return plusDays(today, ((8 - d) % 7) || 7);
    }) ??
    hit(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
      const mo = Number(m[1]);
      const da = Number(m[2]);
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(today.slice(0, 4));
      let v = `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
      if (!m[3] && !allowPast && v < today) {
        y += 1;
        v = `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
      }
      return v;
    }) ??
    hit(new RegExp(`\\b(next |this |on )?(${DAYS.join("|")}|mon|tue|wed|thu|fri|sat|sun)s?\\b`), (m) => {
      const name = m[2];
      const target = DAYS.findIndex((d) => d.startsWith(name.slice(0, 3)));
      const cur = fromIso(today).getDay();
      let diff = (target - cur + 7) % 7;
      if (diff === 0) diff = m[1] === "next " ? 7 : 0;
      else if (m[1] === "next " && diff < 7 && cur !== 0 && target > cur) diff += 0;
      return plusDays(today, diff);
    })
  );
}

export interface TimeHit {
  hhmm: string;
  span: [number, number];
  words: string;
  /** "morning"/"afternoon" with no clock time. */
  approximate?: boolean;
}

export function findTime(text: string): TimeHit | null {
  const t = text.toLowerCase().replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, (m) => " ".repeat(m.length));
  if (/\bnoon\b/.test(t)) {
    const i = t.indexOf("noon");
    return { hhmm: "12:00", span: [i, i + 4], words: "noon" };
  }
  const re = /(?:\bat\s+|@\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p)?(?![\w/:])/g;
  let best: (TimeHit & { score: number }) | null = null;
  for (const m of t.matchAll(re)) {
    let hh = Number(m[1]);
    const mm = Number(m[2] ?? 0);
    if (hh > 23 || mm > 59) continue;
    const mer = m[3]?.[0];
    const at = /^(at\s|@)/.test(m[0]);
    const after = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 8);
    if (/^\s*(?:\/|weeks?|days?|months?|visits?|mm|%|x\b)/.test(after)) continue;
    const score = (mer ? 3 : 0) + (m[2] ? 2 : 0) + (at ? 2 : 0) + (/(?:mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\w*\s+$|(?:today|tomorrow|tmrw)\s+$/.test(t.slice(0, m.index ?? 0)) ? 1 : 0);
    if (!score) continue;
    if (mer === "p" && hh < 12) hh += 12;
    else if (mer === "a" && hh === 12) hh = 0;
    else if (!mer && hh >= 1 && hh <= 6) hh += 12;
    const v = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    if (!best || score > best.score) best = { hhmm: v, span: [m.index ?? 0, (m.index ?? 0) + m[0].length], words: text.slice(m.index ?? 0, (m.index ?? 0) + m[0].length).trim(), score };
  }
  if (best) return { hhmm: best.hhmm, span: best.span, words: best.words };
  const part = /\b(?:in the )?(morning|afternoon|evening)\b/.exec(t);
  if (part) return { hhmm: part[1] === "morning" ? "09:00" : part[1] === "afternoon" ? "14:00" : "17:00", span: [part.index, part.index + part[0].length], words: part[0], approximate: true };
  return null;
}

// ---------------------------------------------------------------------------
// Templates (for learning: names / dates / times become slots)
// ---------------------------------------------------------------------------

export function phraseTemplate(text: string, patients: UPatient[], today: string, otherNames: string[] = []): string {
  let t = normalizeForIntent(text);
  const spans: Array<[number, number, string]> = [];
  const p = findPatient(t, patients);
  if (p.span) spans.push([...p.span, "{patient}"]);
  const d = findDate(t, today, true);
  if (d) spans.push([...d.span, "{date}"]);
  const tm = findTime(t);
  if (tm) spans.push([...tm.span, "{time}"]);
  spans.sort((a, b) => b[0] - a[0]);
  let last = Infinity;
  for (const [a, b, s] of spans) {
    if (b > last) continue;
    t = `${t.slice(0, a)}${s}${t.slice(b)}`;
    last = a;
  }
  // Any word that is some patient's first or last name → {name} (so no name is ever saved).
  const names = new Set<string>();
  for (const pt of patients) {
    const n = nameParts(pt.fullName);
    for (const w of [n.first, n.last]) if (w && w.length >= 3) names.add(w.toLowerCase());
  }
  // Contacts and attorneys too ("call mike at test legal" → "call {name} at {name} {name}").
  const exact = new Set<string>();
  for (const full of otherNames) for (const w of full.toLowerCase().split(/[^a-z']+/)) if (w.length >= 3 && !NOT_NAMES.has(w) && !GENERIC_ORG.has(w)) exact.add(w);
  t = t.replace(/[A-Za-z][A-Za-z'-]*/g, (w) => {
    const l = w.toLowerCase().replace(/'s$/, "");
    if (l.length < 3 || NOT_NAMES.has(l)) return w;
    if (exact.has(l)) return "{name}";
    for (const n of names) if (close(l, n)) return "{name}";
    return w;
  });
  // Any remaining Capitalized words (a name G.O.A.T. didn't know) and digits are generalized too.
  return t
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, "{name}")
    .replace(/\d+/g, "{n}")
    .toLowerCase()
    .replace(/[^a-z{}' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface UContext {
  today: string;
  patients: UPatient[];
  lastPatientId?: string | null;
  /** Office attorneys (for "switched to test legal"). */
  attorneys?: string[];
  /** Team first names (message recipients). */
  team?: string[];
  /** Learned template → action (cloud-saved), tried first. */
  learned?: Record<string, ActionId>;
  /** Other names in the workspace (contacts, attorneys) scrubbed from saved wording. */
  names?: string[];
  /** A typed correction already said which action ("no, book it"). */
  force?: ActionId;
}

export interface Understood {
  action: ActionId;
  patient: UPatient | null;
  ambiguous: UPatient[];
  date: DateHit | null;
  time: TimeHit | null;
  text: string;
  attorney: string;
  status: string;
  /** The phrase the existing G.O.A.T. paths understand (null for actions handled directly). */
  canonical: string | null;
  /** One short question when a required detail is missing. */
  ask: string | null;
  learned: boolean;
  template: string;
  /** Reschedule "from thursday to friday": the visit being moved. */
  fromDate?: string;
}

const STATUS: Array<[RegExp, string]> = [
  [/\bready (?:to|2) (?:submit|bill)\b|\brts\b/i, "Ready To Submit"],
  [/\bsubmit(?:ted)?\b/i, "Submitted"],
  [/\bdischarg\w*|\bd\/c\b|\bdc'?d\b/i, "Discharged"],
  [/\bdrop(?:ped)?\b/i, "Dropped"],
  [/\bre-?open\w*|\bback to active\b|\bactive\b/i, "Active"],
];

const ACTION_RES = GOAT_ACTIONS.map((a) => ({ a, re: new RegExp(`(?<![A-Za-z])(?:${a.triggers.join("|")})(?![A-Za-z])`, "i") }));
const QUESTION = /^(?:when|what|whats|what's|did|does|has|have|is|are|was|were|how|any|which|who)\b/i;

function cut(text: string, spans: Array<[number, number] | null | undefined>): string {
  let t = text;
  for (const s of spans.filter((x): x is [number, number] => Boolean(x)).sort((a, b) => b[0] - a[0])) t = `${t.slice(0, s[0])} ${t.slice(s[1])}`;
  return t.replace(/\s+/g, " ").trim();
}

function pickAction(t: string, hasPatient: boolean, attorneys: string[] = []): ActionId | null {
  const l = t.toLowerCase();
  const hits = ACTION_RES.filter(({ re }) => re.test(l)).map(({ a }) => a.id);
  // "smith switched to test legal": a known firm after switched/moved/went to.
  const sw = /\b(?:switched|switching|moved|went|transferred|changed)\s+(?:over\s+)?(?:to|with)\s+(.+)$/i.exec(l);
  if (sw && hasPatient && attorneys.some((a) => a.toLowerCase().startsWith(sw[1].trim().split(/\s+/).slice(0, 2).join(" ")))) return "attorney";
  // Just "show kim" / "find smith".
  if (hasPatient && /^(?:show|find|see)\b/.test(l) && l.split(" ").length <= 4 && !/\b(?:appointments?|schedule|tasks?|to-?dos?)\b/.test(l)) return "open";
  if (!hits.length) return null;
  const has = (id: ActionId) => hits.includes(id);
  if (has("todos") && !hasPatient) return "todos";
  if (/\bremind me\b/.test(l)) return "todo";
  // "move smith to ready to submit" is a status change, not a reschedule.
  if (has("status") && hasPatient && /\b(?:move|mark|set|put|switch|change)\b/.test(l) && STATUS.some(([re]) => re.test(l))) return "status";
  if (has("schedule") && !hasPatient) return "schedule";
  if (has("contact") && !hasPatient) return "contact";
  // Order matters: the most specific wins.
  if (has("todo") && /^(?:please )?(?:remind|to-?do|todo|task|don'?t forget|need to remember|add (?:a )?(?:to-?do|task|reminder))/i.test(l)) return "todo";
  if (has("note") && /^(?:please )?(?:add (?:a )?)?(?:note|jot|chart that|log that|write)/i.test(l)) return "note";
  if (has("message") && /^(?:please )?(?:tell|let \S+ know|message|msg|ping|dm)\b/i.test(l)) return "message";
  if (has("doi")) return "doi";
  for (const id of ["reschedule", "cancel", "noShow", "checkIn", "checkOut"] as ActionId[]) if (has(id)) return id;
  if (has("attorney") && /\b(?:change|switch\w*|set|update|new|now|is|moved|went|to)\b/i.test(l) && !QUESTION.test(l)) return "attorney";
  if (has("status") && !QUESTION.test(l) && hasPatient) return "status";
  if (has("open") && hasPatient) return "open";

  if (has("book")) return "book";
  if (has("note")) return "note";
  if (has("todo")) return "todo";
  if (has("schedule")) return "schedule";
  if (has("todos")) return "todos";
  if (has("contact")) return "contact";
  return null;
}

export function understand(raw: string, ctx: UContext): Understood | null {
  if (!raw.trim() || raw.trim().startsWith("/") || raw.trim().startsWith("@")) return null;
  const t = normalizeForIntent(raw);
  const template = phraseTemplate(raw, ctx.patients, ctx.today, [...(ctx.names ?? []), ...(ctx.attorneys ?? [])]);
  const hit = findPatient(t, ctx.patients, ctx.lastPatientId);
  const learnedAction = ctx.learned?.[template];
  let action: ActionId | null = ctx.force ?? learnedAction ?? pickAction(t, Boolean(hit.patient || hit.ambiguous.length), ctx.attorneys);
  // "kara kim re exam 10/30 at 3": a patient plus a day/time and nothing else → book.
  if (!action && hit.patient && (findTime(t) || findDate(t, ctx.today)) && !QUESTION.test(t)) {
    const left = cut(t, [hit.span, findDate(t, ctx.today)?.span, findTime(t)?.span]).replace(/\b(?:re[- ]?exam|new patient|follow[- ]?up|massage|for|a|an|at|on|the|visit|please|pls)\b/gi, "").trim();
    if (!left) action = "book";
  }
  if (!action) {
    // A question about a named patient ("when was jon smiths mri") → the file lookup.
    if ((hit.patient || hit.ambiguous.length) && (QUESTION.test(t) || /\?$/.test(t))) action = "lookup";
    else return null;
  }
  const allowPast = action === "doi";
  let date = findDate(t, ctx.today, allowPast);
  let fromDate: string | undefined;
  let time = action === "doi" ? null : findTime(t);
  // "move smith from tmrw to thursday at 3": the new day/time is the part after "to".
  if (action === "reschedule") {
    const at = t.toLowerCase().lastIndexOf(" to ");
    if (at > 0) {
      const tail = t.slice(at + 4);
      const d2 = findDate(tail, ctx.today);
      const t2 = findTime(tail);
      if (d2) date = { ...d2, span: [d2.span[0] + at + 4, d2.span[1] + at + 4] };
      if (t2) time = { ...t2, span: [t2.span[0] + at + 4, t2.span[1] + at + 4] };
      if (d2 && !t2 && time && time.span[0] < at) time = null;
      const fm = /\bfrom\s+(.+)$/i.exec(t.slice(0, at));
      if (fm) fromDate = findDate(fm[1], ctx.today)?.iso;
    }
  }
  const def = GOAT_ACTIONS.find((a) => a.id === action);
  const out: Understood = { action, patient: hit.patient, ambiguous: hit.ambiguous, date, time, text: "", attorney: "", status: "", canonical: null, ask: null, learned: Boolean(learnedAction), template, fromDate };
  const who = hit.patient ? nameParts(hit.patient.fullName).display : "";
  const rest = cut(t, [hit.viaPronoun ? null : hit.span, date?.span, time?.span]);

  switch (action) {
    case "book": {
      const extra = rest.replace(new RegExp(ACTION_RES.find((x) => x.a.id === "book")!.re.source, "ig"), " ").replace(/\b(?:can|could|you|please|for|an?|appointment|in|on|at|him|her|them|the|me|up|next)\b/gi, " ").replace(/\s+/g, " ").trim();
      const typeWords = /\b(re-?exam|new patient|follow[- ]?up|massage|decomp\w*|x-?ray|eval\w*)\b/i.exec(extra)?.[0] ?? "";
      if (who) out.canonical = ["book", who, typeWords, date?.words ?? "", time?.words ?? ""].filter(Boolean).join(" ").replace(/\s+/g, " ");
      break;
    }
    case "todo": {
      let body = t
        .replace(/^(?:please\s+)?(?:can you\s+)?(?:remind me (?:to\s+)?|add (?:a\s+)?(?:to-?do|task|reminder)\s*(?:to\s+|:)?\s*|to-?do\s*:?\s*|todo\s*:?\s*|task\s*:?\s*|don'?t (?:let me )?forget (?:to\s+)?|need to remember (?:to\s+)?)/i, "")
        .trim();
      if (hit.patient && hit.viaPronoun) body = body.replace(/\b(?:his|her|their)\b/i, `${who}'s`).replace(/\b(?:him|them)\b/i, who);
      out.text = body;
      out.canonical = body ? `remind me to ${body}` : null;
      break;
    }
    case "note": {
      const after = /[:\-–—]\s*(.+)$/.exec(t)?.[1] ?? /\b(?:that|saying|says)\s+(.+)$/i.exec(t)?.[1] ?? cut(rest, []).replace(/^(?:add\s+)?(?:a\s+)?(?:note|jot(?:\s+down)?|chart that|log that|write(?:\s+down)?)\s*(?:to|for|on|in)?\s*(?:his|her|the)?\s*(?:file|chart)?\s*/i, "");
      out.text = (after ?? "").trim();
      if (who && out.text) out.canonical = `add a note for ${who}: ${out.text}`;
      break;
    }
    case "attorney": {
      const m = /\b(?:to|is(?: now)?|now|:|=|with|lawyer|attorney|atty|firm|group)\s+(?!(?:his|her|the|a)\b)([a-z0-9&.,' -]{3,})$/i.exec(cut(t, [hit.viaPronoun ? null : hit.span]));
      let a = (m?.[1] ?? "").replace(/^(?:is|now|to)\s+/i, "").replace(/\b(?:now|instead|please|pls|thanks?)\b/gi, "").trim();
      if (/^(?:attorney|lawyer|atty|firm|law firm)$/i.test(a)) a = "";
      const known = (ctx.attorneys ?? []).filter((x) => x.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(x.toLowerCase().split(/\s+/)[0]));
      out.attorney = known.length === 1 ? known[0] : a;
      if (who && out.attorney) out.canonical = `change ${who}'s attorney to ${out.attorney}`;
      break;
    }
    case "status": {
      out.status = STATUS.find(([re]) => re.test(t))?.[1] ?? "";
      if (who && out.status) out.canonical = `mark ${who} as ${out.status.toLowerCase()}`;
      break;
    }
    case "message":
      out.canonical = t;
      out.text = t;
      out.ask = null;
      return out;
    case "schedule":
    case "todos":
    case "contact":
    case "lookup":
      out.canonical = t;
      return out;
    default:
      break;
  }

  // One short question for the first missing required detail.
  if (!out.patient && def?.required.includes("patient")) {
    out.ask = out.ambiguous.length ? `Which ${nameParts(out.ambiguous[0].fullName).last || "one"} — ${out.ambiguous.slice(0, 3).map((p) => nameParts(p.fullName).display).join(", or ")}?` : def.ask?.patient ?? "Which patient?";
  } else if (action === "reschedule" && !date && !time) out.ask = def?.ask?.date ?? null;
  else if (action === "doi" && !date) out.ask = def?.ask?.date ?? null;
  else if (action === "note" && !out.text) out.ask = def?.ask?.text ?? null;
  else if (action === "todo" && !out.text) out.ask = def?.ask?.text ?? null;
  else if (action === "attorney" && !out.attorney) out.ask = def?.ask?.attorney ?? null;
  else if (action === "status" && !out.status) out.ask = def?.ask?.status ?? null;
  return out;
}

/** Plain list for the Handbook: "Book a visit — "book john smith tmrw at 3"". */
export function handbookPhrases(): string[] {
  return GOAT_ACTIONS.map((a) => `${a.label}: "${a.examples[0]}"${a.examples[1] ? ` or "${a.examples[1]}"` : ""}.`);
}

const GENERIC_ORG = new Set(["law", "legal", "group", "firm", "office", "offices", "and", "the", "llp", "pllc", "inc", "associates", "injury", "attorneys", "attorney", "clinic", "center", "imaging", "medical", "health", "insurance"]);

// ---------------------------------------------------------------------------
// Typed corrections: "no I wanted you to book it", "not a note, a to-do", "I meant reschedule"
// ---------------------------------------------------------------------------

const CORRECTION_WORDS: Array<[RegExp, ActionId]> = [
  [/\b(?:re-?schedul\w*|resched|move|push|bump)\b/, "reschedule"],
  [/\b(?:cancel\w*|cxl)\b/, "cancel"],
  [/\bno[- ]?show\b/, "noShow"],
  [/\bcheck(?:ed)?[- ]?(?:\S+ )?in\b/, "checkIn"],
  [/\bcheck(?:ed)?[- ]?(?:\S+ )?out\b/, "checkOut"],
  [/\b(?:to-?do|task|reminder|remind)\b/, "todo"],
  [/\bnote\b/, "note"],
  [/\b(?:attorney|lawyer|atty)\b/, "attorney"],
  [/\b(?:date of (?:injury|loss)|doi|injury date)\b/, "doi"],
  [/\bstatus\b/, "status"],
  [/\b(?:open|pull up|go to)\b/, "open"],
  [/\b(?:book\w*|bk|appointment|visit|schedule (?:it|him|her|them))\b/, "book"],
  [/\b(?:message|tell|text)\b/, "message"],
];

const CORRECTION_START = /^(?:nope\b|nah\b|no+\b|wrong\b|not (?:that|a|an|the)\b|that'?s not|thats not|i meant|i mean|meant|i wanted|i said|actually|not what i)/;

/**
 * A reply that corrects G.O.A.T.'s last result. Returns the action meant and any extra
 * detail ("to friday"), or null when the message isn't a correction.
 */
export function detectCorrection(raw: string): { action: ActionId; detail: string } | null {
  let t = normalizeForIntent(raw).toLowerCase().replace(/[.!]+$/, "").trim();
  if (!CORRECTION_START.test(t)) return null;
  // Drop the part that names the wrong action: "not a note, a to-do" → "a to-do".
  t = t.replace(/\bnot (?:a|an|the)?\s*[a-z-]+(?:\s+[a-z-]+)?\s*[,;]\s*/, " ");
  t = t.trim().replace(/^(?:nope|nah|no+|wrong|actually)\b[,!.\s]*/, "").replace(/^(?:that'?s|thats) not what i (?:meant|wanted)[,.\s]*/, "");
  let best: { action: ActionId; at: number } | null = null;
  for (const [re, action] of CORRECTION_WORDS) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.at)) best = { action, at: m.index };
  }
  if (!best) return null;
  const used = CORRECTION_WORDS.find(([, a]) => a === best!.action)![0];
  const detail = t
    .replace(new RegExp(used.source), " ")
    .trim()
    .replace(/^(?:i (?:meant|mean|wanted|said)|meant)\s+(?:you\s+)?(?:to\s+)?/, "")
    .replace(/^(?:a|an|the)\s+/, "")
    .replace(/\bi (?:meant|mean|said|wanted)\b|\bmeant\b/g, " ")
    .replace(/\b(?:it|that|this|instead|please|pls|one|wanted|you|a|an|to)\b(?!\s+(?:mon|tue|wed|thu|fri|sat|sun|tomorrow|today|next|\d))/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { action: best.action, detail };
}
