/**
 * G.O.A.T. Smart mode (beta) — retrieval (pure, no I/O).
 *
 * Before the in-browser model sees anything, this picks the few pieces of the
 * patient file that can answer the question, using G.O.A.T.'s own search:
 * the office's synonym groups, doctor/specialty → contact linking, reports
 * over referral forms, and body regions. Only those pieces (numbered S1, S2…)
 * go into the prompt, within the model's small context budget. Nothing here
 * leaves the browser; the model also runs in the browser (see engine.ts).
 */

import { askGoat, plainText, type GoatAnswer, type GoatContext, type GoatResult, type GoatSection } from "@/lib/goat";
import { classifyDoc, docDate, docUnits, isImagingReport, resolveWho, surnameOf, type DocUnit, type GoatDocType, type GoatFile } from "@/lib/goat-docs";
import { groupsInQuestion, makeMatcher, type TermMatcher } from "@/lib/goat-terms";
import { regionsNamedIn, type BodyRegion } from "@/lib/goat-regions";

export interface AiSourceLine {
  text: string;
  page?: number;
}

export interface AiSource {
  /** "S1", "S2", … as cited in the prompt. */
  id: string;
  /** File name, or the page section ("Visits", "MRI / CT panel"). */
  title: string;
  kind: "file" | "page";
  docType?: GoatDocType;
  /** MM/DD/YYYY with how it was found ("dated" in the document, else "uploaded"). */
  date?: string;
  dateLabel?: "dated" | "uploaded";
  who?: string[];
  fileId?: string;
  section?: GoatSection;
  lines: AiSourceLine[];
}

export function detectIntents(question: string): AiIntent[] {
  return INTENTS.filter((it) => it.ask.test(question)).map((it) => it.name);
}

/**
 * Long report paragraphs → one sentence / bullet clause per line, so a small
 * model sees the structure ("-As an alternative to …" starts its own line).
 */
