/**
 * G.O.A.T. — body regions in imaging findings and reports (pure, no I/O).
 *
 * Findings are usually written one section per region, the way the
 * findings template lays them out ("Cervical:", "Lumbar:", "Left Knee:"),
 * often with numbered levels ("1. C2-3: …"). This splits that text into
 * complete region sections so G.O.A.T. can show exactly the part a question
 * asks about ("lumbar MRI", "L5-S1"), in full, without cutting anything.
 */

import { makeMatcher, type GoatTermGroup } from "@/lib/goat-terms";

export type BodyRegion =
  | "Brain"
  | "Cervical"
  | "Thoracic"
  | "Lumbar"
  | "Sacrum"
  | "Chest"
  | "Shoulder"
  | "Humerus"
  | "Elbow"
  | "Forearm"
  | "Wrist"
  | "Hand"
  | "Hip"
  | "Femur"
  | "Knee"
  | "Tibia/Fibula"
  | "Ankle"
  | "Foot";

const REGION_WORDS: Array<[BodyRegion, string]> = [
  ["Cervical", "cervical|cervico|c[- ]?spine|c\\/s|neck"],
  ["Thoracic", "thoracic|t[- ]?spine|t\\/s|mid[- ]?back|dorsal spine"],
  ["Lumbar", "lumbar|lumbosacral|l[- ]?spine|l\\/s|low(?:er)?[- ]back"],
  ["Sacrum", "sacrum|sacral|sacroiliac|si joints?|coccyx"],
  ["Brain", "brain"],
  ["Chest", "chest"],
  ["Shoulder", "shoulders?|rotator cuff"],
  ["Humerus", "humerus"],
  ["Elbow", "elbows?"],
  ["Forearm", "forearms?"],
  ["Wrist", "wrists?"],
  ["Hand", "hands?|fingers?"],
  ["Hip", "hips?"],
  ["Femur", "femur|thigh"],
  ["Knee", "knees?"],
  ["Tibia/Fibula", "tib(?:ia)?[\\/ -]?fib(?:ula)?|tibia|fibula"],
  ["Ankle", "ankles?"],
  ["Foot", "foot|feet|toes?"],
];
const SPINE: BodyRegion[] = ["Cervical", "Thoracic", "Lumbar", "Sacrum"];
const REGION_ALT = REGION_WORDS.map(([, w]) => `(?:${w})`).join("|");
const SIDE = "(?:left|right|bilateral|lt|rt|b\\/l|bil)\\.?[\\s/]*";
const MODALITY = "(?:mri|mr|ct|x-?rays?|xr|radiographs?)";

/** Canonical region for a region word ("L-spine" → Lumbar), or null. */
export function regionOfWord(word: string): BodyRegion | null {
  for (const [region, w] of REGION_WORDS) if (new RegExp(`^(?:${w})$`, "i").test(word.trim())) return region;
  return null;
}

/** Every region named anywhere in the text (whole words). */
export function regionsNamedIn(text: string): BodyRegion[] {
  const out: BodyRegion[] = [];
  for (const [region, w] of REGION_WORDS) {
    if (new RegExp(`(?<![A-Za-z])(?:${w})(?![A-Za-z])`, "i").test(text) && !out.includes(region)) out.push(region);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spinal levels: "L4-5", "L4-L5", "L4/5", "L5-S1", "L5S1", "C7-T1"
// ---------------------------------------------------------------------------

const LEVEL_RE = /(?<![A-Za-z0-9])([CTL])\s?(\d{1,2})\s*(?:[-/–]\s*([CTLS])?\s?(\d{1,2})|([S])(1))(?![0-9])/gi;

function canonLevel(a: string, n: string, b: string | undefined, m: string): string {
  const first = a.toUpperCase();
  return `${first}${Number(n)}-${(b ?? first).toUpperCase()}${Number(m)}`;
}

/** Levels mentioned, normalised ("L4-5" → "L4-L5", "L5S1" → "L5-S1"). */
export function levelsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of (text ?? "").matchAll(LEVEL_RE)) {
    const level = m[3] !== undefined || m[4] !== undefined ? canonLevel(m[1], m[2], m[3], m[4]) : canonLevel(m[1], m[2], m[5], m[6]);
    out.add(level);
  }
  return [...out];
}

