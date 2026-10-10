/**
 * G.O.A.T. — answering from uploaded Patient Files (pure, no I/O).
 *
 * Input is text G.O.A.T. already pulled out of the patient's PDFs (see
 * goat-files.ts). This file decides who the question is about (abbreviation →
 * specialty → the office's contacts and this patient's referrals), which files
 * are reports vs. referral forms, and which lines answer the question. Every
 * line shown is quoted from a file; nothing is inferred or made up.
 */

import { cleanTerms, makeMatcher, type GoatTermGroup, type TermMatcher } from "@/lib/goat-terms";
import { extractRom, formatRomMeasure, romHeading, type RomRegion } from "@/lib/goat-rom";
import {
  isRegionGroup,
  joinWrapped,
  levelHighlightTerms,
  levelsIn,
  regionsNamedIn,
  splitNumbered,
  type BodyRegion,
  type Modality,
  type RegionQuery,
} from "@/lib/goat-regions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoatFileStatus = "read" | "unread" | "reading" | "needsOcr" | "failed" | "unsupported";

export interface GoatFile {
  id: string;
  name: string;
  folder: string;
  /** Upload time (ISO). */
  uploaded: string;
  status: GoatFileStatus;
  method?: "text" | "ocr" | "mixed";
  /** Plain text per page once read; null until then. */
  pages: string[] | null;
}

export interface GoatPerson {
  name: string;
  /** e.g. "Pain Management" (contact sub-category), "" when unknown. */
  specialty: string;
  /** Referred for this patient (Specialist panel). */
  referred: boolean;
  referralSent?: string;
}

export type GoatDocType = "report" | "referral" | "other";

export interface GoatFileLine {
  text: string;
  page: number;
  /** Line sits under a matching heading (e.g. the lines below "RANGE OF MOTION:"). */
  inSection?: boolean;
  /** A heading shown for context ("Lumbar spine:" above a matching line). */
  heading?: boolean;
}

export interface GoatFileMatch {
  fileId: string;
  name: string;
  /** Date written in the document ("Date of service: …"), else upload date. MM/DD/YYYY. */
  date: string;
  dateLabel: "dated" | "uploaded";
  docType: GoatDocType;
  /** Doctor(s) from the question this file mentions. */
  who: string[];
  lines: GoatFileLine[];
}

