/**
 * G.O.A.T. facts: one structured summary per uploaded file (rules only, runs in the browser).
 * Document type, doctor + specialty, labeled dates, findings / impression, diagnoses,
 * recommendations, procedures / injections, medications, ROM and follow-up.
 * Cached per file id + text hash (see goat-facts-store.ts) so it runs once per file version.
 */
import type { GoatFile } from "@/lib/goat-docs";
import { reportVisitDate, toMDY } from "@/lib/goat-referrals";

export type FactDocType = "referral" | "specialist report" | "xray" | "mri" | "ct" | "pt" | "letter" | "bill" | "other";
export type FactDateLabel = "referral" | "visit" | "exam" | "injury" | "report" | "scheduled" | "follow-up" | "other";

export interface FileFacts {
  fileId: string;
  fileName: string;
  hash: string;
  docType: FactDocType;
  doctor: string;
  specialty: string;
  dates: Array<{ label: FactDateLabel; date: string; raw: string }>;
  /** The document's own main date (DOS / exam / referral), MM/DD/YYYY. */
  mainDate: string;
  findings: string[];
  impressions: string[];
  diagnoses: string[];
  recommendations: string[];
  procedures: string[];
  medications: string[];
  rom: string[];
  followUp: string[];
  regions: string[];
}

export const FACTS_VERSION = 4;
/** Text read per file for facts (dates, headers and plans sit in the first pages). */
export const MAX_FACT_CHARS = 250_000;

/** Small stable hash (FNV-1a) of the file's name + text. */
export function factsHash(file: Pick<GoatFile, "name" | "pages">): string {
  const s = `${FACTS_VERSION}|${file.name}|${(file.pages ?? []).join("\f")}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}-${s.length}`;
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE = `(\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4})`;

const DATE_LABELS: Array<[FactDateLabel, RegExp]> = [
  ["referral", /date\s+of\s+referral|referral\s+date|date\s+referred|referred\s+on/],
  ["injury", /date\s+of\s+(?:injury|accident|loss)|\bDOI\b|\bDOA\b|\bDOL\b|injury\s+date|accident\s+date/],
  ["exam", /exam(?:ination)?\s+date|date\s+of\s+exam(?:ination)?|study\s+date|date\s+of\s+study|date\s+performed/],
  ["visit", /consultation\s+visit|consultation\s+date|date\s+of\s+(?:service|visit|consultation|consult|evaluation)|visit\s+date|\bDOS\b|date\s+seen|seen\s+on/],
  ["report", /report\s+date|date\s+of\s+report|dictated|transcribed|signed\s+on/],
  ["scheduled", /scheduled\s+(?:for|on)|appointment\s+(?:date|on)/],
  ["follow-up", /follow[\s-]?up\s+(?:on|date)|return\s+(?:visit\s+)?on/],
];

export function classifyFactsDoc(name: string, text: string): FactDocType {
  const n = name.toLowerCase();
  const t = text.slice(0, 3000).toLowerCase();
  if (/referr?al/.test(n) || /\breferral form\b|date of referral/.test(t)) return "referral";
  if (/\b(x[\s-]?ray|xr|radiograph)/.test(n) || /\b(radiographs?|x-?rays?)\b.*\bviews?\b/.test(t)) return "xray";
  if (/\bmri\b/.test(n) || /\bmri\b|magnetic resonance/.test(t.slice(0, 600))) return "mri";
  if (/\bct\b/.test(n) || /computed tomography/.test(t.slice(0, 600))) return "ct";
  if (/\b(pt|physical therapy)\b/.test(n) || /physical therapy (?:evaluation|progress|daily)/.test(t)) return "pt";
  if (/\b(bill|invoice|ledger|statement)\b/.test(n)) return "bill";
  if (/\bletter\b/.test(n) || /^\s*dear\b/m.test(t)) return "letter";
  if (/report|consult|eval|specialist|follow/.test(n) || /consultation|history of present illness|assessment/.test(t)) return "specialist report";
  return "other";
}

const SPECIALTY: Array<[string, RegExp]> = [
  ["pain management", /\b(pain management|interventional pain|pain medicine|anesthesiolog\w*|physiatr\w*)\b/i],
  ["orthopedics", /\borthop(a)?edic\w*/i],
  ["neurosurgery", /\bneurosurg\w*/i],
  ["neurology", /\bneurolog\w*/i],
  ["radiology", /\bradiolog\w*/i],
  ["physical therapy", /\bphysical therap\w*/i],
  ["chiropractic", /\bchiropract\w*/i],
];

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

function doctorOf(name: string, text: string): string {
  const base = name.replace(/\.(pdf|docx?|txt|png|jpe?g)$/i, "");
  const fromName = /\bdr\.?\s+([a-z][a-z' .-]+?)\s*$/i.exec(base);
  if (fromName) return `Dr. ${titleCase(fromName[1].trim())}`;
  const head = text.slice(0, 2500);
  const provider = /\bprovider\s*:\s*(?:dr\.?\s+)?([A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+){1,3}?)(?=\s*,|\s+M\.?D\b|\s+D\.?O\b|\s*\||\s+\w+\s*:|\s*$)/im.exec(head);
  if (provider && !/^(visit|chart|office)$/i.test(provider[1])) return `Dr. ${titleCase(provider[1].trim())}`;
  const md = /^\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3}),?\s+(?:M\.?D\.?|D\.?O\.?)\b/m.exec(head);
  if (md) return `Dr. ${titleCase(md[1])}`;
  const dr = /\b(?:Dr\.?|Doctor)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)/.exec(head);
  return dr ? `Dr. ${dr[1]}` : "";
}

