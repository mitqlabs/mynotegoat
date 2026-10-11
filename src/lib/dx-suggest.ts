/**
 * G.O.A.T. — "Suggested from MRI" diagnosis codes (pure, no I/O).
 *
 * Reads the patient's MRI/CT findings (Imaging panel text and the uploaded
 * MRI/CT reports G.O.A.T. has already read), finds findings per spinal level
 * and region, and maps them to ICD-10-CM codes using the editable rules in
 * dx-suggest-map.ts. Radiculopathy / myelopathy / neurogenic claudication
 * change the code only when the patient's notes support them.
 *
 * It only suggests. Every suggestion carries the line it came from, and
 * nothing is added to the patient unless the user clicks Add. Codes already
 * on the patient are skipped. Sections hidden for the user are never passed
 * in (the caller builds the input from the privacy-filtered GoatContext).
 */

import type { GoatContext } from "@/lib/goat";
import { plainText } from "@/lib/goat";
import { docUnits, isImagingReport, type GoatFile } from "@/lib/goat-docs";
import { regionsNamedIn, splitFindings, type BodyRegion } from "@/lib/goat-regions";
import {
  CLAUDICATION_TERMS,
  DX_RULES,
  LIMB_REGION,
  MYELOPATHY_TERMS,
  RADICULOPATHY,
  RADICULOPATHY_TERMS,
  SEGMENT_FAMILY,
  SEGMENT_ORDER,
  type DxCode,
  type DxCodeMap,
  type DxKey,
  type DxRule,
  type SpineSegment,
} from "@/lib/dx-suggest-map";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DxSourceText {
  text: string;
  /** Where it came from, in words: "MRI · Imaging panel", "MRI report.pdf (p. 2)". */
  source: string;
  /** Regions the record is for (Imaging panel), used when the text names none. */
  regions?: string[];
}

export interface DxSuggestInput {
  /** MRI/CT findings text (Imaging panel referrals + the legacy MRI box). */
  imaging: DxSourceText[];
  /** Uploaded files with their read text (null/undefined = hidden or not available). */
  files?: GoatFile[] | null;
  /** Notes, SOAP, specialist recommendations — for radiculopathy / myelopathy / claudication support. */
  clinical: DxSourceText[];
  /** The office's Diagnosis Code settings list (preferred when it has the code). */
  library: Array<{ code: string; description: string }>;
  /** Codes already on the patient (skipped). */
  existing: Array<{ code: string }>;
}

export interface DxEvidence {
  text: string;
  source: string;
}

