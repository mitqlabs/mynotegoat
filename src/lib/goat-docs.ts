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
  if (/:\s*$/.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase() && t.split(/\s+/).length <= 7;
}

/** Pages → lines (long lines split into sentences), with page numbers. */
export function fileLines(file: GoatFile): GoatFileLine[] {
  const out: GoatFileLine[] = [];
  (file.pages ?? []).forEach((pageText, i) => {
    for (const raw of pageText.split(/\n+/)) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line) continue;
      const pieces = line.length > 220 ? line.split(/(?<=[.;])\s+(?=[A-Z(])/) : [line];
      for (const p of pieces) if (p.trim()) out.push({ text: p.trim(), page: i + 1 });
    }
  });
  return out;
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

const DOC_DATE = /\b(?:date of (?:service|exam|examination|visit|evaluation|consultation|report)|dos|exam date|visit date|report date)\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i;

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
  // A doctor named in the question ("Haroutunian findings").
  const q = question.toLowerCase();
  for (const p of people) {
    const s = surnameOf(p.name).toLowerCase();
    if (s.length >= 4 && new RegExp(`\\b${s.replace(/[^a-z'-]/g, "")}\\b`).test(q)) found.set(p.name.toLowerCase(), p);
  }
  return { specialtyGroups, people: [...found.values()], notes };
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

const FILE_WORDS = new Set(
  "file files pdf pdfs document documents doc docs report reports note notes say says said show find found findings result results from for about any what which does did patient pt dr doctor".split(" "),
);

export interface FilesQuery {
  question: string;
  /** Lower-cased content words of the question (no stop words). */
  words: string[];
  asked: GoatTermGroup[];
  allGroups: GoatTermGroup[];
  people: GoatPerson[];
}

const PER_FILE_DEFAULT = 12;

