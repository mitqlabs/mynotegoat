/**
 * G.O.A.T. — range of motion read out of a report's text (pure, no I/O).
 *
 * Reports write ROM in many shapes:
 *   "Range of motion of the lumbar spine is 40 degrees in anterior flexion
 *    with pain, 15 degrees in extension with pain, …"
 *   "Cervical ROM: Flexion 30/50, Extension 40/60, …"
 *   "flexion is 30 degrees", "Flexion: 30°", "right lateral bending 20° (normal 25°)"
 * Each measurement is tied to its region, also when the region is named once
 * at the start of the sentence / paragraph ("Lumbar spine: … flexion 40°").
 * Values are copied as written; nothing is estimated.
 */

import { regionsNamedIn, type BodyRegion } from "@/lib/goat-regions";

export interface RomMeasure {
  /** Movement as written, lower-case ("anterior flexion", "right lateral rotation").
   *  Empty for a whole-region finding ("Range of motion within normal limits"). */
  movement: string;
  /** Degrees when the report gives a number. */
  degrees?: number;
  /** A finding in words when there's no number: "Reduced", "Mildly reduced",
   *  "Full", "Normal", "Within normal limits". */
  quality?: string;
  /** Normal / expected value when the report gives one ("30/50", "normal 50"). */
  normal?: number;
  pain?: "with pain" | "without pain" | "pain-limited";
  /** Region named inside the finding itself ("reduced lumbar extension"). */
  regionWord?: string;
}

export interface RomRegion {
  /** "Cervical", "Lumbar", "Left Shoulder", … or "" when the text never says. */
  region: string;
  /** Canonical body region for filtering (null when unknown). */
  body: BodyRegion | null;
  measures: RomMeasure[];
  /** The sentence(s) the values came from (for the citation / highlighting). */
  quotes: string[];
}

const SIDE = "(?:left|right|lt\\.?|rt\\.?|bilateral|b\\/l)";
const MOVE_CORE =
  "(?:(?:anterior|forward|posterior|backward)\\s+)?(?:(?:lateral|side)[\\s-]+)?(?:flexion|extension|rotation|bending|side[\\s-]?bending|abduction|adduction|(?:internal|external)\\s+rotation|tilt)";
// "left lateral rotation", "lateral flexion to the left", "rotation left"
const MOVEMENT = `(?:${SIDE}\\s+)?${MOVE_CORE}(?:\\s+(?:to\\s+the\\s+)?${SIDE}(?![a-z]))?`;
const DEG = "(?:\\s*(?:°|º|˚|degrees?|degs?\\.?|deg\\.?))";
const NUM = "(\\d{1,3}(?:\\.\\d)?)";

// "40 degrees in anterior flexion", "25 degrees of left lateral rotation", "60° in the right lateral rotation"
const VALUE_FIRST = new RegExp(`${NUM}${DEG}\\s+(?:of|in|on|with|for|into)?\\s*(?:the\\s+)?(${MOVEMENT})(?![a-z])`, "gi");
// "flexion is 30 degrees", "Flexion: 30°", "Flexion 30/50", "extension limited to 20 degrees"
const MOVEMENT_FIRST = new RegExp(
  `(?<![a-z])(${MOVEMENT})\\s*(?:is|was|of|to|at|measures?|measured|=|:|-|–)?\\s*(?:(?:limited|restricted|reduced|decreased)\\s+(?:to\\s+)?|approximately\\s+|approx\\.?\\s+|about\\s+|only\\s+)?${NUM}(${DEG})?(?:\\s*\\/\\s*(\\d{1,3})${DEG}?)?`,
  "gi",
);
const NORMAL_AFTER = /^\s*,?\s*\(?\s*(?:normal|nl|wnl|norm)\.?\s*(?:is|=|:|of)?\s*(\d{1,3})\s*(?:°|º|degrees?)?\s*\)?/i;
const PAIN = /\b(without pain|with no pain|pain[- ]free|painless|non[- ]?painful|pain[- ]limited|limited by pain|with pain|painful|with discomfort)\b/i;
// Words-only findings: "reduced", "mildly decreased", "full", "WNL" …
const QUAL_WORD =
  "(?:(?:mildly|moderately|markedly|severely|slightly|significantly)\\s+)?(?:reduced|decreased|diminished|limited|restricted|full|normal|intact|wnl|within\\s+normal\\s+limits)";