/** The spine region a level belongs to (by its upper vertebra). */
export function regionOfLevel(level: string): BodyRegion | null {
  const c = level.charAt(0).toUpperCase();
  return c === "C" ? "Cervical" : c === "T" ? "Thoracic" : c === "L" ? "Lumbar" : null;
}

function levelRegions(text: string): BodyRegion[] {
  return [...new Set(levelsIn(text).map(regionOfLevel).filter((r): r is BodyRegion => r !== null))];
}

// ---------------------------------------------------------------------------
// What the question asks about
// ---------------------------------------------------------------------------

export type Modality = "MRI" | "CT" | "X-Ray";

export interface RegionQuery {
  regions: BodyRegion[];
  levels: string[];
  modalities: Modality[];
}

/**
 * Regions, levels and imaging types in a question. Words can come straight
 * from the question or through the office's synonym groups (a group whose
 * words include "low back" makes its abbreviations mean Lumbar too).
 */
export function parseRegionQuery(question: string, asked: GoatTermGroup[]): RegionQuery {
  const levels = levelsIn(question);
  const regions = new Set<BodyRegion>(regionsNamedIn(question));
  for (const g of asked) for (const t of g.terms) for (const r of regionsNamedIn(t)) regions.add(r);
  for (const l of levels) {
    const r = regionOfLevel(l);
    if (r) regions.add(r);
  }
  const q = question.toLowerCase();
  const terms = asked.flatMap((g) => g.terms.map((t) => t.toLowerCase()));
  const has = (re: RegExp) => re.test(q) || terms.some((t) => re.test(t));
  const modalities: Modality[] = [];
  if (has(/(?<![a-z])(mri|mris|magnetic resonance)(?![a-z])/)) modalities.push("MRI");
  if (has(/(?<![a-z])(ct|cat scan|computed tomography)(?![a-z])/)) modalities.push("CT");
  if (has(/(?<![a-z])(x-?rays?|xr|radiographs?)(?![a-z])/)) modalities.push("X-Ray");
  return { regions: [...regions], levels, modalities };
}

// ---------------------------------------------------------------------------
// Readable items: wrapped lines joined, numbered items split
// ---------------------------------------------------------------------------