const HEADERS: Array<[keyof Pick<FileFacts, "findings" | "impressions" | "diagnoses" | "recommendations" | "procedures" | "medications" | "rom" | "followUp">, RegExp]> = [
  ["impressions", /^(?:impressions?|conclusions?)\b/i],
  ["findings", /^(?:findings|results|radiographic findings|x-?ray findings|mri findings)\b/i],
  ["diagnoses", /^(?:diagnos[ie]s|assessment|dx|working diagnos[ie]s)\b/i],
  ["recommendations", /^(?:recommendations?|plan|treatment plan|plan of care|recommended)\b/i],
  ["procedures", /^(?:procedures?(?: performed)?|injections?)\b/i],
  ["medications", /^(?:medications?|current medications|meds|prescriptions?)\b/i],
  ["rom", /^(?:range of motion|rom)\b/i],
  ["followUp", /^(?:follow[\s-]?up|disposition|return)\b/i],
];
const ANY_HEADER = /^[A-Z][A-Za-z /&-]{2,40}:\s*|^[A-Z][A-Z /&-]{3,40}$/;

const clean = (l: string) => l.replace(/^[\s•*·\-–\d.)]+(?=\S)/, "").replace(/\s+/g, " ").trim();
/** "LUMBAR SPINE:", "MRI of the Lumbar Spine", "Cervical:" — a region sub-heading inside a section, not a new section. */
const REGION_SUBHEADER = /^(?:(?:mri|ct|x-?ray)\s+(?:of\s+)?(?:the\s+)?)?(?:cervical|thoracic|lumbar|lumbosacral|c-spine|t-spine|l-spine)(?:\s+spine)?(?:\s+(?:mri|ct|x-?ray))?\s*(?::|$)/i;
/** Imaging sections are kept whole (combined Cervical + Lumbar reports run long). */
const LONG_SECTIONS = new Set<string>(["impressions", "findings"]);
const push = (arr: string[], v: string, max = 15) => {
  const c = clean(v);
  if (c.length >= 3 && !/^none\.?$/i.test(c) && !arr.includes(c) && arr.length < max) arr.push(c);
};