// Where a region starts a ROM statement:
//  "range of motion of the (left) lumbar spine", "lumbar spine range of motion",
//  "Cervical ROM", "Lumbar spine:", "LEFT SHOULDER:".
const REGION_WORD =
  "(?:cervical|c[- ]?spine|thoracic|t[- ]?spine|thoracolumbar|lumbar|lumbosacral|l[- ]?spine|neck|low(?:er)?\\s+back|shoulders?|elbows?|wrists?|hips?|knees?|ankles?|(?:upper\\s+|lower\\s+)?extremit(?:y|ies))";
// A region word used inside a finding ("reduced lumbar extension").
const INLINE_REGION = "(?:cervical|thoracic|lumbar|lumbosacral|neck|shoulder|elbow|wrist|hip|knee|ankle)";
const SEP = "(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*|\\s*\\/\\s*)";
const MOVE_LIST = `${MOVEMENT}(?:${SEP}${MOVEMENT})*`;
// "flexion and abduction to 140°" — one value shared by several movements.
const SHARED_VALUE = new RegExp(
  `(?<![a-z])(${MOVEMENT}(?:${SEP}${MOVEMENT})+)\\s*(?:is|are|was|were|of|to|at|:|-|–)?\\s*(?:(?:limited|restricted|reduced|decreased)\\s+)?(?:to\\s+)?(?:approximately\\s+|about\\s+)?${NUM}(${DEG})`,
  "gi",
);
// "reduced anterior flexion", "reduced lumbar extension", "full flexion and extension"
const QUAL_BEFORE = new RegExp(
  `(?<![a-z])(${QUAL_WORD})\\s+(?:(?:and\\s+)?painful\\s+)?(?:(${INLINE_REGION})\\s+)?(${MOVE_LIST})(?![a-z])`,
  "gi",
);
// "flexion is reduced", "extension was mildly limited"
const QUAL_AFTER = new RegExp(`(?<![a-z])(${MOVE_LIST})\\s+(?:(?:is|are|was|were|appears?)\\s+)?(${QUAL_WORD})(?![a-z])`, "gi");
// Any region named in a stretch ("The right knee has full range of motion").
const ANY_REGION = new RegExp(`(?<![a-z])((?:${SIDE}\\s+)?${REGION_WORD})(?![a-z])`, "i");
// Whole region: "Range of motion (is|in) within normal limits", "full range of motion", "ROM WNL"
const REGION_LEVEL = new RegExp(
  `(?:(?:range\\s+of\\s+motion|rom)\\s+(?:is\\s+|in\\s+|was\\s+|are\\s+|:\\s*)?(?:grossly\\s+|essentially\\s+)?(${QUAL_WORD})|(?<![a-z])(${QUAL_WORD})\\s+(?:active\\s+(?:and\\s+passive\\s+)?)?(?:range\\s+of\\s+motion|rom))(?![a-z])`,
  "gi",
);
const REGION_START = new RegExp(
  [
    `(?:range\\s+of\\s+motion|rom)\\s+(?:of|for|in|at)\\s+(?:the\\s+)?(?:patient'?s\\s+)?((?:${SIDE}\\s+)?${REGION_WORD})`,
    `(?<![a-z])((?:${SIDE}\\s+)?${REGION_WORD})(?:\\s+spine)?\\s+(?:range\\s+of\\s+motion|rom|motion)`,
    `(?:^|[.;]\\s+|\\n)((?:${SIDE}\\s+)?${REGION_WORD})(?:\\s+spine)?\\s*[:-]`,
  ].join("|"),
  "gi",
);

function cleanMovement(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\blt\.?(?=\s|$)/g, "left")
    .replace(/\brt\.?(?=\s|$)/g, "right")
    .trim();
}

