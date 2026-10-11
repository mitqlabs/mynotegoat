/**
 * G.O.A.T. Smart mode (beta) — the whole report for the model (pure, no I/O).
 *
 * The rules pick WHICH report (doctor / contact / specialty match, reports
 * over referral forms, newest first). Smart mode then reads that report's
 * full extracted text, not just the lines the rules matched, so it can find
 * recommendations however a doctor writes them ("comment:" blocks under each
 * numbered diagnosis, "candidate for", "may require up to 3 …").
 *
 * Long reports are cut into context-sized chunks with the Plan,
 * Recommendations, Assessment and Impression parts first.
 */

import type { GoatContext } from "@/lib/goat";
import { classifyDoc, docDate, isImagingReport, resolveWho, surnameOf, type GoatDocType, type GoatFile } from "@/lib/goat-docs";
import { groupsInQuestion, makeMatcher } from "@/lib/goat-terms";

export interface ReportPick {
  file: GoatFile;
  docType: GoatDocType;
  date: string;
  dateLabel: "dated" | "uploaded";
  /** Doctor / contact names the report matched. */
  who: string[];
  /** How it was chosen, for the answer's source line. */
  how: "rules" | "doctor" | "specialty" | "best guess";
  /** Other matching reports not read (older). */
  others: string[];
}

const REC_SIGNAL = /\b(recommend\w*|candidate|alternative|options?|consider|may require|planned?|orders?|injections?|blocks?|ablation|epidural|therapy|sessions?|surgery|follow[- ]?up|return|medications?|\d+\s*mg)\b|\$\s?\d/gi;

function fullText(f: GoatFile): string {
  return (f.pages ?? []).join("\n");
}

function signalScore(text: string): number {
  return (text.match(REC_SIGNAL) ?? []).length;
}

/**
 * Which report Smart mode reads in full. `ruleFileId` is the file the rules
 * already answered from (e.g. the Recommendations answer), when there is one.
 */
export function pickReport(ctx: GoatContext, question: string, ruleFileId?: string | null): ReportPick | null {
  const files = (ctx.files ?? []).filter((f) => f.status === "read" && f.pages && f.pages.some((p) => p.trim()));
  if (!files.length) return null;
  const people = ctx.people ?? [];
  const asked = groupsInQuestion(question, ctx.termGroups ?? []);
  const who = resolveWho(question, asked, people);
  // "dr armen", "premier pain": any name part of 4+ letters names the contact too.
  for (const p of people) {
    if (who.people.includes(p)) continue;
    const parts = p.name.replace(/\(.*?\)/g, " ").split(/[^A-Za-z'-]+/).filter((w) => w.length >= 4 && !/^(doctor|clinic|center|centre|medical|group|health|care|associates|solutions|institute|pain|spine)$/i.test(w));
    if (parts.some((w) => new RegExp(`\\b${w.replace(/[^A-Za-z'-]/g, "")}\\b`, "i").test(question))) who.people.push(p);
  }
  const whoMatchers = who.people.map((p) => ({ name: p.name, m: makeMatcher([p.name, surnameOf(p.name)].filter((t) => t.length >= 3)) }));
  const specialty = makeMatcher(who.specialtyGroups.flatMap((g) => g.terms).filter((t) => t.length > 3));
  const wantsReferral = /\b(referral|referred|order form|authori[sz]ation)\b/i.test(question);

  type Cand = { file: GoatFile; type: GoatDocType; who: string[]; whoScore: number; ts: number; date: string; label: "dated" | "uploaded"; signal: number };
  const cands: Cand[] = files.map((file) => {
    const text = fullText(file);
    const names = whoMatchers.filter(({ m }) => m.test(text) || m.test(file.name)).map(({ name }) => name);
    const whoScore = names.length ? 2 : specialty.terms.length && (specialty.test(text) || specialty.test(file.name)) ? 1 : 0;
    const { date, label } = docDate(file);
    const [mm, dd, yy] = date.split("/").map(Number);
    const ts = yy ? Date.UTC(yy, (mm || 1) - 1, dd || 1) : Date.parse(file.uploaded) || 0;
    return { file, type: classifyDoc(file), who: names, whoScore, ts, date, label, signal: signalScore(text) };
  });
  const usable = (c: Cand) => wantsReferral || c.type !== "referral";
  const finish = (list: Cand[], how: ReportPick["how"]): ReportPick | null => {
    const sorted = list.filter(usable).sort((a, b) => (b.type === "report" ? 1 : 0) - (a.type === "report" ? 1 : 0) || b.ts - a.ts);
    const best = sorted[0];
    if (!best) return null;
    return { file: best.file, docType: best.type, date: best.date, dateLabel: best.label, who: best.who, how, others: sorted.slice(1, 4).map((c) => c.file.name) };
  };

  if (ruleFileId) {
    const c = cands.find((x) => x.file.id === ruleFileId);
    if (c) {
      const rest = cands.filter((x) => x !== c && x.whoScore > 0 && usable(x));
      return { file: c.file, docType: c.type, date: c.date, dateLabel: c.label, who: c.who, how: "rules", others: rest.slice(0, 3).map((x) => x.file.name) };
    }
  }
  const byDoctor = cands.filter((c) => c.whoScore === 2);
  if (byDoctor.length) return finish(byDoctor, "doctor");
  const bySpecialty = cands.filter((c) => c.whoScore === 1);
  if (bySpecialty.length) return finish(bySpecialty, "specialty");
  // Nothing named: the report most likely to hold a plan (not imaging, most recommendation wording), newest first.
  const guess = cands
    .filter((c) => usable(c) && c.signal >= 2 && !isImagingReport(c.file, []))
    .sort((a, b) => (b.type === "report" ? 1 : 0) - (a.type === "report" ? 1 : 0) || b.signal - a.signal || b.ts - a.ts);
  if (!guess.length) return null;
  const best = guess[0];
  return { file: best.file, docType: best.type, date: best.date, dateLabel: best.label, who: best.who, how: "best guess", others: guess.slice(1, 4).map((c) => c.file.name) };
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

export interface ReportLine {
  text: string;
  page: number;
  /** Order in the document. */
  index: number;
  /** 0 = Plan / Recommendations / Orders, 1 = Assessment / Impression / Diagnoses, 2 = everything else, 3 = letterhead. */
  priority: number;
}

export interface ReportChunk {
  lines: ReportLine[];
  /** Has recommendation wording worth a model pass. */
  signal: number;
  priority: number;
}

const PLAN_HEADING = /^\s*(?:\d+[.)]\s*)?(plan(?:\s*(?:\/|and|&)\s*(?:orders|recommendations?))?|plan of care|treatment plan|treatment recommendations?|recommendations?|orders|disposition|discussion and plan|assessment\s*(?:\/|and|&)\s*plan|a\s*\/\s*p)\b\s*[:\-–]?/i;
const ASSESS_HEADING = /^\s*(?:\d+[.)]\s*)?(assessment|impressions?|diagnos[ie]s|discussion|summary|conclusions?|opinion)\b\s*[:\-–]?/i;
const OTHER_HEADING = /^\s*(?:\d+[.)]\s*)?(chief complaint|history|hpi|history of present illness|past (?:medical|surgical) history|social history|family history|review of systems|ros|physical exam\w*|examination|exam|vitals?|vital signs|diagnostic (?:studies|tests?)|imaging|objective|subjective|allergies|current medications)\b\s*[:\-–]?/i;
const END_LINE = /\b(electronically signed|signed by|dictated by|thank you for (?:the|this) referral|sincerely)\b/i;