const REGIONS: Array<[string, RegExp]> = [
  ["Cervical", /\b(cervical|c[- ]?spine|neck)\b/i],
  ["Thoracic", /\b(thoracic|t[- ]?spine)\b/i],
  ["Lumbar", /\b(lumbar|l[- ]?spine|low back|lumbosacral)\b/i],
  ["Shoulder", /\bshoulders?\b/i],
  ["Knee", /\bknees?\b/i],
  ["Hip", /\bhips?\b/i],
  ["Wrist/Hand", /\b(wrists?|hands?)\b/i],
];

export function extractFileFacts(file: GoatFile): FileFacts {
  // Capped: a 1.7 MB OCR dump would make every pattern pass over it on the main thread.
  const text = (file.pages ?? []).join("\n").slice(0, MAX_FACT_CHARS);
  const docType = classifyFactsDoc(file.name, text);
  const facts: FileFacts = {
    fileId: file.id, fileName: file.name, hash: factsHash(file), docType,
    doctor: doctorOf(file.name, text),
    specialty: "",
    dates: [], mainDate: "",
    findings: [], impressions: [], diagnoses: [], recommendations: [], procedures: [], medications: [], rom: [], followUp: [],
    regions: REGIONS.filter(([, re]) => re.test(text)).map(([r]) => r),
  };
  const head = `${file.name}\n${text.slice(0, 3000)}`;
  facts.specialty = docType === "xray" || docType === "mri" || docType === "ct" ? "radiology" : docType === "pt" ? "physical therapy" : SPECIALTY.find(([, re]) => re.test(head))?.[0] ?? "";

  // Dates with labels (label then a date within ~80 characters).
  for (const [label, re] of DATE_LABELS) {
    const g = new RegExp(`(${re.source})[\\s\\S]{0,80}?${DATE}`, "gi");
    for (const m of text.matchAll(g)) {
      const date = toMDY(m[2]);
      if (!facts.dates.some((d) => d.label === label && d.date === date)) facts.dates.push({ label, date, raw: m[1] });
    }
  }
  const pick = (...ls: FactDateLabel[]) => ls.map((l) => facts.dates.find((d) => d.label === l)?.date).find(Boolean) ?? "";
  facts.mainDate = docType === "referral" ? pick("referral", "visit", "report") : docType === "specialist report" ? reportVisitDate(text, { avoid: facts.dates.filter((d) => d.label === "injury").map((d) => d.date) }) || pick("visit", "exam", "report") : pick("visit", "exam", "report", "referral");
  if (docType === "specialist report" && facts.mainDate && !facts.dates.some((d) => d.label === "visit")) facts.dates.push({ label: "visit", date: facts.mainDate, raw: "visit (from the report body)" });
  if (!facts.mainDate) {
    const any = new RegExp(`\\bdate\\s*:?\\s*${DATE}`, "i").exec(text);
    if (any) facts.mainDate = toMDY(any[1]);
  }

  // Sections: a header line ("IMPRESSION:", "Plan") then its lines until the next header.
  const lines = unwrapLines(text);
  let cur: (typeof HEADERS)[number][0] | null = null;
  let taken = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const hdr = HEADERS.find(([, re]) => re.test(line) && (/:/.test(line.slice(0, 45)) || line.length < 40));
    if (hdr) {
      cur = hdr[0];
      taken = 0;
      const rest = line.replace(/^[^:]*:\s*/, "");
      if (cur === "rom") continue; // ROM is read as whole sentences below
      if (rest !== line && rest) push(facts[cur], rest, LONG_SECTIONS.has(cur) ? 80 : 15);
      else if (rest === line && /\s\S+\s\S+/.test(line)) push(facts[cur], line); // "Follow up in 4 weeks."
      continue;
    }
    if (REGION_SUBHEADER.test(line)) {
      // Region sub-heading: stay in the current section and keep any text after the colon.
      const rest = line.replace(/^[^:]*:?\s*/, "");
      if (cur && cur !== "rom" && rest && rest !== line) push(facts[cur], rest, LONG_SECTIONS.has(cur) ? 80 : 15);
      continue;
    }
    if (ANY_HEADER.test(line) && !/^\d/.test(line)) cur = null;
    if (cur && cur !== "rom" && (taken < 12 || LONG_SECTIONS.has(cur))) { push(facts[cur], line, LONG_SECTIONS.has(cur) ? 80 : 15); taken++; }
    // Anywhere in the text:
    if (/\b(injection|ESI|epidural|facet|medial branch|RFA|radiofrequency|nerve block|trigger point|PRP|surgery|discectomy|fusion|arthroscop\w*)\b/i.test(line) && /recommend|candidate|perform|schedul|underwent|consider|plan/i.test(line)) push(facts.procedures, line);
    if (/\bfollow[\s-]?up\b[^.\n]{0,30}\b(\d+|one|two|three|four|six)\s*(days?|weeks?|wks?|months?)\b|\breturn in\b/i.test(line)) push(facts.followUp, line);
    if (/\b[A-TV-Z]\d{2}\.[0-9A-Z]{1,4}\b/.test(line)) push(facts.diagnoses, line);
    if (/\b\d+\s*mg\b/i.test(line)) push(facts.medications, line);
  }
  facts.rom = extractRom(lines);
  // Radiology without headers: lines that read like impressions.
  if ((docType === "xray" || docType === "mri" || docType === "ct") && !facts.impressions.length && !facts.findings.length) {
    for (const l of lines) if (/\b(degenerat\w*|herniat\w*|bulg\w*|protrusion|stenosis|straightening|lordosis|fracture|spondylo\w*|osteophyte\w*|unremarkable|no acute)\b/i.test(l)) push(facts.findings, l, 8);
  }
  return facts;
}