function sideOf(raw: string): string {
  const m = /^(left|right|lt\.?|rt\.?|bilateral|b\/l)\b/i.exec(raw.trim());
  if (!m) return "";
  const s = m[1].toLowerCase();
  return s.startsWith("l") ? "Left" : s.startsWith("r") ? "Right" : "Bilateral";
}

/** "left shoulder" → { label: "Left Shoulder", body: "Shoulder" }; "neck" → Cervical. */
export function romRegionLabel(raw: string): { label: string; body: BodyRegion | null } {
  const body = /thoracolumbar/i.test(raw) ? "Lumbar" : (regionsNamedIn(raw)[0] ?? null);
  if (!body) {
    // "Extremity: Range of motion …" — shown when no region is asked for.
    const ext = /(upper|lower)?\s*extremit(?:y|ies)/i.exec(raw);
    if (ext) return { label: ext[1] ? `${ext[1][0].toUpperCase()}${ext[1].slice(1).toLowerCase()} Extremity` : "Extremity", body: null };
    return { label: "", body: null };
  }
  const side = ["Cervical", "Thoracic", "Lumbar", "Sacrum"].includes(body) ? "" : sideOf(raw);
  return { label: side ? `${side} ${body}` : body, body };
}

function painIn(text: string): RomMeasure["pain"] | undefined {
  const m = PAIN.exec(text);
  if (!m) return undefined;
  if (/limited/i.test(m[1])) return "pain-limited";
  return /without|no pain|free|painless|non/i.test(m[1]) ? "without pain" : "with pain";
}