export function answerFromFiles(files: GoatFile[], q: FilesQuery): GoatFilesResult | null {
  const who = resolveWho(q.question, q.asked, q.people);
  const findingsGroup =
    q.allGroups.find((g) => g.terms.some((t) => /^(findings|impression)$/i.test(t))) ?? null;
  const wantsReferral = /\b(referral|referred|refer|order|authori[sz]ation|request)\b/i.test(q.question);
  const wantsFindings =
    /\b(finding|findings|found|result|results|impression|assessment|conclusion|report|exam|examination)\b/i.test(q.question) ||
    (findingsGroup !== null && q.asked.includes(findingsGroup));

  // Topics: asked groups that aren't the "who", plus leftover words.
  let topics = q.asked.filter((g) => !who.specialtyGroups.includes(g));
  if (topics.length > 1 && findingsGroup) topics = topics.filter((g) => g !== findingsGroup);
  const covered = new Set(
    [...q.asked.flatMap((g) => g.terms), ...who.people.map((p) => p.name)]
      .flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/))
      .filter(Boolean),
  );
  const leftovers = q.words.filter((w) => w.length >= 3 && !covered.has(w) && !FILE_WORDS.has(w));
  const topicMatchers: Array<{ label: string; m: TermMatcher }> = [
    ...topics.map((g) => ({ label: g.terms[0], m: makeMatcher(g.terms) })),
    ...leftovers.map((w) => ({ label: w, m: makeMatcher([w]) })),
  ];
  const hasWho = who.specialtyGroups.length > 0 || who.people.length > 0;
  if (!topicMatchers.length && !hasWho) return null;
  if (!topicMatchers.length) {
    // "PM report?" — show the conclusions of their report.
    const g = findingsGroup ?? { id: "f", terms: ["impression", "assessment", "findings"], updatedAt: "" };
    topicMatchers.push({ label: g.terms[0], m: makeMatcher(g.terms) });
  }

  const whoMatchers = who.people.map((p) => ({ person: p, m: makeMatcher(cleanTerms([p.name, surnameOf(p.name)])) }));
  const specialtyMatcher = makeMatcher(who.specialtyGroups.flatMap((g) => g.terms).filter((t) => t.length > 3));
  const readFiles = files.filter((f) => f.status === "read" && f.pages);
  const unread = files.filter((f) => f.status === "unread" || f.status === "needsOcr" || f.status === "reading").length;
  const scannedUnread = files.filter((f) => f.status === "needsOcr").length;

  type Scored = GoatFileMatch & { whoScore: number; topicScore: number; ts: number };
  const scored: Scored[] = [];
  for (const f of readFiles) {
    const text = (f.pages ?? []).join("\n");
    const whoNames = whoMatchers.filter(({ m }) => m.test(text) || m.test(f.name)).map(({ person }) => person.name);
    const whoScore = whoNames.length ? 2 : hasWho && specialtyMatcher.terms.length && (specialtyMatcher.test(text) || specialtyMatcher.test(f.name)) ? 1 : 0;
    const docType = classifyDoc(f);
    const lines = fileLines(f);
    const hits: GoatFileLine[] = [];
    let groupsHit = 0;
    const hitIdx = new Set<number>();
    for (const { m } of topicMatchers) {
      let any = false;
      lines.forEach((line, i) => {
        if (!m.test(line.text)) return;
        any = true;
        hitIdx.add(i);
        // A matching heading brings the lines under it (until the next heading).
        if (isHeading(line.text)) {
          for (let j = i + 1; j < lines.length && j <= i + 10 && !isHeading(lines[j].text); j++) hitIdx.add(-(j + 1));
        }
      });
      if (any) groupsHit += 1;
    }
    // Nearest heading above each match (within a few lines) gives it context.
    const context = new Set<number>();
    for (const i of hitIdx) {
      if (i < 0 || isHeading(lines[i].text)) continue;
      for (let j = i - 1; j >= 0 && j >= i - 8 && lines[j].page === lines[i].page; j--) {
        if (isHeading(lines[j].text)) {
          if (!hitIdx.has(j)) context.add(j);
          break;
        }
      }
    }
    const idx = [...new Set([...[...hitIdx].map((i) => (i < 0 ? -i - 1 : i)), ...context])].sort((a, b) => a - b);
    for (const i of idx) {
      if (context.has(i) && !hitIdx.has(i) && !hitIdx.has(-(i + 1))) hits.push({ ...lines[i], heading: true });
      else hits.push({ ...lines[i], inSection: !hitIdx.has(i), ...(isHeading(lines[i].text) ? { heading: true } : {}) });
    }
    const { date, label } = docDate(f);
    scored.push({
      fileId: f.id,
      name: f.name,
      date,
      dateLabel: label,
      docType,
      who: whoNames,
      lines: hits,
      whoScore,
      topicScore: groupsHit * 100 + Math.min(hitIdx.size, 50),
      ts: stamp(date),
    });
  }

  const notes = [...who.notes];
  const highlight = cleanTerms([
    ...topicMatchers.flatMap((t) => t.m.terms),
    ...who.people.flatMap((p) => [p.name, surnameOf(p.name)]),
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
  if (!wantsReferral && (wantsFindings || hasWho)) {
    const reports = pool.filter((s) => s.docType !== "referral");
    if ((wantsFindings || topics.length) && referrals.length && !reports.some((s) => s.lines.length)) {
      const r = referrals[0];
      const who1 = r.who[0] ?? who.people[0]?.name ?? "them";
      notes.push(
        reports.length
          ? `There's a referral to ${who1} on file (${r.name}, ${r.dateLabel} ${r.date}), but their report doesn't mention ${topicMatchers.map((t) => t.label).join(" or ")}.`
          : `Only a referral to ${who1} is on file (${r.name}, ${r.dateLabel} ${r.date}). There's no report from them yet, so there are no findings to show.`,
      );
    } else if (referrals.length) {
      notes.push(`Skipped ${referrals.length === 1 ? "a referral form" : `${referrals.length} referral forms`} (${referrals.map((r) => r.name).join(", ")}): findings come from reports.`);
    }
    pool = reports;
  }

  const withLines = pool.filter((s) => s.lines.length > 0);
  if (pool.length && !withLines.length && !notes.some((n) => n.startsWith("Only a referral") || n.startsWith("There's a referral"))) {
    const names = pool.slice(0, 3).map((s) => s.name).join(", ");
    notes.push(`${names} ${pool.length === 1 ? "doesn't" : "don't"} mention ${topicMatchers.map((t) => t.label).join(" or ")}.`);
  }
  withLines.sort(
    (a, b) =>
      b.whoScore - a.whoScore ||
      Number(b.docType === "report") - Number(a.docType === "report") ||
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
  const aboutFiles = hasWho || topics.length > 0 || /\b(files?|pdfs?|documents?|reports?|records?)\b/i.test(q.question);
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
  };
}

export const GOAT_LINES_PER_FILE = PER_FILE_DEFAULT;