/** Which facts lists apply to the question (none asked → the overview). */
export function factFieldsFor(question: string): Array<keyof FileFacts> {
  const q = question.toLowerCase();
  const f: Array<keyof FileFacts> = [];
  if (/find|impression|show|result|read|reveal|say/.test(q)) f.push("impressions", "findings");
  if (/diagnos|dx|icd/.test(q)) f.push("diagnoses");
  if (/recommend|recs?\b|plan|suggest|next step|treat/.test(q)) f.push("recommendations", "procedures");
  if (/inject|procedure|esi|block|rfa|surgery/.test(q)) f.push("procedures");
  if (/med|prescri|rx\b/.test(q)) f.push("medications");
  if (/\brom\b|range of motion|motion|flexion/.test(q)) f.push("rom");
  if (/follow|return|next/.test(q)) f.push("followUp");
  return f.length ? [...new Set(f)] : ["impressions", "findings", "recommendations"];
}

/** Compact text for the + mode prompt. */
export function factsForPrompt(f: FileFacts, fields: Array<keyof FileFacts> = factFieldsFor("")): string {
  const out = [`${f.fileName} — ${f.docType}${f.doctor ? `, ${f.doctor}` : ""}${f.specialty ? ` (${f.specialty})` : ""}${f.mainDate ? `, ${f.mainDate}` : ""}`];
  if (f.dates.length) out.push(`  dates: ${f.dates.map((d) => `${d.label} ${d.date}`).join("; ")}`);
  for (const k of fields) {
    const v = f[k];
    if (Array.isArray(v) && v.length && typeof v[0] === "string") out.push(`  ${k}: ${(v as string[]).slice(0, 8).join(" | ")}`);
  }
  return out.join("\n");
}

/**
 * PDF text wraps mid-sentence ("Cervical flexion 35 degrees with\npain, extension …"): join a line
 * into the previous one unless the previous one ended a sentence or the line is a heading / list item.
 */