/** The report as lines (pages joined, wrapped lines rejoined), each tagged with its part of the report. */
export function reportLines(file: GoatFile): ReportLine[] {
  const out: ReportLine[] = [];
  let priority = 3;
  let seenHeading = false;
  let index = 0;
  (file.pages ?? []).forEach((page, p) => {
    const raw = page.replace(/\r/g, "").split("\n");
    // Rejoin wrapped lines: a line that starts lower-case (or with a digit/level after a hyphen) continues the previous one.
    const lines: string[] = [];
    for (const l of raw) {
      const t = l.replace(/\s+/g, " ").trim();
      if (!t) continue;
      const prev = lines[lines.length - 1];
      if (prev !== undefined && /^[a-z(]/.test(t) && !/[.:;!?]$/.test(prev)) lines[lines.length - 1] = `${prev} ${t}`;
      else if (prev !== undefined && (/[-–]$/.test(prev) || /\b(and|or|of|to|at|the|with|for|in|a|an|by|per|from|on)$/i.test(prev)) && !/[.:;!?]$/.test(prev))
        lines[lines.length - 1] = `${prev} ${t}`;
      else lines.push(t);
    }
    for (const t of lines) {
      if (PLAN_HEADING.test(t)) {
        priority = 0;
        seenHeading = true;
      } else if (ASSESS_HEADING.test(t) && !(priority === 0 && /^\s*\d+[.)]/.test(t))) {
        priority = 1;
        seenHeading = true;
      } else if (OTHER_HEADING.test(t) && !(priority <= 1 && /^\s*\d+[.)]/.test(t))) {
        priority = 2;
        seenHeading = true;
      } else if (!seenHeading && index > 8) priority = 2;
      if (END_LINE.test(t)) priority = 3;
      out.push({ text: t, page: p + 1, index: index++, priority });
    }
  });
  return out;
}

/**
 * Lines → chunks of at most `maxChars`, the Plan / Recommendations part first,
 * then Assessment / Impression, then the rest; each chunk in document order.
 */
export function chunkReport(file: GoatFile, maxChars: number): ReportChunk[] {
  const lines = reportLines(file);
  // Sections: runs of lines in the same part of the report, kept together where they fit.
  const sections: ReportLine[][] = [];
  for (const l of lines) {
    const last = sections[sections.length - 1];
    if (last && last[0].priority === l.priority) last.push(l);
    else sections.push([l]);
  }
  const ordered = [0, 1, 2, 3].flatMap((p) => sections.filter((s) => s[0].priority === p));
  const chunks: ReportChunk[] = [];
  let cur: ReportLine[] = [];
  let size = 0;
  const flush = () => {
    if (!cur.length) return;
    const sorted = [...cur].sort((a, b) => a.index - b.index);
    const text = sorted.map((l) => l.text).join("\n");
    chunks.push({ lines: sorted, signal: signalScore(text), priority: Math.min(...cur.map((l) => l.priority)) });
    cur = [];
    size = 0;
  };
  for (const section of ordered) {
    const sectionSize = section.reduce((n, l) => n + l.text.length + 1, 0);
    // A whole section that doesn't fit the room left starts a new chunk (a huge one is split by line).
    if (size && size + sectionSize > maxChars && sectionSize <= maxChars) flush();
    for (const l of section) {
      const t = l.text.length > maxChars ? { ...l, text: l.text.slice(0, maxChars) } : l;
      if (size + t.text.length + 1 > maxChars) flush();
      cur.push(t);
      size += t.text.length + 1;
    }
  }
  flush();
  return chunks;
}

export function chunkText(c: ReportChunk): string {
  return c.lines.map((l) => l.text).join("\n");
}