/** "WNL" → "Within normal limits", "mildly reduced" → "Mildly reduced". */
function cleanQuality(raw: string): string {
  const q = raw.replace(/\s+/g, " ").trim().toLowerCase();
  const v = q === "wnl" ? "within normal limits" : q;
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/** "flexion and abduction" → ["flexion", "abduction"]. */
function splitMovements(list: string): string[] {
  return [...list.matchAll(new RegExp(MOVEMENT, "gi"))].map((m) => cleanMovement(m[0]));
}

/** Every measurement in one stretch of text, in the order written. */
export function romMeasuresIn(text: string): RomMeasure[] {
  type Hit = { start: number; end: number; m: RomMeasure };
  const hits: Hit[] = [];
  const overlaps = (s: number, e: number) => hits.some((h) => s < h.end && e > h.start);
  // One value for several movements first ("flexion and abduction to 140°").
  SHARED_VALUE.lastIndex = 0;
  for (let m = SHARED_VALUE.exec(text); m; m = SHARED_VALUE.exec(text)) {
    const at = m.index;
    const end = at + m[0].length;
    for (const movement of splitMovements(m[1])) hits.push({ start: at, end, m: { movement, degrees: Number(m[2]) } });
  }
  VALUE_FIRST.lastIndex = 0;
  for (let m = VALUE_FIRST.exec(text); m; m = VALUE_FIRST.exec(text)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    hits.push({ start: m.index, end: m.index + m[0].length, m: { movement: cleanMovement(m[2]), degrees: Number(m[1]) } });
  }
  MOVEMENT_FIRST.lastIndex = 0;
  for (let m = MOVEMENT_FIRST.exec(text); m; m = MOVEMENT_FIRST.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (overlaps(start, end)) continue;
    // A bare number right after a movement needs a degree sign, a "/normal",
    // a ":" or a table-ish layout — "flexion 2 times" isn't a measurement.
    const hasDeg = Boolean(m[3]) || Boolean(m[4]) || /[:=]\s*\d/.test(m[0]) || /\b(is|was|to|measures?|measured)\s+/i.test(m[0]);
    if (!hasDeg && !/^\s*(?:\(?\s*(?:normal|nl)|[,;/]|\s+[A-Za-z]+\s+\d|$)/i.test(text.slice(end, end + 20))) continue;
    hits.push({ start, end, m: { movement: cleanMovement(m[1]), degrees: Number(m[2]), ...(m[4] ? { normal: Number(m[4]) } : {}) } });
  }
  // Findings in words, no number: "reduced anterior flexion", "flexion is reduced".
  const numberSoon = (end: number) => /^\s*(?:to|of|at|is|was|:)?\s*(?:approximately\s+)?\d{1,3}\s*(?:°|º|˚|deg)/i.test(text.slice(end, end + 24));
  QUAL_BEFORE.lastIndex = 0;
  for (let m = QUAL_BEFORE.exec(text); m; m = QUAL_BEFORE.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (overlaps(start, end) || numberSoon(end)) continue;
    const quality = cleanQuality(m[1]);
    const prefixPain = /painful/i.test(m[0]) ? ("with pain" as const) : undefined;
    for (const movement of splitMovements(m[3])) {
      hits.push({ start, end, m: { movement, quality, ...(prefixPain ? { pain: prefixPain } : {}), ...(m[2] ? { regionWord: m[2].toLowerCase() } : {}) } });
    }
  }
  QUAL_AFTER.lastIndex = 0;
  for (let m = QUAL_AFTER.exec(text); m; m = QUAL_AFTER.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (overlaps(start, end) || numberSoon(end)) continue;
    const quality = cleanQuality(m[2]);
    for (const movement of splitMovements(m[1])) hits.push({ start, end, m: { movement, quality } });
  }
  // Whole region in words ("Range of motion within normal limits") when nothing finer is given.
  if (!hits.length) {
    REGION_LEVEL.lastIndex = 0;
    const m = REGION_LEVEL.exec(text);
    if (m) hits.push({ start: m.index, end: m.index + m[0].length, m: { movement: "", quality: cleanQuality(m[1] ?? m[2]) } });
  }
  hits.sort((a, b) => a.start - b.start);
  // Pain / normal notes belong to the stretch up to the next measurement or clause end;
  // "pain-limited flexion …" puts the note in front.
  hits.forEach((h, i) => {
    const prevEnd = hits.slice(0, i).filter((x) => x.start < h.start).reduce((e, x) => Math.max(e, x.end), 0);
    const lead = text.slice(Math.max(prevEnd, h.start - 20), h.start);
    if (!h.m.pain && /pain[- ]limited\s*$/i.test(lead)) h.m.pain = "pain-limited";
    if (hits[i + 1] && hits[i + 1].start === h.start) return; // shared value: notes go on the last one
    const next = hits.slice(i + 1).find((x) => x.start > h.start)?.start ?? text.length;
    let tail = text.slice(h.end, next);
    const cut = tail.search(/[;.](?:\s|$)/);
    if (cut >= 0) tail = tail.slice(0, cut);
    const normal = NORMAL_AFTER.exec(tail);
    if (normal && h.m.normal === undefined) h.m.normal = Number(normal[1]);
    const pain = painIn(tail);
    if (pain) h.m.pain = pain;
  });
  // Movements sharing one value (or one "reduced …" phrase) share its notes.
  for (const h of hits) {
    const group = hits.filter((x) => x.start === h.start);
    const pain = group.map((x) => x.m.pain).find(Boolean);
    const normal = group.map((x) => x.m.normal).find((n) => n !== undefined);
    for (const x of group) {
      if (pain && !x.m.pain) x.m.pain = pain;
      if (normal !== undefined && x.m.normal === undefined) x.m.normal = normal;
    }
  }
  return hits.filter((h) => h.m.degrees === undefined || h.m.degrees <= 360).map((h) => h.m);
}

/**
 * ROM readings by region for a sequence of text units (sentences / lines in
 * reading order). `contextRegion` is the region a unit already sits under
 * (e.g. from a "Lumbar spine:" heading above it), used when the unit itself
 * doesn't say.
 */
export function extractRom(units: Array<{ text: string; contextRegion?: string | null; heading?: boolean }>): RomRegion[] {
  const out: RomRegion[] = [];
  const get = (label: string, body: BodyRegion | null) => {
    let r = out.find((x) => x.region === label);
    if (!r) {
      r = { region: label, body, measures: [], quotes: [] };
      out.push(r);
    }
    return r;
  };
  let carried: { label: string; body: BodyRegion | null } | null = null;
  for (const unit of units) {
    const text = (unit.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    // Region statements inside the unit split it into stretches.
    const starts: Array<{ at: number; label: string; body: BodyRegion | null }> = [];
    REGION_START.lastIndex = 0;
    for (let m = REGION_START.exec(text); m; m = REGION_START.exec(text)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? "";
      const r = romRegionLabel(raw);
      if (r.label) starts.push({ at: m.index, ...r });
    }
    // A new heading ("PLAN:", "IMPRESSION") ends the region a list was under.
    if (unit.heading && !starts.length) carried = null;
    const context = unit.contextRegion ? romRegionLabel(unit.contextRegion) : null;
    const lead = starts[0]?.at ?? text.length;
    const stretches: Array<{ text: string; region: { label: string; body: BodyRegion | null } | null }> = [];
    if (lead > 0) stretches.push({ text: text.slice(0, lead), region: carried ?? (context?.label ? context : null) });
    starts.forEach((s, i) => stretches.push({ text: text.slice(s.at, starts[i + 1]?.at ?? text.length), region: s }));
    for (const s of stretches) {
      const measures = romMeasuresIn(s.text);
      if (s.region && starts.includes(s.region as (typeof starts)[number])) carried = s.region;
      if (!measures.length) continue;
      // A region named as the subject ("The right knee has full range of
      // motion") wins over the heading context; one named later in passing
      // ("… radiating to the left shoulder") doesn't.
      const named = s.region ? null : ANY_REGION.exec(s.text);
      const namedRegion = named ? romRegionLabel(named[1]) : null;
      const firstMove = s.text.search(/range of motion|\brom\b|flexion|extension|rotation|bending|abduction|adduction/i);
      const subject = named && namedRegion?.label && (firstMove < 0 || named.index < firstMove) ? namedRegion : null;
      const ctx = context?.label ? context : null;
      const region = s.region ?? subject ?? ctx ?? (namedRegion?.label ? namedRegion : null);
      for (const m of measures) {
        // "reduced cervical extension" names its own region.
        const own = m.regionWord ? romRegionLabel(m.regionWord) : null;
        const r = own?.label && (!region || own.body !== region.body) ? own : region;
        const bucket = get(r?.label ?? "", r?.body ?? null);
        const { regionWord: _rw, ...clean } = m;
        void _rw;
        if (!bucket.measures.some((x) => x.movement === clean.movement && x.degrees === clean.degrees && x.quality === clean.quality)) {
          bucket.measures.push(clean);
        }
        if (!bucket.quotes.includes(text)) bucket.quotes.push(text);
      }
    }
    // A sentence ends a region statement unless the next unit carries on the list.
    if (/[.!?]$/.test(text) && !/:$/.test(text)) carried = starts.length ? carried : null;
  }
  return out.filter((r) => r.measures.length);
}

/**
 * "30° anterior flexion (with pain)" — value first, movement as written.
 * No number: "Reduced anterior flexion (with pain)", "Flexion within normal
 * limits", or the whole region: "Within normal limits".
 */
export function formatRomMeasure(m: RomMeasure): string {
  const extras = [m.normal !== undefined ? `normal ${m.normal}°` : "", m.pain ?? ""].filter(Boolean);
  const note = extras.length ? ` (${extras.join(", ")})` : "";
  if (m.degrees !== undefined) return `${m.degrees}° ${m.movement}${note}`;
  const q = m.quality ?? "";
  if (!m.movement) return `${q}${note}`;
  if (/^within normal limits$/i.test(q)) return `${m.movement.charAt(0).toUpperCase()}${m.movement.slice(1)} within normal limits${note}`;
  return `${q} ${m.movement}${note}`;
}

/** Block heading for a region: "Cervical ROM", "Left Shoulder ROM", "ROM". */
export function romHeading(r: RomRegion): string {
  return r.region ? `${r.region} ROM` : "ROM";
}