const NEW_ITEM = /^\s*(?:\(?\d{1,2}[.)]\s|[-•*▪●]\s|[A-Za-z][A-Za-z /&()#.-]{0,40}?\s?:\s|[CTL]\d{1,2}\s*[-/]\s*[CTLS]?\d{1,2}\b)/;

/** Join lines that were wrapped mid-sentence (PDF/pasted text) into whole sentences/items. */
export function joinWrapped(lines: string[], isHeadingLine: (line: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      !isHeadingLine(prev) &&
      !isHeadingLine(line) &&
      !NEW_ITEM.test(line) &&
      !/[.:;!?]["')\]]?$/.test(prev)
    ) {
      out[out.length - 1] = prev.endsWith("-") && /^[a-z]/.test(line) ? `${prev.slice(0, -1)}${line}` : `${prev} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

/** "1. … 2. … 3. …" on one line → one item each (only a real 1, 2, 3 sequence splits). */
export function splitNumbered(text: string): string[] {
  const re = /(^|\s)\(?(\d{1,2})[.)]\s+(?=\S)/g;
  const cuts: number[] = [];
  let expect = 0;
  for (const m of text.matchAll(re)) {
    const n = Number(m[2]);
    if ((expect === 0 && n === 1) || n === expect) {
      cuts.push((m.index ?? 0) + m[1].length);
      expect = n + 1;
    }
  }
  if (cuts.length < 2) return [text.trim()].filter(Boolean);
  const parts: string[] = [];
  if (cuts[0] > 0) parts.push(text.slice(0, cuts[0]));
  cuts.forEach((c, i) => parts.push(text.slice(c, cuts[i + 1] ?? text.length)));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Text → complete items (lines joined where wrapped, numbered items on their own). */
export function splitItems(text: string): string[] {
  return joinWrapped((text ?? "").split(/\n/)).flatMap(splitNumbered);
}

// ---------------------------------------------------------------------------
// Findings text → region sections
// ---------------------------------------------------------------------------

export interface RegionSection {
  region: BodyRegion | null;
  /** As written/normalised for display: "Lumbar", "Left Knee". */
  label: string;
  items: string[];
}

const SIDE_WORD: Record<string, string> = { left: "Left", lt: "Left", right: "Right", rt: "Right", bilateral: "Bilateral", "b/l": "Bilateral", bil: "Bilateral" };

function sideOf(text: string): string {
  const m = /^(left|right|bilateral|lt|rt|b\/l|bil)\b/i.exec(text.trim());
  return m ? SIDE_WORD[m[1].toLowerCase()] ?? "" : "";
}

/** A region heading: "Lumbar:", "Lumbar spine:", "Left Knee:", "Knee (L):", "MRI of the cervical spine:". */
const HEADING_COLON = new RegExp(
  `(${SIDE})?(?:${MODALITY}\\s+(?:of\\s+)?(?:the\\s+)?)?(${SIDE})?(${REGION_ALT})((?:\\s+spine)?(?:\\s*\\((?:l|r|bl|lt|rt|left|right|bilateral)\\))?(?:\\s+${MODALITY})?(?:\\s+(?:findings|impression))?)\\s*:`,
  "gi",
);
/** The same heading alone on its own line, without a colon. */
const HEADING_LINE = new RegExp(
  `^[ \\t]*(${SIDE})?(?:${MODALITY}\\s+(?:of\\s+)?(?:the\\s+)?)?(${SIDE})?(${REGION_ALT})(?:\\s+spine)?(?:\\s*\\((?:l|r|bl|lt|rt|left|right|bilateral)\\))?(?:\\s+${MODALITY})?[ \\t]*$`,
  "gim",
);

interface Head {
  start: number;
  end: number;
  region: BodyRegion;
  label: string;
}

function findHeads(t: string): Head[] {
  const heads: Head[] = [];
  const add = (start: number, end: number, sideA: string | undefined, sideB: string | undefined, word: string, paren?: string) => {
    const region = regionOfWord(word.replace(/\s+spine$/i, ""));
    if (!region) return;
    let side = sideOf(sideA ?? "") || sideOf(sideB ?? "");
    const p = /\((l|r|bl|lt|rt|left|right|bilateral)\)/i.exec(paren ?? "");
    if (!side && p) side = { l: "Left", lt: "Left", left: "Left", r: "Right", rt: "Right", right: "Right", bl: "Bilateral", bilateral: "Bilateral" }[p[1].toLowerCase()] ?? "";
    heads.push({ start, end, region, label: side && !SPINE.includes(region) ? `${side} ${region}` : region });
  };
  for (const m of t.matchAll(HEADING_COLON)) {
    const start = m.index ?? 0;
    // Must start a line or follow a sentence/label end — not "… of the lumbar: …" mid-sentence.
    const before = t.slice(0, start).replace(/[ \t]+$/, "");
    if (before && !/[\n.;:)]$/.test(before)) continue;
    add(start, start + m[0].length, m[1], m[2], m[3], m[4]);
  }
  for (const m of t.matchAll(HEADING_LINE)) {
    const start = m.index ?? 0;
    if (heads.some((h) => h.start <= start + 2 && h.end >= start)) continue;
    add(start, start + m[0].length, m[1], m[2], m[3]);
  }
  return heads.sort((a, b) => a.start - b.start);
}

function stripLeadLabel(text: string): string {
  return text.replace(/^\s*(?:findings|impressions?|results?|conclusions?)\s*:\s*/i, "");
}

/**
 * Split findings into region sections. Uses region headings when present;
 * otherwise assigns each item by its spinal level (C2-3 → Cervical), and
 * falls back to the record's single region. Nothing is dropped: text with
 * no region stays in a section with region null.
 */
export function splitFindings(text: string, recordRegions: string[] = []): RegionSection[] {
  const t = (text ?? "").replace(/\r/g, "").trim();
  if (!t) return [];
  const heads = findHeads(t);
  const sections: RegionSection[] = [];
  const push = (region: BodyRegion | null, label: string, body: string) => {
    const items = splitItems(stripLeadLabel(body));
    if (!items.length) return;
    const last = sections[sections.length - 1];
    if (last && last.region === region && last.label === label) last.items.push(...items);
    else sections.push({ region, label, items });
  };
  if (heads.length) {
    const pre = t.slice(0, heads[0].start);
    if (stripLeadLabel(pre).trim()) push(null, "", pre);
    heads.forEach((h, i) => push(h.region, h.label, t.slice(h.end, heads[i + 1]?.start ?? t.length)));
    return sections;
  }
  // No headings: go item by item, by level, carrying the last region forward.
  const known = recordRegions.map((r) => regionOfWord(r) ?? regionsNamedIn(r)[0]).filter((r): r is BodyRegion => Boolean(r));
  let current: BodyRegion | null = known.length === 1 ? known[0] : null;
  for (const item of splitItems(stripLeadLabel(t))) {
    const byLevel = levelRegions(item);
    const named = regionsNamedIn(item.slice(0, 40));
    if (byLevel.length === 1) current = byLevel[0];
    else if (named.length === 1 && SPINE.includes(named[0])) current = named[0];
    push(current, current ?? "", item);
  }
  return sections;
}

/**
 * The sections a question wants. Named regions → only those sections (plus
 * unlabelled items that mention the region or one of its levels). Named
 * levels → the items that mention them, with the rest of the region a click
 * away (`focus`). Nothing named → everything.
 */
export function pickSections(
  sections: RegionSection[],
  q: Pick<RegionQuery, "regions" | "levels">,
): Array<RegionSection & { focus?: number[] }> {
  if (!q.regions.length && !q.levels.length) return sections;
  const out: Array<RegionSection & { focus?: number[] }> = [];
  const levelHit = (item: string) => levelsIn(item).some((l) => q.levels.includes(l));
  for (const s of sections) {
    let items = s.items;
    if (s.region && !q.regions.includes(s.region)) continue;
    if (!s.region) {
      // Unlabelled text: keep only items that mention an asked region/level.
      items = s.items.filter(
        (it) => levelHit(it) || levelRegions(it).some((r) => q.regions.includes(r)) || regionsNamedIn(it).some((r) => q.regions.includes(r)),
      );
      if (!items.length) continue;
    }
    if (q.levels.length) {
      const focus = items.map((it, i) => (levelHit(it) ? i : -1)).filter((i) => i >= 0);
      if (!focus.length) continue;
      out.push({ ...s, items, focus: focus.length < items.length ? focus : undefined });
    } else {
      out.push({ ...s, items });
    }
  }
  return out;
}

/** Highlight terms for a level ("L4-L5" also as "L4-5", "L4/5"). */
export function levelHighlightTerms(levels: string[]): string[] {
  const out: string[] = [];
  for (const l of levels) {
    const m = /^([CTL])(\d+)-([CTLS])(\d+)$/.exec(l);
    if (!m) continue;
    out.push(l, `${m[1]}${m[2]}/${m[3]}${m[4]}`, `${m[1]}${m[2]}${m[3]}${m[4]}`);
    if (m[1] === m[3]) out.push(`${m[1]}${m[2]}-${m[4]}`, `${m[1]}${m[2]}/${m[4]}`);
  }
  return out;
}

/** True when a group of words is a body region group (e.g. the seeded lumbar group). */
export function isRegionGroup(g: GoatTermGroup): boolean {
  return g.terms.some((t) => regionsNamedIn(t).length > 0) && makeMatcher(g.terms).terms.length > 0 && g.terms.every((t) => regionsNamedIn(t).length > 0 || t.length <= 5);
}