export function splitForModel(text: string): string[] {
  text = text.replace(/\s+/g, " ").trim();
  // "Range of motion of the cervical spine is 30 degrees in anterior flexion with pain, 50 degrees …"
  // → a label line, then one motion per line (exact words kept).
  const rom = /^(.*?\brange of motion\b[^.:]*?)\s+(?:is|was|are|were|:)\s+(.+?\bdegrees?\b.+)$/i.exec(text.trim());
  if (rom && /,/.test(rom[2])) {
    const items = rom[2]
      .replace(/\.$/, "")
      .split(/,\s*(?:and\s+)?|\s+and\s+(?=\d)/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (items.length >= 2 && items.every((t) => /\d/.test(t))) return [`${rom[1].trim()}:`, ...items.map((t) => `  ${t}`)];
  }
  if (text.length < 160) return [text];
  return text
    .split(/(?<=[^0-9][.;])\s+(?=[-A-Z0-9])|\s*(?<=[.:])\s*-(?=[A-Z])|\s+(?=\d{1,2}\.\s+[A-Z])/)
    .map((t) => t.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

export interface AiRetrieval {
  sources: AiSource[];
  /** The rule-based result for the same question (used for the fallback and for counts/dates). */
  result: GoatResult;
  /** Files that exist but haven't been read yet (so the answer can say so). */
  unread: number;
  /** Who the question named (e.g. Dr. Armen Haroutunian), if anyone. */
  who: string[];
  intents: AiIntent[];
}

/** Rough characters-per-token for English clinical text; used to stay inside the context window. */
export const CHARS_PER_TOKEN = 3.6;

// Intent words: a question about recommendations should read the plan, even
// when the doctor writes "Plan/Orders", "Candidate for …" or "As an alternative …".
export type AiIntent = "recommend" | "rom" | "findings";

const INTENTS: Array<{ name: AiIntent; ask: RegExp; text: RegExp; heading: RegExp }> = [
  {
    name: "recommend",
    ask: /\b(recommend\w*|plan|plans|orders?|suggest\w*|advis\w*|next steps?|treatment options?|injections?|procedures?|follow[- ]?up)\b/i,
    text: /\b(recommend\w*|candidate|alternative|planned|plan|orders?|injection|procedure|sessions?|follow[- ]?up|refer\w*|medications?|fees?|cost)\b/i,
    heading: /\b(plan|orders?|recommendations?|treatment|disposition|discussion|follow[- ]?up)\b/i,
  },
  {
    name: "rom",
    ask: /\b(rom|range of motion|motion|flexion|extension|rotation|bending|mobility)\b/i,
    text: /\b(range of motion|ROM|flexion|extension|rotation|bending|degrees?|°)/i,
    heading: /\b(range of motion|physical exam\w*|examination|exam)\b/i,
  },
  {
    name: "findings",
    ask: /\b(finding|findings|impression|results?|showed|show|mri|ct|x-?ray|imaging|diagnos\w*|assessment)\b/i,
    text: /\b(impression|findings?|protrusion|herniation|bulge|stenosis|narrowing|fracture|disc|tear|edema|radiculopathy|diagnos\w*|assessment)\b/i,
    heading: /\b(impression|findings|assessment|diagnos\w*|conclusion)\b/i,
  },
];

const STOP = new Set(
  "a an and are as at be been but by can did do does for from had has have how i in is it its me my of on or the their them this to was we were what when where which who whom why will with you your any all about tell show give find get much many patient pt please dr doctor report reports file files say said says".split(" "),
);

function words(question: string): string[] {
  return [...new Set(question.toLowerCase().split(/[^a-z0-9/]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

interface Chunk {
  file: GoatFile;
  units: DocUnit[];
  start: number;
  score: number;
}

/** Consecutive units grouped under their heading, each chunk a readable piece of the report. */
function chunksOf(file: GoatFile, maxChars: number): Chunk[] {
  const units = docUnits(file);
  const out: Chunk[] = [];
  let cur: DocUnit[] = [];
  let start = 0;
  let size = 0;
  const flush = () => {
    if (cur.some((u) => !u.heading)) out.push({ file, units: cur, start, score: 0 });
    cur = [];
    size = 0;
  };
  units.forEach((u, i) => {
    if ((u.heading && cur.length && cur.some((c) => !c.heading)) || (size + u.text.length > maxChars && cur.length)) flush();
    if (!cur.length) start = i;
    cur.push(u);
    size += u.text.length + 1;
  });
  flush();
  return out;
}

function scoreChunk(c: Chunk, q: { matchers: TermMatcher[]; intents: typeof INTENTS; regions: BodyRegion[] }): number {
  const text = c.units.map((u) => u.text).join("\n");
  const headingText = c.units.filter((u) => u.heading).map((u) => u.text).join(" ") + " " + (c.units[0]?.text.slice(0, 40) ?? "");
  let s = 0;
  for (const m of q.matchers) if (m.test(text)) s += 3;
  let intentHit = false;
  for (const it of q.intents) {
    const head = it.heading.test(headingText);
    const hits = (text.match(new RegExp(it.text.source, "gi")) ?? []).length;
    if (head) s += 6;
    s += Math.min(hits, 6);
    if (head || hits >= 2) intentHit = true;
  }
  // A "range of motion" question doesn't want the plan, and vice versa.
  if (q.intents.length && !intentHit) return 0;
  if (q.regions.length) {
    const named = regionsNamedIn(text);
    if (q.regions.some((r) => named.includes(r) || c.units.some((u) => u.region === r))) s += 3;
  }
  // Letterhead / patient header / technique boilerplate rarely answers anything.
  if (c.units.every((u) => u.section === "header" || u.section === "boiler")) s -= 4;
  return s;
}

function answerToLines(a: GoatAnswer): AiSourceLine[] {
  const out: AiSourceLine[] = a.lines.flatMap((l) => l.split("\n")).map((text) => ({ text }));
  for (const g of a.groups ?? []) {
    out.push({ text: g.lead });
    if (g.note) out.push({ text: g.note });
    for (const b of g.blocks) {
      if (b.heading) out.push({ text: `${b.heading}:` });
      for (const item of b.items) out.push({ text: item });
    }
  }
  if (a.flag) out.push({ text: `Note: ${a.flag}` });
  return out.filter((l) => l.text.trim());
}

/**
 * Pick the sources for a question within `budgetChars` (prompt characters for
 * sources). Rule-based answers (counts, dates, panels) come first because they
 * are exact; then the best chunks of the patient's files.
 */
export function buildAiSources(ctx: GoatContext, question: string, budgetChars = 6500): AiRetrieval {
  const result = askGoat(ctx, question);
  const groups = ctx.termGroups ?? [];
  const asked = groupsInQuestion(question, groups);
  const people = ctx.people ?? [];
  const who = resolveWho(question, asked, people);
  // "dr armen" — a first name (or any name part of 4+ letters) also names the doctor.
  for (const p of people) {
    if (who.people.includes(p)) continue;
    const parts = p.name.replace(/\(.*?\)/g, " ").split(/[^A-Za-z'-]+/).filter((w) => w.length >= 4 && !/^(doctor|clinic|center|medical|group)$/i.test(w));
    if (parts.some((w) => new RegExp(`\\b${w.replace(/[^A-Za-z'-]/g, "")}\\b`, "i").test(question))) who.people.push(p);
  }
  const wantsReferral = /\b(referral|referred|refer|order form|authori[sz]ation)\b/i.test(question);
  const intents = INTENTS.filter((it) => it.ask.test(question));
  const regions = regionsNamedIn(question);
  const askedTerms = asked.flatMap((g) => g.terms);
  const leftovers = words(question).filter((w) => !askedTerms.some((t) => t.toLowerCase().includes(w)));
  const matchers = [...asked.map((g) => makeMatcher(g.terms)), ...leftovers.map((w) => makeMatcher([w]))];

  const sources: AiSource[] = [];
  let used = 0;
  const add = (s: Omit<AiSource, "id">): boolean => {
    const size = s.title.length + s.lines.reduce((n, l) => n + l.text.length + 6, 0) + 40;
    if (used + size > budgetChars && sources.length) return false;
    sources.push({ ...s, id: `S${sources.length + 1}` });
    used += size;
    return true;
  };

  // 1. Exact answers G.O.A.T. already computed from the page (visits, decompression counts, dates, panels).
  const pageAnswers: Array<{ a: GoatAnswer; lines: AiSourceLine[] }> = [];
  for (const a of result.answers) {
    const lines = answerToLines(a);
    // "No MRI / CT referrals or findings on file." would read as "not in the file" when a report has it.
    const empty = lines.every((l) => /^(no |nothing |that section is hidden)|not entered|on file\.?$/i.test(l.text) || /^Note: /.test(l.text));
    if (lines.length && !empty) pageAnswers.push({ a, lines });
  }
  for (const { a, lines } of pageAnswers) {
    if (lines.length) add({ title: `${a.title} (patient page · ${a.source})`, kind: "page", section: a.section, lines });
  }

  // 2. Patient files: who-matching reports first, referral forms last (unless asked for).
  // Counts / dates / visits G.O.A.T. computed exactly don't need report text
  // (a report's "20 sessions" plan would only confuse a count question).
  const exactOnly = result.answers.some((a) => ["appointments", "info", "treatmentPlan", "diagnosis", "details"].includes(a.section)) && intents.length === 0;
  const readFiles = (exactOnly ? [] : ctx.files ?? []).filter((f) => f.status === "read" && f.pages && f.pages.length);
  const unread = (ctx.files ?? []).filter((f) => f.status === "unread" || f.status === "needsOcr" || f.status === "reading").length;
  const whoMatchers = who.people.map((p) => ({ name: p.name, m: makeMatcher([p.name, surnameOf(p.name)].filter((t) => t.length >= 3)) }));
  const specialty = makeMatcher(who.specialtyGroups.flatMap((g) => g.terms).filter((t) => t.length > 3));
  const hasWho = whoMatchers.length > 0 || who.specialtyGroups.length > 0;
  type FileInfo = { file: GoatFile; type: GoatDocType; whoNames: string[]; whoScore: number };
  let infos: FileInfo[] = readFiles.map((file) => {
    const text = (file.pages ?? []).join("\n");
    const whoNames = whoMatchers.filter(({ m }) => m.test(text) || m.test(file.name)).map(({ name }) => name);
    const whoScore = whoNames.length ? 2 : hasWho && specialty.terms.length && (specialty.test(text) || specialty.test(file.name)) ? 1 : 0;
    return { file, type: classifyDoc(file), whoNames, whoScore };
  });
  if (hasWho && infos.some((i) => i.whoScore > 0)) infos = infos.filter((i) => i.whoScore > 0);
  // "lumbar MRI findings": imaging reports only, and their Impression when they have one.
  const modalityAsked = /\b(mri|mris|ct|x-?rays?|xrays?|radiographs?|imaging)\b/i.test(question);
  let impressionOnly = new Set<string>();
  if (modalityAsked) {
    const imaging = infos.filter((i) => isImagingReport(i.file, []));
    if (imaging.length) infos = imaging;
    impressionOnly = new Set(imaging.filter((i) => docUnits(i.file).some((u) => u.section === "impression" && !u.heading)).map((i) => i.file.id));
  }
  const chunkMax = 2600;
  const ranked: Array<Chunk & { info: FileInfo }> = [];
  for (const info of infos) {
    for (const c of chunksOf(info.file, chunkMax)) {
      if (impressionOnly.has(info.file.id) && !c.units.some((u) => u.section === "impression" && !u.heading)) continue;
      let score = scoreChunk(c, { matchers, intents, regions });
      if (score <= 0) continue;
      score += info.whoScore * 4;
      if (info.type === "report") score += 3;
      if (info.type === "referral" && !wantsReferral) score -= 6;
      if (score > 2) ranked.push({ ...c, score, info });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  // Only chunks close to the best one: a weak match is noise for a small model.
  const top = ranked[0]?.score ?? 0;
  for (let i = ranked.length - 1; i >= 0; i--) if (ranked[i].score < top * 0.6) ranked.splice(i, 1);
  // Keep the chosen chunks of each file together, in document order.
  const picked: typeof ranked = [];
  let budgetLeft = budgetChars - used;
  for (const c of ranked) {
    const size = c.units.reduce((n, u) => n + u.text.length + 6, 0);
    if (size > budgetLeft && picked.length) continue;
    picked.push(c);
    budgetLeft -= size;
    if (picked.length >= 6) break;
  }
  const byFile = new Map<string, typeof ranked>();
  for (const c of picked) byFile.set(c.file.id, [...(byFile.get(c.file.id) ?? []), c]);
  const fileOrder = [...byFile.values()].sort((a, b) => Math.max(...b.map((c) => c.score)) - Math.max(...a.map((c) => c.score)));
  for (const list of fileOrder) {
    const info = list[0].info;
    const units = list.sort((a, b) => a.start - b.start).flatMap((c) => c.units);
    const { date, label } = docDate(info.file);
    add({
      title: info.file.name,
      kind: "file",
      docType: info.type,
      date,
      dateLabel: label,
      who: info.whoNames,
      fileId: info.file.id,
      lines: units.flatMap((u) => (u.heading ? [u.text] : splitForModel(u.text)).map((text) => ({ text, page: u.page }))),
    });
  }

  // A referral's status line ("report received, not reviewed yet") adds nothing once the report itself is here.
  if (sources.some((x) => x.kind === "file" && x.docType === "report")) {
    for (let i = sources.length - 1; i >= 0; i--) if (sources[i].kind === "page" && sources[i].section === "specialist") sources.splice(i, 1);
    sources.forEach((x, i) => (x.id = `S${i + 1}`));
  }

  // 3. Page text hits (notes, SOAP, findings boxes) when there's room and nothing better.
  if (sources.length < 2) {
    for (const h of result.hits.slice(0, 3)) {
      if (!add({ title: `${h.kind} · ${h.title}`, kind: "page", section: h.section, lines: [{ text: plainText(h.snippet) }] })) break;
    }
  }

  return { sources, result, unread, who: who.people.map((p) => p.name), intents: intents.map((i) => i.name) };
}

/** The sources as numbered plain text for the prompt. */
export function sourcesForPrompt(sources: AiSource[]): string {
  return sources
    .map((s) => {
      const meta = [
        s.kind === "file" ? (s.docType === "referral" ? "Referral form" : s.docType === "report" ? "Report" : "Document") : "NoteGoat patient page",
        s.date ? `${s.dateLabel === "dated" ? "dated" : "uploaded"} ${s.date}` : "",
        s.who?.length ? s.who.join(", ") : "",
      ].filter(Boolean);
      return `[${s.id}] ${s.title} (${meta.join(", ")})\n${s.lines.map((l) => l.text).join("\n")}`;
    })
    .join("\n\n");
}