export interface GoatFilesResult {
  /** Plain-text notes shown above the files (who G.O.A.T. looked for, referral-only, etc.). */
  notes: string[];
  matches: GoatFileMatch[];
  /** Files that match but weren't shown (beyond the top few). */
  moreFiles: number;
  /** Words to highlight. */
  highlight: string[];
  /** Files not read yet (unread / needs OCR / reading). */
  unread: number;
  /** Card title when the answer is a specific report section, e.g. "MRI report · Lumbar". */
  title?: string;
  /** Show every line (an imaging report's sections for the asked region) instead of the first few. */
  expanded?: boolean;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const TITLE_WORDS = new Set(["dr", "doctor", "md", "do", "dc", "pa", "np", "phd", "mr", "mrs", "ms", "jr", "sr", "iii", "ii"]);

/** "Dr. Armen Haroutunian, MD" → "Haroutunian"; "Haroutunian, Armen" → "Haroutunian". */
export function surnameOf(name: string): string {
  let cleaned = (name ?? "").replace(/\(.*?\)/g, " ").trim();
  const credentials = /,\s*(md|do|dc|pa|np|phd|pa-c|dpm)\.?\s*$/i;
  while (credentials.test(cleaned)) cleaned = cleaned.replace(credentials, "").trim();
  const words = (s: string) =>
    s
      .split(/\s+/)
      .map((p) => p.replace(/[^A-Za-z'-]/g, ""))
      .filter((p) => p.length >= 2 && !TITLE_WORDS.has(p.toLowerCase()));
  if (cleaned.includes(",")) {
    const last = words(cleaned.split(",")[0]);
    return last[last.length - 1] ?? "";
  }
  const all = words(cleaned);
  return all[all.length - 1] ?? "";
}

/** "Dr. Armen Haroutunian" → "Armen"; "Haroutunian, Armen" → "Armen". */
export function firstNameOf(name: string): string {
  const cleaned = (name ?? "").replace(/\(.*?\)/g, " ").replace(/,\s*(md|do|dc|pa|np|phd|pa-c|dpm)\.?\s*$/i, "").trim();
  const words = (s: string) =>
    s
      .split(/\s+/)
      .map((p) => p.replace(/[^A-Za-z'-]/g, ""))
      .filter((p) => p.length >= 2 && !TITLE_WORDS.has(p.toLowerCase()));
  if (cleaned.includes(",")) return words(cleaned.split(",")[1] ?? "")[0] ?? "";
  const all = words(cleaned);
  return all.length >= 2 ? all[0] : "";
}

/**
 * Does the question name this person? Surname ("Haroutunian"), or first name
 * the way people talk about doctors: "dr armen" / "doctor armen", or the first
 * name alone when it's at least 5 letters ("armen's report"). Case-insensitive.
 */
export function personNamedIn(question: string, person: Pick<GoatPerson, "name">): boolean {
  const q = (question ?? "").toLowerCase();
  const word = (w: string) => w.toLowerCase().replace(/[^a-z'-]/g, "");
  const s = word(surnameOf(person.name));
  if (s.length >= 4 && new RegExp(`(?<![a-z])${s}(?![a-z])`).test(q)) return true;
  const f = word(firstNameOf(person.name));
  if (f.length >= 3 && new RegExp(`(?<![a-z])(?:dr|doctor)\\.?\\s+${f}(?![a-z])`).test(q)) return true;
  return f.length >= 5 && new RegExp(`(?<![a-z])${f}(?![a-z])`).test(q);
}

function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

function stamp(us: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(us ?? "");
  if (!m) return 0;
  const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  return Date.UTC(y, +m[1] - 1, +m[2]);
}

function head(file: GoatFile, chars = 4000): string {
  return (file.pages ?? []).slice(0, 2).join("\n").slice(0, chars);
}

/** A heading line: short and either ends with ":" or is mostly capitals. */
export function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  // Numbered items and sentences aren't headings (all-caps reports are common).
  if (/^\(?\d{1,2}[.)]\s/.test(t) || /[.;,!?]$/.test(t)) return false;
  // "L5-S1: 4 MM …", "C4-5 …" and "… 3 mm …" are findings, not headings.
  if (/^[CTL]\d{1,2}\b/.test(t) || /\d\s?(mm|cm)\b/i.test(t) || /:\s*\S/.test(t)) return false;
  if (/:\s*$/.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase() && !t.includes(",") && t.split(/\s+/).length <= 7;
}

// ---------------------------------------------------------------------------
// Report or referral?
// ---------------------------------------------------------------------------

const REFERRAL_NAME = /referr|\border\b|request|authori[sz]ation|\brx\b|prescription|requisition/i;
const REPORT_NAME = /consult|eval|report|finding|note|exam|follow|visit|h\s?&\s?p|impression|initial|progress|procedure|op\b|operative/i;
const REFERRAL_TEXT = [
  /\breferral form\b/i,
  /\breason for referral\b/i,
  /\breferr(al|ed) to\b/i,
  /\brequest for (consult|consultation|evaluation|authori[sz]ation)\b/i,
  /\bauthori[sz]ation request\b/i,
  /\bplease (see|evaluate|schedule)\b/i,
];
const REPORT_TEXT = [
  /\bimpression\b/i,
  /\bassessment\b/i,
  /\bphysical exam(ination)?\b/i,
  /\bhistory of present illness\b|\bHPI\b/,
  /\bchief complaint\b/i,
  /\breview of systems\b/i,
  /\brange of motion\b|\bflexion\b/i,
  /\bplan\s*:/i,
  /\bconsultation\b|\bevaluation\b/i,
];

export function classifyDoc(file: GoatFile): GoatDocType {
  const name = file.name ?? "";
  const text = head(file);
  let referral = REFERRAL_NAME.test(name) ? 4 : 0;
  let report = REPORT_NAME.test(name) && !REFERRAL_NAME.test(name) ? 4 : 0;
  for (const re of REFERRAL_TEXT) if (re.test(text)) referral += 2;
  for (const re of REPORT_TEXT) if (re.test(text)) report += 1;
  const firstLines = text.split(/\n/).slice(0, 6).join(" ");
  if (/\bREFERRAL\b|\bReferral\b/.test(firstLines)) referral += 3;
  if (/\b(CONSULTATION|EVALUATION|REPORT|PROGRESS NOTE)\b/.test(firstLines)) report += 3;
  if (referral >= 4 && referral >= report) return "referral";
  if (report >= 2) return "report";
  return "other";
}

const DOC_DATE = /\b(?:date of (?:service|exam|examination|visit|evaluation|consultation|report|study)|dos|exam date|study date|visit date|report date)\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i;

export function docDate(file: GoatFile): { date: string; label: "dated" | "uploaded" } {
  const m = DOC_DATE.exec(head(file, 6000));
  if (m) {
    const [mm, dd, yy] = m[1].split(/[/-]/);
    const y = yy.length === 2 ? `20${yy}` : yy;
    return { date: `${mm.padStart(2, "0")}/${dd.padStart(2, "0")}/${y}`, label: "dated" };
  }
  return { date: usDate(file.uploaded), label: "uploaded" };
}

// ---------------------------------------------------------------------------
// Who is the question about?
// ---------------------------------------------------------------------------

const SPECIALTY_HINT = /pain|ortho|neuro|surgeon|surgery|specialist|radiolog|physiatr|podiatr|chiro|internal medicine|primary care|psych/i;

export interface GoatWho {
  /** Groups from the question that name a specialty (e.g. the PM group). */
  specialtyGroups: GoatTermGroup[];
  people: GoatPerson[];
  notes: string[];
}

export function resolveWho(question: string, asked: GoatTermGroup[], people: GoatPerson[]): GoatWho {
  const notes: string[] = [];
  const specialtyGroups = asked.filter(
    (g) =>
      g.terms.some((t) => SPECIALTY_HINT.test(t)) ||
      people.some((p) => p.specialty && makeMatcher(g.terms).test(p.specialty)),
  );
  const found = new Map<string, GoatPerson>();
  for (const g of specialtyGroups) {
    const m = makeMatcher(g.terms);
    const bySpecialty = people.filter((p) => p.specialty && m.test(p.specialty));
    // Referred doctors first; office contacts with that specialty after.
    bySpecialty.sort((a, b) => Number(b.referred) - Number(a.referred));
    for (const p of bySpecialty) found.set(p.name.toLowerCase(), p);
    // "Pain management (PM)"
    const abbr = g.terms.find((t) => t.length <= 5 && /[A-Z]/.test(t) && t === t.toUpperCase() && t !== g.terms[0]);
    const label = `${g.terms[0].charAt(0).toUpperCase()}${g.terms[0].slice(1)}${abbr ? ` (${abbr})` : ""}`;
    if (bySpecialty.length) {
      const named = bySpecialty
        .slice(0, 4)
        .map((p) => `${p.name}${p.referred ? ` (referred${p.referralSent ? ` ${p.referralSent}` : ""})` : " (in Contacts)"}`);
      notes.push(`${label}: ${named.join("; ")}.`);
    } else {
      // No contact has this specialty on file; a referred specialist with no
      // specialty set is the best lead (Quick Glance lists them under "PM").
      const unknown = people.filter((p) => p.referred && !p.specialty);
      for (const p of unknown) found.set(p.name.toLowerCase(), p);
      notes.push(
        unknown.length
          ? `${label}: no contact has that specialty set, so I also looked for this patient's referred specialist${unknown.length === 1 ? "" : "s"}: ${unknown.map((p) => p.name).join("; ")}.`
          : `${label}: no contact with that specialty and no referral on file, so I searched the files for the words themselves.`,
      );
    }
  }
  // A doctor named in the question ("Haroutunian findings", "from dr armen").
  for (const p of people) {
    if (personNamedIn(question, p)) found.set(p.name.toLowerCase(), p);
  }
  return { specialtyGroups, people: [...found.values()], notes };
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

const FILE_WORDS = new Set(
  "file files pdf pdfs document documents doc docs report reports note notes say says said show find found findings result results from for about any what which does did patient pt dr doctor panel card section box".split(" "),
);

export interface FilesQuery {
  question: string;
  /** Lower-cased content words of the question (no stop words). */
  words: string[];
  asked: GoatTermGroup[];
  allGroups: GoatTermGroup[];
  people: GoatPerson[];
  /** Regions / levels / imaging types the question names (goat-regions.ts). */
  region?: RegionQuery;
}

const PER_FILE_DEFAULT = 12;

// ---------------------------------------------------------------------------
// A document as readable units (sentences / numbered items), with the report
// section and body region each one belongs to.
// ---------------------------------------------------------------------------

export type DocSection = "header" | "impression" | "findings" | "boiler" | "other";

export interface DocUnit {
  text: string;
  page: number;
  heading: boolean;
  section: DocSection;
  region: BodyRegion | null;
}

const SECTION_IMPRESSION = /^(impressions?|conclusions?|opinions?|summary|final (impression|diagnosis)|diagnos[ie]s|assessment)\b/i;
const SECTION_FINDINGS = /^(findings|results?|observations?)\b/i;
const SECTION_BOILER = /^(technique|protocol|comparison|procedure|sequences|contrast|dose|radiation|study( description)?|exam(ination)? (info|information|details))\b/i;
const SECTION_OTHER = /^(history|clinical (history|information|indication)|indication|reason for (exam|study)|chief complaint|plan|recommendations?|physical exam(ination)?|history of present illness|past medical history|medications?)\b/i;
/** "Patient: …", "DOB: …", "Study Description : MRI LT/KNEE", "Accession #…" — report header boilerplate. */
const META_LABEL =
  /^(patient( name)?|name|dob|d\.o\.b\.?|date of birth|mrn|med(ical)? rec(ord)?( no| #| number)?|account|acct|accession|referring( (physician|doctor|provider))?|ordering( (physician|doctor|provider))?|physician|provider|facility|location|phone|tel|fax|address|sex|gender|age|study description|study date|study|exam date|date of (exam|study|service)|exam|procedure|technique|comparison|reason for exam|signed|electronically signed( by)?|dictated( by)?|transcribed( by)?|read by|radiologist|page \d+)\s*[:#]/i;
const MODALITY_WORD: Record<Modality, RegExp> = {
  MRI: /(?<![A-Za-z])(MRI|MR|magnetic resonance)(?![A-Za-z])/i,
  CT: /(?<![A-Za-z])(CT|computed tomography|CAT scan)(?![A-Za-z])/,
  "X-Ray": /(?<![A-Za-z])(x-?rays?|radiographs?|XR)(?![A-Za-z])/i,
};

function sectionOfHeading(text: string): DocSection | null {
  const t = text.replace(/[:\s]+$/, "").trim();
  if (SECTION_IMPRESSION.test(t)) return "impression";
  if (SECTION_FINDINGS.test(t)) return "findings";
  if (SECTION_BOILER.test(t)) return "boiler";
  if (SECTION_OTHER.test(t)) return "other";
  return null;
}

/** "IMPRESSION: 1. …" on one line → heading + text, so the heading is recognised. */
function splitInlineLabel(line: string): string[] {
  const m = /^([A-Za-z][A-Za-z /&()-]{1,40}?)\s*:\s+(\S.*)$/.exec(line);
  if (m && !META_LABEL.test(line) && sectionOfHeading(m[1])) return [`${m[1].trim()}:`, m[2]];
  return [line];
}

const docUnitCache = new WeakMap<GoatFile, DocUnit[]>();

export function docUnits(file: GoatFile): DocUnit[] {
  const cached = docUnitCache.get(file);
  if (cached) return cached;
  const out: DocUnit[] = [];
  let section: DocSection = "header";
  let region: BodyRegion | null = null;
  (file.pages ?? []).forEach((pageText, i) => {
    const raw = pageText.split(/\n+/).flatMap((l) => splitInlineLabel(l.replace(/\s+/g, " ").trim())).filter(Boolean);
    let n = 0;
    for (const text of joinWrapped(raw, isHeading).flatMap(splitNumbered)) {
      n += 1;
      const heading = isHeading(text);
      const named = regionsNamedIn(text);
      const meta = META_LABEL.test(text);
      if (heading) {
        const kind = sectionOfHeading(text);
        if (kind) section = kind;
        // A letterhead repeated at the top of each page ends the previous page's section.
        else if (n <= 3 && !named.length) section = "header";
        // "CERVICAL SPINE:", "MRI LUMBAR SPINE WITHOUT CONTRAST", "LEFT KNEE"
        if (named.length === 1) region = named[0];
        out.push({ text, page: i + 1, heading: true, section: kind ?? section, region });
        continue;
      }
      if (meta) {
        // "Study Description : MRI LT/KNEE" — boilerplate, but it tells which region follows.
        if (named.length === 1 && Object.values(MODALITY_WORD).some((re) => re.test(text))) region = named[0];
        section = "boiler";
        out.push({ text, page: i + 1, heading: false, section: "boiler", region });
        continue;
      }
      // "Lumbar: …", "2. Left knee: …" at the start of an item names its region.
      const lead = /^(?:\(?\d{1,2}[.)]\s*)?([A-Za-z][A-Za-z /()-]{0,30}?)\s*:/.exec(text);
      const leadRegions = lead ? regionsNamedIn(lead[1]) : [];
      const byLevel = [...new Set(levelsIn(text).map((l) => (l[0] === "C" ? "Cervical" : l[0] === "T" ? "Thoracic" : "Lumbar") as BodyRegion))];
      let unitRegion = region;
      if (leadRegions.length === 1) unitRegion = region = leadRegions[0];
      else if (byLevel.length === 1) {
        unitRegion = byLevel[0];
        if (!region || ["Cervical", "Thoracic", "Lumbar", "Sacrum"].includes(region)) region = byLevel[0];
      }
      out.push({ text, page: i + 1, heading: false, section: section === "header" ? "header" : section, region: unitRegion });
    }
  });
  docUnitCache.set(file, out);
  return out;
}

/** An imaging report of one of these types (file name, or its title / study lines). */
export function isImagingReport(file: GoatFile, modalities: Modality[]): boolean {
  const kinds = modalities.length ? modalities : (Object.keys(MODALITY_WORD) as Modality[]);
  if (kinds.some((k) => MODALITY_WORD[k].test(file.name.replace(/[_.-]+/g, " ")))) return true;
  const titleish = docUnits(file)
    .slice(0, 40)
    .filter((u) => u.heading || u.section === "boiler" || u.section === "header")
    .filter((u) => u.text.length <= 120)
    .map((u) => u.text);
  return titleish.some((t) => kinds.some((k) => MODALITY_WORD[k].test(t)) && (regionsNamedIn(t).length > 0 || /exam|study|procedure|impression|spine/i.test(t)));
}

function regionMatches(u: DocUnit, rq: RegionQuery | undefined): boolean {
  if (!rq || (!rq.regions.length && !rq.levels.length)) return true;
  const levels = levelsIn(u.text);
  if (rq.levels.length) return levels.some((l) => rq.levels.includes(l));
  if (u.region) return rq.regions.includes(u.region);
  return regionsNamedIn(u.text).some((r) => rq.regions.includes(r));
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

export function answerFromFiles(files: GoatFile[], q: FilesQuery): GoatFilesResult | null {
  const who = resolveWho(q.question, q.asked, q.people);
  const rq = q.region;
  const findingsGroup =
    q.allGroups.find((g) => g.terms.some((t) => /^(findings|impression)$/i.test(t))) ?? null;
  const wantsReferral = /\b(referral|referred|refer|order|authori[sz]ation|request)\b/i.test(q.question);
  const wantsFindings =
    /\b(finding|findings|found|result|results|impression|assessment|conclusion|report|exam|examination)\b/i.test(q.question) ||
    (findingsGroup !== null && q.asked.includes(findingsGroup));
  const wantsImpressionOnly = /\b(impressions?|conclusions?|opinion)\b/i.test(q.question);
  const regionAsked = Boolean(rq && (rq.regions.length || rq.levels.length));
  // "lumbar MRI", or "low back findings" (a region + findings, nothing else) → imaging reports.
  const onlyFindingsAsked =
    regionAsked &&
    !rq?.levels.length &&
    /\b(findings?|impressions?|results?)\b/i.test(q.question) &&
    q.asked.every((g) => g === findingsGroup || isRegionGroup(g));
  const imagingMode = Boolean(rq && (rq.modalities.length || onlyFindingsAsked));

  // Topics: asked groups that aren't the "who", a body region or an imaging
  // type (those filter instead), plus leftover words.
  const modalityGroup = (g: GoatTermGroup) => g.terms.some((t) => /^(x-?ray|mri|ct)$/i.test(t));
  let topics = q.asked.filter((g) => !who.specialtyGroups.includes(g) && !isRegionGroup(g) && !modalityGroup(g));
  if ((topics.length > 1 || imagingMode) && findingsGroup) topics = topics.filter((g) => g !== findingsGroup);
  const covered = new Set(
    [...q.asked.flatMap((g) => g.terms), ...who.people.map((p) => p.name)]
      .flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/))
      .filter(Boolean),
  );
  const leftovers = q.words.filter(
    (w) => w.length >= 3 && !covered.has(w) && !FILE_WORDS.has(w) && !regionsNamedIn(w).length && !/^(mri|mris|xray|xrays|ct|scan|scans|imaging|spine)$/.test(w),
  );
  const topicMatchers: Array<{ label: string; m: TermMatcher }> = [
    ...topics.map((g) => ({ label: g.terms[0], m: makeMatcher(g.terms) })),
    ...leftovers.map((w) => ({ label: w, m: makeMatcher([w]) })),
  ];
  // A level ("L5-S1") is its own topic when nothing else is asked.
  if (!topicMatchers.length && rq?.levels.length && !imagingMode) {
    topicMatchers.push({ label: rq.levels.join(", "), m: makeMatcher(levelHighlightTerms(rq.levels)) });
  }
  const hasWho = who.specialtyGroups.length > 0 || who.people.length > 0;
  // "lumbar" alone: search for the region's words, as before.
  if (!topicMatchers.length && !hasWho && !imagingMode && rq?.regions.length) {
    const regionTerms = q.asked.filter(isRegionGroup).flatMap((g) => g.terms);
    topicMatchers.push({ label: rq.regions.join(", ").toLowerCase(), m: makeMatcher(regionTerms.length ? regionTerms : rq.regions) });
  }
  if (!topicMatchers.length && !hasWho && !imagingMode) return null;
  if (!topicMatchers.length && !imagingMode) {
    // "PM report?" — show the conclusions of their report.
    const g = findingsGroup ?? { id: "f", terms: ["impression", "assessment", "findings"], updatedAt: "" };
    topicMatchers.push({ label: g.terms[0], m: makeMatcher(g.terms) });
  }
  const regionFilterInText = regionAsked && !(topicMatchers.length === 1 && !imagingMode && rq?.regions.length && !rq.levels.length && topicMatchers[0].label === rq.regions.join(", ").toLowerCase());

  const whoMatchers = who.people.map((p) => ({ person: p, m: makeMatcher(cleanTerms([p.name, surnameOf(p.name)])) }));
  const specialtyMatcher = makeMatcher(who.specialtyGroups.flatMap((g) => g.terms).filter((t) => t.length > 3));
  const readFiles = files.filter((f) => f.status === "read" && f.pages);
  const unread = files.filter((f) => f.status === "unread" || f.status === "needsOcr" || f.status === "reading").length;
  const scannedUnread = files.filter((f) => f.status === "needsOcr").length;
  const notes = [...who.notes];

  type Scored = GoatFileMatch & { whoScore: number; topicScore: number; ts: number };
  const scored: Scored[] = [];
  const regionWord = rq ? (rq.levels.length ? rq.levels.join(", ") : rq.regions.join(", ").toLowerCase()) : "";

  for (const f of readFiles) {
    const text = (f.pages ?? []).join("\n");
    const whoNames = whoMatchers.filter(({ m }) => m.test(text) || m.test(f.name)).map(({ person }) => person.name);
    const whoScore = whoNames.length ? 2 : hasWho && specialtyMatcher.terms.length && (specialtyMatcher.test(text) || specialtyMatcher.test(f.name)) ? 1 : 0;
    const docType = classifyDoc(f);
    const units = docUnits(f);
    const { date, label } = docDate(f);
    const hits: GoatFileLine[] = [];
    let topicScore = 0;

    if (imagingMode && rq) {
      // "lumbar MRI": the report's IMPRESSION / FINDINGS for that region, in full.
      if (!isImagingReport(f, rq.modalities)) continue;
      const key = units.filter((u) => !u.heading && (u.section === "impression" || u.section === "findings"));
      let chosen = key.filter((u) => regionMatches(u, rq));
      if (topicMatchers.length) chosen = chosen.filter((u) => topicMatchers.some(({ m }) => m.test(u.text)));
      if (wantsImpressionOnly && chosen.some((u) => u.section === "impression")) chosen = chosen.filter((u) => u.section === "impression");
      if (!chosen.length) {
        if (regionAsked && key.length) {
          const covers = [...new Set(key.map((u) => u.region).filter(Boolean))].join(", ");
          notes.push(`${f.name} has no ${regionWord} ${wantsImpressionOnly ? "impression" : "findings"}${covers ? ` (it covers ${covers.toLowerCase()})` : ""}.`);
        } else if (!key.length) {
          notes.push(`${f.name} looks like an imaging report, but I couldn't find an Impression or Findings section in it.`);
        }
        continue;
      }
      // Impression first, then findings; a small heading whenever section or region changes.
      const ordered = [...chosen.filter((u) => u.section === "impression"), ...chosen.filter((u) => u.section === "findings")];
      let lastHead = "";
      for (const u of ordered) {
        const head = `${u.section === "impression" ? "Impression" : "Findings"}${u.region ? ` · ${u.region}` : ""}`;
        if (head !== lastHead) {
          hits.push({ text: head, page: u.page, heading: true });
          lastHead = head;
        }
        hits.push({ text: u.text, page: u.page });
      }
      topicScore = 1000 + ordered.length;
    } else {
      let groupsHit = 0;
      const hitIdx = new Set<number>();
      for (const { m } of topicMatchers) {
        let any = false;
        units.forEach((u, i) => {
          if (!m.test(u.text)) return;
          if (regionFilterInText && !u.heading && !regionMatches(u, rq)) return;
          any = true;
          hitIdx.add(i);
          // A matching heading brings the units under it (until the next heading).
          if (u.heading) {
            for (let j = i + 1; j < units.length && j <= i + 10 && !units[j].heading; j++) {
              if (!regionFilterInText || regionMatches(units[j], rq)) hitIdx.add(-(j + 1));
            }
          }
        });
        if (any) groupsHit += 1;
      }
      // Header / technique boilerplate only counts when nothing better matched.
      const isBoiler = (i: number) => {
        const u = units[i < 0 ? -i - 1 : i];
        return u.section === "boiler" || (u.section === "header" && !u.heading && META_LABEL.test(u.text));
      };
      if ([...hitIdx].some((i) => !isBoiler(i))) for (const i of [...hitIdx]) if (isBoiler(i)) hitIdx.delete(i);
      // Nearest heading above each match (within a few units) gives it context.
      const context = new Set<number>();
      for (const i of hitIdx) {
        if (i < 0 || units[i].heading) continue;
        for (let j = i - 1; j >= 0 && j >= i - 8 && units[j].page === units[i].page; j--) {
          if (units[j].heading) {
            if (!hitIdx.has(j)) context.add(j);
            break;
          }
        }
      }
      const idx = [...new Set([...[...hitIdx].map((i) => (i < 0 ? -i - 1 : i)), ...context])].sort((a, b) => a - b);
      for (const i of idx) {
        const u = units[i];
        if (context.has(i) && !hitIdx.has(i) && !hitIdx.has(-(i + 1))) hits.push({ text: u.text, page: u.page, heading: true });
        else hits.push({ text: u.text, page: u.page, inSection: !hitIdx.has(i), ...(u.heading ? { heading: true } : {}) });
      }
      // A heading whose lines were all filtered out says nothing on its own.
      for (let k = hits.length - 1; k >= 0; k--) {
        if (hits[k].heading && (k === hits.length - 1 || hits[k + 1].heading)) hits.splice(k, 1);
      }
      topicScore = groupsHit * 100 + Math.min(hitIdx.size, 50);
    }
    scored.push({ fileId: f.id, name: f.name, date, dateLabel: label, docType, who: whoNames, lines: hits, whoScore, topicScore, ts: stamp(date) });
  }

  const highlight = cleanTerms([
    ...topicMatchers.flatMap((t) => t.m.terms),
    ...who.people.flatMap((p) => [p.name, surnameOf(p.name)]),
    ...(rq ? levelHighlightTerms(rq.levels) : []),
  ]);

  // Who-matching files only, when the question names a doctor/specialty.
  let pool = scored;
  if (hasWho) {
    const fromWho = scored.filter((s) => s.whoScore > 0);
    if (fromWho.length) pool = fromWho;
    else {
      const names = who.people.map((p) => p.name).join(" or ") || who.specialtyGroups.map((g) => g.terms[0]).join(" or ");
      notes.push(`I couldn't find a file from ${names}${unread ? " in the files I've read so far" : ""}.`);
      pool = [];
    }
  }

  // Findings (and "what did the PM doctor say") come from reports, never from
  // a referral form. A plain word search still shows referrals, ranked last.
  const referrals = pool.filter((s) => s.docType === "referral");
  if (!wantsReferral && (wantsFindings || hasWho || imagingMode)) {
    const reports = pool.filter((s) => s.docType !== "referral");
    if ((wantsFindings || topics.length) && referrals.length && !reports.some((s) => s.lines.length)) {
      const r = referrals[0];
      const who1 = r.who[0] ?? who.people[0]?.name ?? "them";
      notes.push(
        reports.length
          ? `There's a referral to ${who1} on file (${r.name}, ${r.dateLabel} ${r.date}), but their report doesn't mention ${topicMatchers.map((t) => t.label).join(" or ")}.`
          : `Only a referral to ${who1} is on file (${r.name}, ${r.dateLabel} ${r.date}). There's no report from them yet, so there are no findings to show.`,
      );
    } else if (referrals.some((r) => r.lines.length)) {
      const shown = referrals.filter((r) => r.lines.length);
      notes.push(`Skipped ${shown.length === 1 ? "a referral form" : `${shown.length} referral forms`} (${shown.map((r) => r.name).join(", ")}): findings come from reports.`);
    }
    pool = reports;
  }

  const withLines = pool.filter((s) => s.lines.length > 0);
  if (imagingMode && rq && !withLines.length && !notes.some((n) => n.includes(" has no ") || n.includes("looks like an imaging report"))) {
    const kind = rq.modalities.join("/");
    notes.push(`No ${kind} report among the files I've read${unread ? " so far" : ""}.`);
  }
  if (!imagingMode && pool.length && !withLines.length && !notes.some((n) => n.startsWith("Only a referral") || n.startsWith("There's a referral"))) {
    const names = pool.slice(0, 3).map((s) => s.name).join(", ");
    notes.push(`${names} ${pool.length === 1 ? "doesn't" : "don't"} mention ${topicMatchers.map((t) => t.label).join(" or ")}${regionFilterInText ? ` for ${regionWord}` : ""}.`);
  }
  withLines.sort(
    (a, b) =>
      b.whoScore - a.whoScore ||
      Number(b.docType === "report") - Number(a.docType === "report") ||
      (imagingMode ? b.ts - a.ts : 0) ||
      b.topicScore - a.topicScore ||
      b.ts - a.ts,
  );
  if (unread) {
    const scanned = scannedUnread ? ` (${scannedUnread === unread ? (unread === 1 ? "it's a scan" : "scans") : `${scannedUnread} scanned`})` : "";
    notes.push(
      `${unread} file${unread === 1 ? " isn't" : "s aren't"} read yet${scanned}, so ${unread === 1 ? "it isn't" : "they aren't"} included. Use "Read files" below to read ${unread === 1 ? "it" : "them"}.`,
    );
  }
  // Questions that aren't about files ("next visit?") only get a files card when a file matches.
  const aboutFiles = hasWho || topics.length > 0 || imagingMode || /\b(files?|pdfs?|documents?|reports?|records?)\b/i.test(q.question);
  if (!withLines.length && (!aboutFiles || !notes.length)) return null;
  const MAX_FILES = 5;
  return {
    notes,
    matches: withLines.slice(0, MAX_FILES).map((s) => ({
      fileId: s.fileId,
      name: s.name,
      date: s.date,
      dateLabel: s.dateLabel,
      docType: s.docType,
      who: s.who,
      lines: s.lines,
    })),
    moreFiles: Math.max(0, withLines.length - MAX_FILES),
    highlight,
    unread,
    ...(imagingMode && rq
      ? {
          title: `${rq.modalities.length ? rq.modalities.join(" / ") : "Imaging"} report${regionAsked ? ` · ${rq.levels.length ? rq.levels.join(", ") : rq.regions.join(", ")}` : ""}`,
          expanded: true,
        }
      : {}),
  };
}

export const GOAT_LINES_PER_FILE = PER_FILE_DEFAULT;

// ---------------------------------------------------------------------------
// Range of motion out of a specialist's report
// ---------------------------------------------------------------------------

export interface GoatRomAnswer {
  /** The report the values came from (newest first when there are several). */
  file?: { id: string; name: string; date: string; dateLabel: "dated" | "uploaded"; docType: GoatDocType };
  /** Doctor(s) the question named and the report matched. */
  who: string[];
  regions: RomRegion[];
  /** One line per region: "Cervical ROM" + "30° anterior flexion (with pain)" … */
  blocks: Array<{ heading: string; items: string[] }>;
  /** Other reports with ROM (newest first, after the one shown). */
  others: Array<{ id: string; name: string; date: string }>;
  notes: string[];
  /** The sentences the values came from (for highlighting). */
  quotes: string[];
}

/**
 * "what was the range of motion for cervical and lumbar from dr armen":
 * the doctor's REPORT (referral forms skipped), its ROM values by region in the
 * order written. With no doctor named, any report with ROM (newest first).
 */
export function romFromFiles(files: GoatFile[], q: FilesQuery): GoatRomAnswer | null {
  const who = resolveWho(q.question, q.asked, q.people);
  const hasWho = who.people.length > 0 || who.specialtyGroups.length > 0;
  const whoMatchers = who.people.map((p) => ({ person: p, m: makeMatcher(cleanTerms([p.name, surnameOf(p.name)])) }));
  const specialtyMatcher = makeMatcher(who.specialtyGroups.flatMap((g) => g.terms).filter((t) => t.length > 3));
  // Regions in the order the question names them ("lumbar and cervical").
  const ends = [...q.question.matchAll(/\S+/g)].map((m) => (m.index ?? 0) + m[0].length);
  const firstAt = (r: BodyRegion) => ends.find((e) => regionsNamedIn(q.question.slice(0, e)).includes(r)) ?? Infinity;
  const wanted = [...(q.region?.regions ?? [])].sort((x, y) => firstAt(x) - firstAt(y));
  const readFiles = files.filter((f) => f.status === "read" && f.pages);
  const pending = files.filter((f) => f.status === "unread" || f.status === "needsOcr" || f.status === "reading").length;
  const notes: string[] = [];
  const whoLabel = who.people.length ? who.people.map((p) => p.name).join(" / ") : who.specialtyGroups.map((g) => g.terms[0]).join(" / ");
  // "from dr smith" with no Dr. Smith on file: say so rather than pass someone else's report off as theirs.
  const askedDr = /(?<![a-z])(?:dr|doctor)\.?\s+([a-z][a-z'-]{2,})/i.exec(q.question);
  if (askedDr && !who.people.length) {
    notes.push(`I don't have a "Dr. ${askedDr[1].charAt(0).toUpperCase()}${askedDr[1].slice(1)}" among this patient's specialists or Contacts, so this is the latest report with range of motion from anyone.`);
  }

  type Found = { file: GoatFile; names: string[]; regions: RomRegion[]; ts: number; date: string; label: "dated" | "uploaded"; docType: GoatDocType };
  const found: Found[] = [];
  let referralsSkipped = 0;
  let theirFiles = 0;
  for (const f of readFiles) {
    const text = (f.pages ?? []).join("\n");
    const names = whoMatchers.filter(({ m }) => m.test(text) || m.test(f.name)).map(({ person }) => person.name);
    const bySpecialty = !names.length && !who.people.length && specialtyMatcher.terms.length > 0 && (specialtyMatcher.test(text) || specialtyMatcher.test(f.name));
    if (hasWho && !names.length && !bySpecialty) continue;
    theirFiles += 1;
    const docType = classifyDoc(f);
    if (docType === "referral") {
      referralsSkipped += 1;
      continue;
    }
    const all = extractRom(docUnits(f).map((u) => ({ text: u.text, contextRegion: u.region, heading: u.heading })));
    if (!all.length) continue;
    const regions = wanted.length ? all.filter((r) => r.body && wanted.includes(r.body)) : all;
    const { date, label } = docDate(f);
    found.push({ file: f, names, regions, ts: stamp(date), date, label, docType });
  }

  if (hasWho && !theirFiles) {
    notes.push(`No file I've read mentions ${whoLabel}.`);
  } else if (!found.length) {
    notes.push(
      hasWho
        ? `I found ${theirFiles} file${theirFiles === 1 ? "" : "s"} from ${whoLabel}, but no range-of-motion values in ${theirFiles === 1 ? "it" : "them"}${referralsSkipped ? ` (${referralsSkipped} referral form${referralsSkipped === 1 ? "" : "s"} skipped)` : ""}.`
        : "No range-of-motion values in the files I've read.",
    );
  }
  if (pending) notes.push(`${pending} file${pending === 1 ? " isn't" : "s aren't"} read yet — open Patient Files to read ${pending === 1 ? "it" : "them"}, then ask again.`);
  if (!found.length) return notes.length ? { who: who.people.map((p) => p.name), regions: [], blocks: [], others: [], notes, quotes: [] } : null;

  // Newest report first; among those, one that has the regions asked.
  found.sort((a, b) => b.ts - a.ts);
  const best = found.find((x) => x.regions.length) ?? found[0];
  const others = found.filter((x) => x !== best);
  // Asked order ("cervical and lumbar"), else the report's order.
  const regions = wanted.length
    ? wanted.flatMap((w) => best.regions.filter((r) => r.body === w))
    : best.regions;
  for (const w of wanted) {
    if (!best.regions.some((r) => r.body === w)) {
      const elsewhere = others.find((x) => x.regions.some((r) => r.body === w));
      notes.push(
        `No ${w.toLowerCase()} range of motion in this report${elsewhere ? ` — ${elsewhere.file.name} (${elsewhere.label} ${elsewhere.date || "—"}) has it` : ""}.`,
      );
    }
  }
  if (others.length) {
    notes.push(
      `${others.length} other report${others.length === 1 ? "" : "s"}${hasWho ? ` from ${whoLabel}` : ""} also ${others.length === 1 ? "has" : "have"} range of motion: ${others
        .slice(0, 3)
        .map((x) => `${x.file.name} (${x.label} ${x.date || "—"})`)
        .join("; ")}${others.length > 3 ? "; …" : ""}.`,
    );
  }
  return {
    file: { id: best.file.id, name: best.file.name, date: best.date, dateLabel: best.label, docType: best.docType },
    who: best.names,
    regions,
    blocks: regions.map((r) => ({ heading: romHeading(r), items: r.measures.map(formatRomMeasure) })),
    others: others.map((x) => ({ id: x.file.id, name: x.file.name, date: x.date })),
    notes,
    quotes: [...new Set(regions.flatMap((r) => r.quotes))],
  };
}