export interface DxSuggestion {
  code: string;
  description: string;
  segment: SpineSegment;
  /** Finding names ("Disc herniation / bulge"). */
  labels: string[];
  /** MRI lines it came from (first = shown, rest behind "more"). */
  evidence: DxEvidence[];
  /** Note line supporting radiculopathy / myelopathy / claudication, when that changed the code. */
  support?: DxEvidence & { kind: "radiculopathy" | "myelopathy" | "claudication" };
  /** The code is in the office's Diagnosis Code settings. */
  inLibrary: boolean;
  /** Other valid options for the same finding (e.g. M51.360–M51.362). */
  others: DxCode[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const rx = (terms: string[]) => new RegExp(`(?<![A-Za-z])(?:${terms.join("|")})(?![A-Za-z])`, "gi");
const raw = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

const NEGATION =
  /(?<![A-Za-z])(?:no|not|without|negative for|absence of|absent|free of|resolved|neither|nor|unremarkable|normal|denies|denied)(?![A-Za-z])/gi;
/** Uncertain wording: the rest of the sentence doesn't count, whatever the size words say ("possible small tear"). */
const HEDGE =
  /(?<![A-Za-z])(?:rule out|ruled out|r\/o|cannot (?:be )?exclud\w*|can ?not (?:be )?exclud\w*|possible|possibly|probable|questionable|equivocal|suspicious for|suspected|concerning for|versus|vs\.?|history of|h\/o)(?![A-Za-z])/gi;
const STRONG_RESET = /(?<![A-Za-z])(?:but|however|although|though)(?![A-Za-z])/i;
/** Words that start a new, positive statement inside a negated sentence ("no stenosis, mild bulge"). */
const RESET =
  /(?<![A-Za-z])(?:but|however|although|though|mild|mildly|moderate|moderately|severe|severely|small|large|minimal|minimally|slight|slightly|focal|broad|diffuse|tiny|grade|there is|there are|with|resulting|causing|which|demonstrat\w*|shows?|noted|seen|present|\d+(?:\.\d+)?\s?mm)(?![A-Za-z])/gi;
const POST_NEGATION = /^[^.;,]{0,30}?(?<![A-Za-z])(?:is|are|was|were)\s+(?:not|absent|none|no longer)(?![A-Za-z])|^\s*[:-]\s*(?:none|no|negative|absent)(?![A-Za-z])/i;

function lastIndex(re: RegExp, text: string): number {
  let idx = -1;
  for (const m of text.matchAll(re)) idx = (m.index ?? 0) + m[0].length;
  return idx;
}

/** Positive (not negated or hedged) matches of `re` in one sentence/clause. */
export function positiveMatch(clause: string, re: RegExp): boolean {
  for (const m of clause.matchAll(re)) {
    const at = m.index ?? 0;
    const before = clause.slice(0, at);
    const hedge = lastIndex(HEDGE, before);
    if (hedge >= 0 && !STRONG_RESET.test(before.slice(hedge))) continue;
    const neg = lastIndex(NEGATION, before);
    if (neg >= 0) {
      const between = before.slice(neg);
      RESET.lastIndex = 0;
      if (!RESET.test(between)) continue;
    }
    if (POST_NEGATION.test(clause.slice(at + m[0].length))) continue;
    return true;
  }
  return false;
}

/** Sentences / clauses ("L4-L5: bulge; L5-S1: no stenosis" → two). Keeps decimals ("2.5 mm"). */
function clauses(text: string): string[] {
  return text
    .split(/(?<!\d)\.(?!\d)|;|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Levels: "L4-5", "L4-L5", "L4/5", "L5-S1", "L5S1", "C7-T1", "L4 on L5".
const LEVEL =
  /(?<![A-Za-z0-9])([CTL])\s?(\d{1,2})\s*(?:[-/–]\s*([CTLS])?\s?(\d{1,2})|(S)(1)|\s+on\s+([CTLS])\s?(\d{1,2}))(?![0-9])/gi;

export interface Level {
  /** "C5-C6" */
  name: string;
  top: string;
  topNum: number;
}

function levelOrder(l: Level): number {
  const base = { C: 0, T: 10, L: 30 }[l.top as "C" | "T" | "L"] ?? 50;
  return base + l.topNum;
}

export function levelsOf(text: string): Level[] {
  const out = new Map<string, Level>();
  for (const m of text.matchAll(LEVEL)) {
    const top = m[1].toUpperCase();
    const n = Number(m[2]);
    const bottom = (m[3] ?? m[5] ?? m[7] ?? top).toUpperCase();
    const bn = Number(m[4] ?? m[6] ?? m[8]);
    if (!Number.isFinite(bn) || bn <= 0) continue;
    const name = `${top}${n}-${bottom}${bn}`;
    out.set(name, { name, top, topNum: n });
  }
  return [...out.values()];
}

export function segmentOfLevel(l: Level): SpineSegment | null {
  const n = l.topNum;
  if (l.top === "C") return n >= 7 ? "Cervicothoracic" : "Cervical";
  if (l.top === "T") return n >= 11 ? "Thoracolumbar" : n >= 1 ? "Thoracic" : null;
  if (l.top === "L") return n >= 5 ? "Lumbosacral" : "Lumbar";
  return null;
}

function segmentOfRegion(region: BodyRegion | string | null | undefined): SpineSegment | null {
  if (!region) return null;
  if (/lumbosacral/i.test(region)) return "Lumbar";
  const r = regionsNamedIn(region)[0] ?? region;
  return r === "Cervical" ? "Cervical" : r === "Thoracic" ? "Thoracic" : r === "Lumbar" ? "Lumbar" : null;
}

/** "1. C5-C6: 2.0 mm disc bulge…" → "C5-C6: 2.0 mm disc bulge…" (trimmed for display). */
function displayLine(text: string): string {
  const t = text.replace(/\s+/g, " ").replace(/^\s*\(?\d{1,2}[.)]\s+/, "").trim();
  return t.length > 220 ? `${t.slice(0, 217).trimEnd()}…` : t;
}

// ---------------------------------------------------------------------------
// Findings → (rule, segment, level) hits
// ---------------------------------------------------------------------------

interface Finding {
  rule: DxRule;
  segment: SpineSegment;
  level: Level | null;
  /** The clause matched (for variant checks). */
  clause: string;
  evidence: DxEvidence;
}

interface Unit {
  text: string;
  source: string;
  /** Region from a heading / record when the text names none. */
  region: SpineSegment | null;
}

const RULE_RES = DX_RULES.map((rule) => ({ rule, re: rx(rule.terms) }));

function findingsIn(unit: Unit): Finding[] {
  const out: Finding[] = [];
  const itemLevels = levelsOf(unit.text);
  const itemNamed = regionsNamedIn(unit.text.slice(0, 60)).map(segmentOfRegion).filter((s): s is SpineSegment => Boolean(s));
  let carry: Level[] = itemLevels.length ? [itemLevels[0]] : [];
  for (const clause of clauses(unit.text)) {
    const own = levelsOf(clause);
    if (own.length) carry = own;
    const named = regionsNamedIn(clause).map(segmentOfRegion).filter((s): s is SpineSegment => Boolean(s));
    for (const { rule, re } of RULE_RES) {
      re.lastIndex = 0;
      if (!positiveMatch(clause, re)) continue;
      const evidence = { text: displayLine(unit.text), source: unit.source };
      if (carry.length) {
        for (const level of carry) {
          const segment = segmentOfLevel(level);
          if (segment) out.push({ rule, segment, level, clause, evidence });
        }
        continue;
      }
      const segment = (named.length === 1 ? named[0] : null) ?? (itemNamed.length === 1 ? itemNamed[0] : null) ?? unit.region;
      if (segment) out.push({ rule, segment, level: null, clause, evidence });
    }
  }
  return out;
}

/** Imaging panel text → units (one per finding item, with its region heading). */
function panelUnits(src: DxSourceText): Unit[] {
  const sections = splitFindings(plainText(src.text), src.regions ?? []);
  const recordSeg =
    (src.regions ?? []).map(segmentOfRegion).filter((s): s is SpineSegment => Boolean(s)).length === 1
      ? (src.regions ?? []).map(segmentOfRegion).find(Boolean) ?? null
      : null;
  const out: Unit[] = [];
  for (const s of sections) {
    // A non-spine section (Left Knee, Shoulder) is skipped: the rules here are spinal.
    if (s.region && !["Cervical", "Thoracic", "Lumbar", "Sacrum"].includes(s.region)) continue;
    const region = segmentOfRegion(s.region) ?? recordSeg;
    for (const item of s.items) out.push({ text: item, source: src.source, region });
  }
  return out;
}

/** Uploaded MRI/CT report → its Findings / Impression units (history and technique lines are skipped). */
function fileUnits(file: GoatFile): Unit[] {
  if (file.status !== "read" || !file.pages?.length) return [];
  if (!isImagingReport(file, ["MRI", "CT"])) return [];
  const out: Unit[] = [];
  for (const u of docUnits(file)) {
    if (u.heading) continue;
    const useful = u.section === "findings" || u.section === "impression" || (u.section !== "boiler" && u.section !== "other" && levelsOf(u.text).length > 0);
    if (!useful) continue;
    if (u.region && !["Cervical", "Thoracic", "Lumbar", "Sacrum"].includes(u.region)) continue;
    out.push({ text: u.text, source: `${file.name} (p. ${u.page})`, region: segmentOfRegion(u.region) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clinical support from notes
// ---------------------------------------------------------------------------

type Family = "Cervical" | "Thoracic" | "Lumbar";
type SupportKind = "radiculopathy" | "myelopathy" | "claudication";

const RADIC_RE = rx(RADICULOPATHY_TERMS);
const MYELO_RE = rx(MYELOPATHY_TERMS);
const CLAUD_RE = rx(CLAUDICATION_TERMS);
const LIMB_RES = LIMB_REGION.map(([family, p]) => [family, new RegExp(`(?<![A-Za-z])(?:${p})(?![A-Za-z])`, "i")] as const);

function familiesIn(clause: string, withLimbs: boolean): Family[] {
  const out = new Set<Family>();
  for (const r of regionsNamedIn(clause)) {
    if (r === "Cervical" || r === "Thoracic" || r === "Lumbar") out.add(r);
    if (r === "Sacrum") out.add("Lumbar");
  }
  for (const l of levelsOf(clause)) {
    const s = segmentOfLevel(l);
    if (s) out.add(SEGMENT_FAMILY[s]);
  }
  if (withLimbs) for (const [family, re] of LIMB_RES) if (re.test(clause)) out.add(family);
  return [...out];
}

export type ClinicalSupport = Partial<Record<SupportKind, Partial<Record<Family, DxEvidence>>>>;

/** Which regions the notes support radiculopathy / myelopathy / claudication in, with the line that says so. */
export function clinicalSupport(texts: DxSourceText[]): ClinicalSupport {
  const out: ClinicalSupport = {};
  const note = (kind: SupportKind, family: Family, text: string, source: string) => {
    const bucket = (out[kind] ??= {});
    if (!bucket[family]) bucket[family] = { text: displayLine(text), source };
  };
  for (const t of texts) {
    for (const clause of clauses(plainText(t.text))) {
      RADIC_RE.lastIndex = 0;
      if (positiveMatch(clause, RADIC_RE)) {
        // "radiculopathy"/"sciatica" can stand on a region word; symptom words need a limb or region.
        for (const f of familiesIn(clause, true)) note("radiculopathy", f, clause, t.source);
      }
      MYELO_RE.lastIndex = 0;
      if (positiveMatch(clause, MYELO_RE)) for (const f of familiesIn(clause, false)) note("myelopathy", f, clause, t.source);
      CLAUD_RE.lastIndex = 0;
      if (positiveMatch(clause, CLAUD_RE)) note("claudication", "Lumbar", clause, t.source);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Findings → suggestions
// ---------------------------------------------------------------------------

function keysFor(f: Pick<Finding, "segment" | "level">): DxKey[] {
  const keys: DxKey[] = [];
  if (f.level && f.segment === "Cervical") {
    const k = `C${f.level.topNum}-C${f.level.topNum + 1}` as DxKey;
    if (f.level.name === k) keys.push(k);
  }
  keys.push(f.segment);
  return keys;
}

function lookup(map: DxCodeMap | undefined, keys: DxKey[]): DxCode[] | null {
  if (!map) return null;
  for (const k of keys) if (map[k]?.length) return map[k]!;
  return null;
}

interface Acc {
  key: string;
  segment: SpineSegment;
  codes: DxCode[];
  others: DxCode[];
  labels: Set<string>;
  evidence: DxEvidence[];
  support?: DxSuggestion["support"];
  related: Set<string>;
  notes: Set<string>;
  ruleOrder: number;
  levelOrder: number;
}

export function suggestDiagnoses(input: DxSuggestInput): DxSuggestion[] {
  const units: Unit[] = [
    ...input.imaging.flatMap(panelUnits),
    ...(input.files ?? []).flatMap(fileUnits),
  ];
  const findings = units.flatMap(findingsIn);
  if (!findings.length) return [];

  // Myelopathy documented in the MRI text itself counts too.
  const support = clinicalSupport([...input.clinical, ...input.imaging.filter((s) => MYELO_RE.test(s.text))]);
  const radicIn = (s: SpineSegment) => support.radiculopathy?.[SEGMENT_FAMILY[s]];
  const myeloIn = (s: SpineSegment) => support.myelopathy?.[SEGMENT_FAMILY[s]];

  // Which segments have a disc finding (disc combination codes win over spondylosis ones).
  const hasDisc = new Set(findings.filter((f) => f.rule.disc).map((f) => f.segment));
  const compressive = new Set(findings.filter((f) => f.rule.compressive || f.rule.disc).map((f) => f.segment));

  const lib = new Map(input.library.map((d) => [raw(d.code), d] as const));
  const existing = new Set(input.existing.map((d) => raw(d.code)));
  const acc = new Map<string, Acc>();

  const add = (
    segment: SpineSegment,
    codes: DxCode[],
    label: string,
    evidence: DxEvidence | null,
    extras: { others?: DxCode[]; support?: DxSuggestion["support"]; related?: DxCode[]; note?: string; ruleOrder: number; levelOrder: number },
  ) => {
    // Prefer the office's own list among equivalent codes.
    const pick = codes.find((x) => lib.has(raw(x.code))) ?? codes[0];
    const key = raw(pick.code);
    let a = acc.get(key);
    if (!a) {
      a = { key, segment, codes: [pick, ...codes.filter((x) => x !== pick)], others: [], labels: new Set(), evidence: [], related: new Set(), notes: new Set(), ruleOrder: extras.ruleOrder, levelOrder: extras.levelOrder };
      acc.set(key, a);
    }
    a.labels.add(label);
    if (evidence && !a.evidence.some((e) => e.text === evidence.text)) a.evidence.push(evidence);
    for (const o of extras.others ?? []) if (!a.others.some((x) => x.code === o.code)) a.others.push(o);
    for (const r of extras.related ?? []) a.related.add(raw(r.code));
    if (extras.support && !a.support) a.support = extras.support;
    if (extras.note) a.notes.add(extras.note);
    a.ruleOrder = Math.min(a.ruleOrder, extras.ruleOrder);
    a.levelOrder = Math.min(a.levelOrder, extras.levelOrder);
  };

  const radicCombined = new Set<SpineSegment>();
  for (const f of findings) {
    const keys = keysFor(f);
    const ruleOrder = DX_RULES.indexOf(f.rule);
    const lvl = f.level ? levelOrder(f.level) : 99;
    const plain = lookup(f.rule.codes, keys);
    if (!plain) continue;
    let codes = plain;
    let sup: DxSuggestion["support"];
    const isDisc = Boolean(f.rule.disc);
    const myelo = myeloIn(f.segment);
    const radic = radicIn(f.segment);
    // Disc combos win; spondylosis combines only where there's no disc finding.
    const mayCombine = isDisc || !hasDisc.has(f.segment);
    if (myelo && mayCombine && lookup(f.rule.withMyelopathy, keys)) {
      codes = lookup(f.rule.withMyelopathy, keys)!;
      sup = { ...myelo, kind: "myelopathy" };
    } else if (radic && mayCombine && lookup(f.rule.withRadiculopathy, keys)) {
      codes = lookup(f.rule.withRadiculopathy, keys)!;
      sup = { ...radic, kind: "radiculopathy" };
      radicCombined.add(f.segment);
    } else if (f.rule.variant && new RegExp(f.rule.variant.when, "i").test(f.clause) && lookup(f.rule.variant.codes, keys)) {
      codes = lookup(f.rule.variant.codes, keys)!;
    } else if (support.claudication?.Lumbar && lookup(f.rule.withClaudication, keys)) {
      codes = lookup(f.rule.withClaudication, keys)!;
      sup = { ...support.claudication.Lumbar, kind: "claudication" };
    }
    const related = [plain, lookup(f.rule.withRadiculopathy, keys), lookup(f.rule.withMyelopathy, keys)].flat().filter((x): x is DxCode => Boolean(x));
    add(f.segment, codes, f.rule.label, f.evidence, {
      others: lookup(f.rule.others, keys) ?? [],
      support: sup,
      related,
      note: f.rule.note,
      ruleOrder,
      levelOrder: lvl,
    });
  }

  // Radiculopathy the notes support, in a region the MRI shows a compressive
  // finding, with no disc/spondylosis code to combine with → M54.1-.
  for (const segment of SEGMENT_ORDER) {
    const radic = radicIn(segment);
    if (!radic || !compressive.has(segment) || radicCombined.has(segment)) continue;
    const anyCombined = [...radicCombined].some((s) => SEGMENT_FAMILY[s] === SEGMENT_FAMILY[segment]);
    if (anyCombined) continue;
    const codes = RADICULOPATHY[segment];
    if (!codes) continue;
    const ev = findings.find((f) => f.segment === segment && (f.rule.compressive || f.rule.disc))?.evidence ?? null;
    add(segment, codes, "Radiculopathy (notes)", ev, { support: { ...radic, kind: "radiculopathy" }, ruleOrder: DX_RULES.length, levelOrder: 99, related: codes });
  }

  type Draft = DxSuggestion & { acc: Acc };
  const drafts: Draft[] = [...acc.values()].map((a) => {
    const pick = a.codes[0];
    const libEntry = input.library.find((d) => raw(d.code) === a.key);
    return {
      acc: a,
      code: dotted(pick.code),
      description: libEntry?.description?.trim() || pick.description,
      segment: a.segment,
      labels: [...a.labels],
      evidence: a.evidence,
      support: a.support,
      inLibrary: Boolean(libEntry),
      others: [...a.codes.slice(1), ...a.others].filter((o) => raw(o.code) !== a.key && !existing.has(raw(o.code))),
    };
  });
  const order = (s: Draft) => SEGMENT_ORDER.indexOf(s.segment);
  const out: DxSuggestion[] = [];
  for (const d of (superiorCervicalOnly(drafts) as Draft[]).sort(
    (a, b) => order(a) - order(b) || a.acc.ruleOrder - b.acc.ruleOrder || a.acc.levelOrder - b.acc.levelOrder,
  )) {
    const { acc: a, ...suggestion } = d;
    if (existing.has(a.key)) continue;
    // Already on the patient in another form of the same finding → skip, unless
    // this is the combination code the notes support (e.g. M51.16 over M51.26).
    const relatedOnPatient = [...a.related].filter((r) => r !== a.key && existing.has(r));
    if (relatedOnPatient.length && !a.support) continue;
    const notes = [...a.notes];
    if (relatedOnPatient.length) notes.push(`Would replace ${relatedOnPatient.map(dotted).join(", ")} on the patient.`);
    out.push({ ...suggestion, note: notes.join(" ") || undefined });
  }
  return out;
}

/**
 * ICD-10-CM M50: "Code to the most superior level of disorder." Within each
 * M50 subcategory (M50.0 myelopathy, M50.1 radiculopathy, M50.2 displacement,
 * M50.3 degeneration) keep only the highest level; the others' MRI lines are
 * kept on it. The "unspecified cervical region" code goes when a level is known.
 */
function superiorCervicalOnly<T extends DxSuggestion>(list: T[]): T[] {
  const rank = (code: string): number => {
    const r = raw(code); // M5021, M50222, M5023, M5020
    if (r.length === 6) return 2 + Number(r[5]) / 10; // mid-cervical C4-C5 / C5-C6 / C6-C7
    const fifth = r[4];
    return fifth === "1" ? 1 : fifth === "3" ? 3 : 9; // high, cervicothoracic, unspecified
  };
  const keep = new Set<T>(list);
  for (const sub of ["0", "1", "2", "3"]) {
    const group = list.filter((s) => raw(s.code).startsWith(`M50${sub}`));
    if (group.length < 2) continue;
    const best = group.reduce((a, b) => (rank(b.code) < rank(a.code) ? b : a));
    for (const s of group) {
      if (s === best) continue;
      keep.delete(s);
      for (const e of s.evidence) if (!best.evidence.some((x) => x.text === e.text)) best.evidence.push(e);
      for (const l of s.labels) if (!best.labels.includes(l)) best.labels.push(l);
    }
  }
  return list.filter((s) => keep.has(s));
}

function dotted(code: string): string {
  const r = raw(code);
  return r.length > 3 ? `${r.slice(0, 3)}.${r.slice(3)}` : r;
}

// ---------------------------------------------------------------------------
// From the patient page's (privacy-filtered) G.O.A.T. snapshot
// ---------------------------------------------------------------------------

/**
 * Build the input from a GoatContext. Hidden sections are already null there,
 * so they are never read: notes (Case notes hidden), SOAP (Encounters access),
 * uploaded files (Patient Files hidden).
 */
export function dxInputFromGoat(
  ctx: Pick<GoatContext, "imaging" | "mriFindings" | "notes" | "encounters" | "specialists" | "specialistRecommendations" | "files">,
  library: DxSuggestInput["library"],
  existing: DxSuggestInput["existing"],
): DxSuggestInput {
  const imaging: DxSourceText[] = [];
  for (const i of ctx.imaging) {
    if (i.refused || /x-?ray/i.test(i.modality) || !i.findings.trim()) continue;
    imaging.push({ text: i.findings, source: `${i.modality || "MRI"} findings${i.center ? ` · ${i.center}` : ""} (Imaging panel)`, regions: i.regions });
  }
  if (ctx.mriFindings.trim() && !ctx.imaging.some((i) => i.findings.trim() === ctx.mriFindings.trim())) {
    imaging.push({ text: ctx.mriFindings, source: "MRI / CT findings (Imaging panel)" });
  }
  const clinical: DxSourceText[] = [];
  if (ctx.notes) clinical.push({ text: ctx.notes, source: "Case notes" });
  for (const e of ctx.encounters ?? []) {
    clinical.push({ text: e.soap.subjective, source: `SOAP ${e.date} · S` });
    clinical.push({ text: e.soap.objective, source: `SOAP ${e.date} · O` });
    clinical.push({ text: e.soap.assessment, source: `SOAP ${e.date} · A` });
  }
  for (const s of ctx.specialists) if (s.recommendations.trim()) clinical.push({ text: s.recommendations, source: s.name ? `Specialist · ${s.name}` : "Specialist" });
  if (ctx.specialistRecommendations.trim()) clinical.push({ text: ctx.specialistRecommendations, source: "Specialist recommendations" });
  // Doctors' reports that aren't imaging (e.g. pain management) can document radiculopathy.
  for (const f of ctx.files ?? []) {
    if (f.status !== "read" || !f.pages?.length || isImagingReport(f, ["MRI", "CT", "X-Ray"])) continue;
    f.pages.forEach((p, i) => clinical.push({ text: p, source: `${f.name} (p. ${i + 1})` }));
  }
  return { imaging, files: ctx.files ?? null, clinical, library, existing };
}