export function unwrapLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) {
      out.push("");
      continue;
    }
    const prev = out.length ? out[out.length - 1] : "";
    const startsNew = /^([-•*·]|\d+[.)]\s|[A-Z][A-Z /&-]{2,}:?$|[A-Za-z][A-Za-z /&-]{1,40}:\s)/.test(line) || /^(p\.\d+|page \d+)/i.test(line);
    // A continuation starts lowercase / with a digit, or the previous line clearly stops mid-phrase.
    const continues = /^[a-z0-9(]/.test(line) || /(,|\b(with|without|and|or|of|to|at|the|a|an|in|on|for|by|bilaterally)|-)$/i.test(prev);
    if (prev && continues && !/[.:;!?]$/.test(prev) && !startsNew && !/^[A-Z][A-Z /&-]{2,}:?$/.test(prev)) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out.filter(Boolean);
}

const ROM_MOTION = /\b(flexion|extension|rotation|lateral (?:bending|flexion)|side bending|abduction|adduction|internal rotation|external rotation)\b/i;
const ROM_REGIONS: Array<[string, RegExp]> = [
  ["Cervical", /\b(cervical|c[- ]?spine|neck)\b/i],
  ["Thoracic", /\b(thoracic|t[- ]?spine)\b/i],
  ["Lumbar", /\b(lumbar|l[- ]?spine|low(?:er)? back|lumbosacral)\b/i],
  ["Shoulder", /\bshoulders?\b/i],
  ["Knee", /\bknees?\b/i],
  ["Hip", /\bhips?\b/i],
];

/**
 * Range of motion as whole sentences with their region: "Cervical: flexion 35° with pain, extension
 * 40° with pain." Region from the sentence, else the last region heading above it. Never cut mid-sentence.
 */
export function extractRom(lines: string[]): string[] {
  const out: string[] = [];
  let region = "";
  let inRom = false;
  for (const line of lines) {
    const head = /^([A-Za-z][A-Za-z /&-]{1,40}):\s*(.*)$/.exec(line);
    const headRegion = ROM_REGIONS.find(([, re]) => re.test(head ? head[1] : line.length < 40 ? line : ""))?.[0];
    if (headRegion) region = headRegion;
    if (/^(range of motion|rom)\b/i.test(line)) inRom = true;
    else if (/^[A-Z][A-Z /&-]{3,}:?\s*$/.test(line) || (head && !headRegion && !ROM_MOTION.test(head[1]) && !/range of motion|rom/i.test(head[1]))) inRom = false;
    const body = head && (headRegion || /range of motion|rom/i.test(head[1])) ? head[2] : line;
    for (const sentence of body.split(/(?<=[.;])\s+(?=[A-Z])/)) {
      const sn = sentence.trim();
      if (!sn) continue;
      const hasMeasure = ROM_MOTION.test(sn) && /\d+\s*(?:°|deg|degrees)\b|\b(full|limited|restricted|reduced|decreased|normal|WNL|within normal limits)\b/i.test(sn);
      // "Extremity: Range of motion in within normal limits." — a whole-area statement with no movement named.
      const bareRom = !ROM_MOTION.test(sn) && /^(?:[A-Za-z][A-Za-z /&-]{1,40}:\s*)?(range of motion|rom)\b/i.test(sn) && /\b(within normal limits|wnl|normal|full|limited|restricted|reduced|decreased)\b/i.test(sn);
      if (!hasMeasure && !bareRom && !(inRom && ROM_MOTION.test(sn))) continue;
      const own = ROM_REGIONS.find(([, re]) => re.test(sn))?.[0];
      const bareLabel = bareRom && !own && head && !headRegion && !/range of motion|rom/i.test(head[1]) ? head[1].trim().replace(/^./, (c) => c.toUpperCase()) : "";
      const r = bareLabel || (own ?? region);
      const text = sn.replace(/\s*(\d+)\s*(?:degrees|deg)\b\.?/gi, " $1°").replace(/\s+/g, " ").trim();
      const lineOut = r && !new RegExp(`^${r}\\b`, "i").test(text) ? `${r}: ${text}` : text;
      if (!out.includes(lineOut) && out.length < 20) out.push(lineOut);
    }
  }
  return out;
}
