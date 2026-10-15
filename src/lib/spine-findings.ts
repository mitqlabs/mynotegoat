/**
 * Spine imaging impressions → structured, readable findings (rules only, no AI).
 *
 * "3 MM LEFT PARACENTRAL C5-6 & C6-7 DISC HERNIATIONS STENOSING THE SPINAL
 * CANAL, COMPRESSING; THE CERVICAL CORD …" becomes
 *   Cervical
 *     C5-6: 3 mm left paracentral disc herniation — spinal canal stenosis, cord compression
 *     C6-7: 3 mm left paracentral disc herniation — spinal canal stenosis, cord compression
 * Shared levels are expanded, levels normalized (C5-C6, C5/6 → C5-6), sizes,
 * sides, finding types and effects pulled out; level-less findings go under
 * "General"; boilerplate ("correlation … recommended") is dropped.
 * Works for MRI, CT and X-ray wording. Pure; used by G.O.A.T. answers.
 */

export type SpineRegion = "Cervical" | "Thoracic" | "Lumbar";
const REGION_ORDER: SpineRegion[] = ["Cervical", "Thoracic", "Lumbar"];

export interface SpineFinding {
  sizeMm: number | null;
  /** The report had "MM" with the number cut off. */
  sizeCut: boolean;
  sides: string[];
  type: string;
  effects: string[];
}
export interface SpineLevel {
  level: string; // "C5-6", "L5-S1", "T12-L1"
  region: SpineRegion;
  findings: SpineFinding[];
}
export interface SpineFindings {
  levels: SpineLevel[];
  general: string[];
  dropped: string[];
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

const SEG = "[CTLS]";
/** One level: C5-6, C5-C6, C5/6, C5 6, L5-S1, T12-L1, C56 (no separator only for 2 single digits). */
const LEVEL_RE = new RegExp(`\\b(${SEG})\\s?(\\d{1,2})\\s*(?:-|–|/|\\s)\\s*(?:(${SEG})\\s?)?(\\d{1,2})\\b|\\b([CTL])(\\d)(\\d)\\b`, "gi");

function regionOf(seg: string): SpineRegion {
  const s = seg.toUpperCase();
  return s === "C" ? "Cervical" : s === "T" ? "Thoracic" : "Lumbar";
}
function next(seg: string, n: number): [string, number] {
  const s = seg.toUpperCase();
  if (s === "C" && n === 7) return ["T", 1];
  if (s === "T" && n === 12) return ["L", 1];
  if (s === "L" && n === 5) return ["S", 1];
  return [s, n + 1];
}
function fmtLevel(a: string, an: number, b: string, bn: number): string {
  return a === b ? `${a}${an}-${bn}` : `${a}${an}-${b}${bn}`;
}
/** Normalize a level string; null when it isn't a real adjacent level. */
export function normalizeLevel(raw: string): string | null {
  LEVEL_RE.lastIndex = 0;
  const m = LEVEL_RE.exec(raw);
  LEVEL_RE.lastIndex = 0;
  if (!m) return null;
  const parsed = levelFromMatch(m);
  return parsed?.label ?? null;
}
function levelFromMatch(m: RegExpExecArray): { label: string; seg: string; n: number } | null {
  let a: string, an: number, b: string, bn: number;
  if (m[5]) {
    a = m[5].toUpperCase(); an = +m[6]; [b, bn] = [a, +m[7]];
  } else {
    a = m[1].toUpperCase(); an = +m[2]; b = (m[3] || m[1]).toUpperCase(); bn = +m[4];
  }
  if (a === "S") return null;
  const [eb, ebn] = next(a, an);
  if (eb !== b || ebn !== bn) return null; // not adjacent (e.g. a date or "T2 signal")
  return { label: fmtLevel(a, an, b, bn), seg: a, n: an };
}
/** Every level named in a text, with ranges ("C4-5 through C6-7") filled in. */
export function levelsInText(text: string): string[] {
  const out: string[] = [];
  const found: Array<{ label: string; seg: string; n: number; index: number; end: number }> = [];
  LEVEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LEVEL_RE.exec(text))) {
    const l = levelFromMatch(m);
    if (l) found.push({ ...l, index: m.index, end: m.index + m[0].length });
  }
  LEVEL_RE.lastIndex = 0;
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    if (!out.includes(f.label)) out.push(f.label);
    const g = found[i + 1];
    if (g && /^\s*(?:through|thru|to|–|-)\s*$/i.test(text.slice(f.end, g.index))) {
      let [s, n] = next(f.seg, f.n);
      for (let guard = 0; guard < 25 && !(s === g.seg && n === g.n); guard++) {
        const [s2, n2] = next(s, n);
        const lab = fmtLevel(s, n, s2, n2);
        if (!out.includes(lab)) out.push(lab);
        [s, n] = [s2, n2];
      }
    }
  }
  return out;
}
function levelSortKey(level: string): number {
  const m = /^([CTL])(\d+)/.exec(level)!;
  return REGION_ORDER.indexOf(regionOf(m[1])) * 100 + +m[2];
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const TYPES: Array<[RegExp, string]> = [
  [/\bdis[ck][\s-]*osteophyte complex\w*/i, "disc-osteophyte complex"],
  [/\bsequest\w*/i, "disc sequestration"],
  [/\bextru\w*/i, "disc extrusion"],
  [/\bherniat\w*|\bhnp\b/i, "disc herniation"],
  [/\bprotru\w*/i, "disc protrusion"],
  [/\bbulg\w*/i, "disc bulge"],
  [/\bannul[ae]r (?:tear|fissure)s?|\bhigh[- ]intensity zone\b/i, "annular tear"],
  [/\b(?:antero|retro)?listhesis\b|\bspondylolisthesis\b/i, "spondylolisthesis"],
  [/\bspondylolysis\b|\bpars defect\w*/i, "spondylolysis"],
  [/\bfacet (?:joint )?(?:hypertroph\w*|arthropath\w*|arthrosis|osteoarthritis|degenerat\w*)/i, "facet hypertrophy"],
  [/\bligament(?:um)? flavum (?:hypertroph\w*|thicken\w*|buckl\w*)/i, "ligamentum flavum hypertrophy"],
  [/\buncovertebral (?:joint )?(?:hypertroph\w*|arthrosis|spurring)/i, "uncovertebral hypertrophy"],
  [/\bdis[ck] space narrowing|\bloss of (?:the )?dis[ck] (?:space )?height|\bdecreased dis[ck] height/i, "disc space narrowing"],
  [/\bdesiccat\w*/i, "disc desiccation"],
  [/\bmodic (?:type )?(i{1,3}|[123])\b[^,;.]*/i, "Modic"],
  [/\bfracture\w*/i, "fracture"],
  [/\b(?:spinal |central )?canal stenosis\b|\bspinal stenosis\b|\bstenosing the (?:spinal |central )?canal\b|\bcentral stenosis\b/i, "spinal canal stenosis"],
  [/\b(?:neuro)?foramin\w* (?:stenosis|narrowing|encroachment)\b/i, "neuroforaminal narrowing"],
  [/\bosteophyt\w*|\bspur(?:s|ring)?\b/i, "osteophytes"],
  [/\bdegenerat\w*|\bspondylosis\b/i, "degeneration"],
];

const SIDE_WORDS: Array<[RegExp, string]> = [
  [/\bbroad[- ]based\b/i, "broad-based"],
  [/\bcircumferential\b/i, "circumferential"],
  [/\bbilateral\b/i, "bilateral"],
  [/\bleft\b(?!\s*(?:>|greater))/i, "left"],
  [/\bright\b(?!\s*(?:>|greater))/i, "right"],
  [/\bfar[- ]lateral\b/i, "far lateral"],
  [/\bposterior\b/i, "posterior"],
  [/\bparacentral\b/i, "paracentral"],
  [/\bcentral\b(?!\s*canal)/i, "central"],
  [/\bsubarticular\b/i, "subarticular"],
  [/\bforaminal\b(?!\s*(?:stenosis|narrowing))/i, "foraminal"],
];

const BOILERPLATE = /\b(correlat\w*|clinical(?:ly)? (?:correlation|significance)|recommend\w*|suggest(?:ed)? follow|follow[- ]up|consider\w* (?:further|additional)|if clinically indicated|electronically signed|dictated by|transcribed|thank you for (?:the|this) referral|please (?:note|see)|comparison:? none|no prior (?:studies|exams?))\b/i;
const EFFECT_START = /^(?:the\s+)?(compress\w*|effac\w*|encroach\w*|stenos\w*|abut\w*|narrow\w*|indent\w*|contact\w*|displac\w*|imping\w*|flatten\w*|deform\w*|with\b|resulting|causing|which|that|and\s+(?:compress|effac|encroach|abut|narrow|indent|contact|imping))/i;

function sideRatio(t: string): string {
  const m = /\b(left|right)\s*(?:>|greater than|more than)\s*(left|right)\b/i.exec(t);
  return m ? `${m[1][0].toUpperCase()}>${m[2][0].toUpperCase()}` : "";
}
const SEVERITY = /\b(mild(?:ly)?|moderate(?:ly)?|severe(?:ly)?|marked(?:ly)?|minimal(?:ly)?|significant(?:ly)?)\b/i;
function sev(t: string): string {
  const m = SEVERITY.exec(t);
  return m ? m[1].toLowerCase().replace(/ly$/, "").replace(/^significant$/, "significant") + " " : "";
}

function effectsOf(t: string): string[] {
  const out: string[] = [];
  const add = (x: string) => { if (!out.includes(x)) out.push(x); };
  if (/\bcompress\w*[^.;]{0,40}\bcord\b|\bcord compression\b/i.test(t)) add("cord compression");
  else if (/\b(flatten|deform|indent|abut|contact)\w*[^.;]{0,30}\bcord\b/i.test(t)) add("cord contact");
  if (/\bstenos\w*[^.;]{0,25}\b(spinal |central )?canal\b|\bcanal stenosis\b|\bspinal stenosis\b/i.test(t)) {
    const m = /([^.;,]{0,25})\b(stenos\w*[^.;,]{0,25}canal|canal stenosis|spinal stenosis)/i.exec(t);
    add(`${sev((m?.[1] ?? "").split(/\band\b|,/i).pop() ?? "")}spinal canal stenosis`.trim());
  }
  if (/\b(effac|indent|abut|contact|compress|deform|impress)\w*[^.;]{0,30}\bthecal sac\b|\bthecal sac (effacement|indentation)\b/i.test(t)) {
    const verb = /\b(effac|indent|abut|contact|compress|deform|impress)\w*/i.exec(t.slice(0, t.search(/thecal sac/i) + 1) || t)?.[1].toLowerCase() ?? "effac";
    add(`thecal sac ${({ effac: "effacement", indent: "indentation", abut: "abutment", contact: "contact", compress: "compression", deform: "deformity", impress: "impression" } as Record<string, string>)[verb]}`);
  }
  if (/\b(neuro)?foram\w*/i.test(t) && /\b(encroach|narrow|stenos|compromis|effac)\w*/i.test(t)) {
    const r = sideRatio(t);
    const near = /([^.;,]{0,40}?)\b(?:neural\s+)?(?:neuro)?foramin\w*\s+(?:stenosis|narrowing|encroachment|compromise)/i.exec(t) ?? /(encroach\w*[^.;,]{0,30}?)\b(?:neuro)?foram/i.exec(t) ?? /([^.;,]{0,40}?)\b(?:neuro)?foram/i.exec(t);
    const m = near ? [near[0], near[1].split(/\band\b|,/i).pop() ?? ""] : null;
    const sides = r ? ` (${r})` : /\bbilateral\b/i.test(m?.[1] ?? "") ? " (bilateral)" : /\bleft\b/i.test(m?.[1] ?? "") ? " (left)" : /\bright\b/i.test(m?.[1] ?? "") ? " (right)" : "";
    add(`${sev(m?.[1] ?? "")}neuroforaminal narrowing${sides}`.trim());
  }
  if (/\blateral recess\b/i.test(t) && /\b(narrow|stenos|effac)\w*/i.test(t)) add("lateral recess narrowing");
  const root = /\b(abut|contact|imping|compress|displac|irritat|touch)\w*[^.;]{0,40}?\b(?:(left|right|bilateral)\s+)?(?:(traversing|exiting)\s+)?(?:([CTLS]\d)\s+)?nerve roots?\b/i.exec(t);
  if (root) add(`${[root[2], root[3], root[4]].filter(Boolean).join(" ").toLowerCase().replace(/\b([ctls]\d)\b/, (x) => x.toUpperCase())} nerve root ${({ abut: "abutment", contact: "contact", imping: "impingement", compress: "compression", displac: "displacement", irritat: "irritation", touch: "contact" } as Record<string, string>)[root[1].toLowerCase()]}`.replace(/^\s+/, ""));
  const ORDER = ["spinal canal stenosis", "cord", "thecal sac", "lateral recess", "neuroforaminal", "nerve root"];
  const rank = (e: string) => { const i = ORDER.findIndex((k) => e.includes(k)); return i < 0 ? 99 : i; };
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Extra findings named in the same clause ("desiccation with 2 mm bulges" → both). */
function findingsOf(clause: string): SpineFinding[] {
  const main = findingOf(clause);
  if (!main) return [];
  const out = [main];
  const seen = new Set([main.type.replace(/^(mild|moderate|severe|marked|minimal|significant) /, "")]);
  for (const [re, label] of TYPES) {
    if (label === "Modic" || label === "spinal canal stenosis" || label === "neuroforaminal narrowing") continue;
    const m = re.exec(clause);
    if (!m || seen.has(label) || main.type.endsWith(label)) continue;
    if (label === "osteophytes" && main.type.includes("osteophyte complex")) continue;
    // Only list secondary types separately; the main disc finding keeps size/side.
    if (/disc (herniation|protrusion|extrusion|bulge|sequestration)/.test(label) && /disc (herniation|protrusion|extrusion|bulge|sequestration)/.test(main.type)) continue;
    seen.add(label);
    const before = clause.slice(0, m.index);
    const isMain = /disc (herniation|protrusion|extrusion|bulge)/.test(label);
    if (isMain) {
      // The disc finding is the real one: it takes size/side; the earlier word becomes secondary.
      const f = findingOf(clause.slice(m.index - Math.min(m.index, 30)));
      const pri = { ...main, type: label, sides: f?.sides ?? [], sizeMm: f?.sizeMm ?? main.sizeMm };
      out[0] = pri;
      out.push({ sizeMm: null, sizeCut: false, sides: [], type: main.type, effects: [] });
      continue;
    }
    out.push({ sizeMm: null, sizeCut: false, sides: [], type: `${sev(before.split(/,|\band\b|\bwith\b/i).pop() ?? "")}${label}`.trim(), effects: [] });
  }
  return out;
}

function findingOf(clause: string): SpineFinding | null {
  const t = clause;
  let type = "";
  for (const [re, label] of TYPES) {
    const m = re.exec(t);
    if (m) {
      type = label === "Modic" ? `Modic type ${(m[1] || "").toUpperCase().replace("1", "I").replace("2", "II").replace("3", "III")} endplate changes` : label;
      break;
    }
  }
  const effects = effectsOf(t);
  if (!type && !effects.length) return null;
  // A stenosis/narrowing that is only an effect of a disc finding isn't its own type.
  if (type === "spinal canal stenosis" || type === "neuroforaminal narrowing") {
    if (effects.some((e) => e.includes(type))) type = "";
  }
  const sizeM = /(\d+(?:\.\d+)?)\s*(?:x\s*\d+(?:\.\d+)?\s*)?mm\b/i.exec(t);
  const sizeCut = !sizeM && /(^|[^\d.\s])\s*\bmm\b|^\s*mm\b/i.test(t);
  const sides: string[] = [];
  if (type && /disc|annular|osteophyte complex/.test(type)) {
    const before = t.slice(0, Math.max(0, t.search(/\b(dis[ck]|herniat|protru|extru|bulg|annul|hnp|sequest)/i))) || t;
    for (const [re, label] of SIDE_WORDS) if (re.test(before) && !sides.includes(label)) sides.push(label);
    if (sides.includes("paracentral")) { const i = sides.indexOf("central"); if (i >= 0) sides.splice(i, 1); }
    if (sides.length > 1) { const i = sides.indexOf("posterior"); if (i >= 0) sides.splice(i, 1); }
  } else if (type === "facet hypertrophy" || type === "uncovertebral hypertrophy") {
    for (const s of ["bilateral", "left", "right"]) if (new RegExp(`\\b${s}\\b`, "i").test(t)) { sides.push(s); break; }
  }
  const sv = type && !/disc (herniation|protrusion|extrusion|bulge|sequestration)|annular/.test(type) ? sev(t.slice(0, t.search(new RegExp(type.split(" ")[0], "i")) + 1)).trim() : "";
  return { sizeMm: sizeM ? +sizeM[1] : null, sizeCut, sides, type: [sv, type].filter(Boolean).join(" "), effects };
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/** Clean PDF-extraction noise: headings, numbering, odd spaces, broken semicolons. */
function clean(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[\u00a0\t]+/g, " ")
    .replace(/^\s*(impression|findings|conclusion|summary|opinion)\s*:?\s*/gim, "")
    .replace(/(^|\n)\s*(?:\d{1,2}|[a-z])[.)]\s+/gi, "$1; ")
    .replace(/\s+\d{1,2}[.)]\s+(?=[A-Z0-9])/g, "; ")
    .replace(/\.{2,}|…/g, "; ")
    .replace(/\b(Dr|Mr|Mrs|Ms|vs|approx|Fig)\.\s/gi, "$1 ")
    .replace(/\s{2,}/g, " ");
}

function splitStatements(text: string): string[] {
  const raw = clean(text).split(/;|\n|\.\s+(?=[A-Z0-9(])|\.$/).map((s) => s.replace(/^[\s,.-]+|[\s,.-]+$/g, "")).filter(Boolean);
  const out: string[] = [];
  for (const s of raw) {
    // "COMPRESSING; THE CERVICAL CORD" — a broken line, not a new finding.
    const cont = out.length && (/^(the|and|of|with|to|at|on|in|by)\b/i.test(s) || /\b(compress\w*|effac\w*|encroach\w*|abut\w*|stenosing|of|the|and|with|to)\s*$/i.test(out[out.length - 1])) && !levelsInText(s).length;
    if (cont) out[out.length - 1] += ` ${s}`;
    else out.push(s);
  }
  return out;
}

function hasType(s: string): boolean {
  return TYPES.some(([re]) => re.test(s));
}

interface Unit { levels: string[]; text: string }

function unitsOf(statement: string): { units: Unit[]; general: string[] } {
  const units: Unit[] = [];
  const general: string[] = [];
  const clauses: string[] = [];
  for (const c of statement.split(/,\s*/)) {
    // "POSTERIOR C6-7 ANNULAR TEAR & C5-6 FACET HYPERTROPHY" → two findings.
    const parts = c.split(/\s+(?:&|and)\s+/i);
    let acc = parts[0];
    for (let i = 1; i < parts.length; i++) {
      if (hasType(acc) && hasType(parts[i].replace(/\bwith\b[\s\S]*$/i, "")) && levelsInText(parts[i]).length) { clauses.push(acc); acc = parts[i]; }
      else acc += ` & ${parts[i]}`;
    }
    clauses.push(acc);
  }
  let cur: Unit | null = null;
  let carry: string[] = [];
  for (const c of clauses) {
    const lh = /\blisthesis of ([CTL])(\d{1,2}) on (?:[CTLS])?(\d{1,2})\b/i.exec(c);
    const lv = levelsInText(c).length ? levelsInText(c) : lh ? [normalizeLevel(`${lh[1]}${lh[2]}-${lh[3]}`)].filter((x): x is string => Boolean(x)) : [];
    if (lv.length && !hasType(c) && !effectsOf(c).length && /^[\sCTLS0-9/&-]*(and|&)?[\sCTLS0-9/&-]*$/i.test(c)) {
      carry.push(...lv); // "L3-4, L4-5 AND L5-S1 DISC …" — a bare level list shares the next finding
      continue;
    }
    if (lv.length && (hasType(c) || effectsOf(c).length || !cur)) {
      cur = { levels: [...carry, ...lv.filter((l) => !carry.includes(l))], text: c };
      carry = [];
      units.push(cur);
    } else if (cur && (EFFECT_START.test(c) || !hasType(c) || (!lv.length && /\b(stenosis|narrowing|effac\w*|compress\w*|abut\w*|indent\w*|imping\w*)\b/i.test(c) && !/\b(dis[ck]|herniat|protru|extru|bulg)/i.test(c)))) {
      cur.text += `, ${c}`;
      if (lv.length) cur.levels.push(...lv.filter((l) => !cur!.levels.includes(l)));
    } else if (hasType(c) || c.trim()) {
      general.push(c);
      cur = null;
    }
  }
  return { units, general };
}

/** Parse impression/findings text. */
export function parseSpineFindings(text: string): SpineFindings {
  const byLevel = new Map<string, SpineFinding[]>();
  const general: string[] = [];
  const dropped: string[] = [];
  let signed = false;
  for (const st0 of splitStatements(text ?? "")) {
    if (signed || /\b(electronically signed|dictated by|signed by|transcribed by)\b/i.test(st0)) { signed = true; dropped.push(st0); continue; }
    const st = levelsInText(st0).length && /^[^:]*\d[^:]*:/.test(st0) ? st0 : st0.replace(/^[A-Za-z][A-Za-z /&-]{0,30}:\s+/, "");
    if (/^(no|without|negative for)\b/i.test(st) && !levelsInText(st).length) { dropped.push(st); continue; }
    if (BOILERPLATE.test(st) && !levelsInText(st).length) { dropped.push(st); continue; }
    const { units, general: g } = unitsOf(st);
    for (const u of units) {
      const fs = findingsOf(u.text);
      for (const l of u.levels) {
        const list = byLevel.get(l) ?? [];
        for (const f of fs) if (!list.some((x) => JSON.stringify(x) === JSON.stringify(f))) list.push(f);
        if (list.length) byLevel.set(l, list);
      }
    }
    for (const x of g) {
      if (BOILERPLATE.test(x) || /^(no|without|negative for)\b/i.test(x.trim())) { dropped.push(x); continue; }
      const terms = sentence(x);
      if (terms && !general.includes(terms)) general.push(terms);
    }
  }
  const levels = [...byLevel.entries()]
    .map(([level, findings]) => ({ level, region: regionOf(level[0]), findings }))
    .sort((a, b) => levelSortKey(a.level) - levelSortKey(b.level));
  return { levels, general, dropped };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const KEEP_CAPS = /\b([CTLS]\d{1,2}(?:-[CTLS]?\d{1,2})?|MRI|CT|L>R|R>L|I{1,3}|STIR|T1|T2)\b/g;
/** ALL CAPS → sentence case, keeping levels and a few acronyms. */
export function sentence(s: string): string {
  const t = s.replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "").trim();
  if (!t) return "";
  const keep: string[] = [];
  const masked = t.replace(KEEP_CAPS, (m) => { keep.push(m.toUpperCase()); return `\u0000${keep.length - 1}\u0000`; });
  const lower = /[a-z]/.test(masked.replace(/\u0000\d+\u0000/g, "")) ? masked : masked.toLowerCase();
  const back = lower.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]).replace(/\bmodic type (i{1,3})\b/gi, (_, n) => `Modic type ${n.toUpperCase()}`).replace(/\bmodic\b/g, "Modic");
  return back.charAt(0).toUpperCase() + back.slice(1);
}

export function findingText(f: SpineFinding): string {
  const size = f.sizeMm !== null ? `${f.sizeMm} mm ` : "";
  const sv = /^(mild|moderate|severe|marked|minimal|significant) /.exec(f.type)?.[0] ?? "";
  const core = `${size}${sv}${f.sides.length ? `${f.sides.join(" ")} ` : ""}${f.type.slice(sv.length)}`.trim();
  const cut = f.sizeCut ? " (size cut off in the report)" : "";
  const eff = f.effects.length ? `${core ? " — " : ""}${f.effects.join(", ")}` : "";
  return `${core}${cut}${eff}`;
}

export interface SpineBlock { heading: string; items: string[] }

/** Region blocks in spine order (one line per level) plus "General". Empty when nothing parsed. */
export function spineBlocks(p: SpineFindings, only?: { levels?: string[]; regions?: string[] }): SpineBlock[] {
  const wantLv = (only?.levels ?? []).map((l) => normalizeLevel(l) ?? l);
  const wantRg = (only?.regions ?? []).map((r) => r.toLowerCase());
  const blocks: SpineBlock[] = [];
  for (const region of REGION_ORDER) {
    const rows = p.levels.filter((l) => l.region === region && (!wantLv.length || wantLv.includes(l.level)) && (!wantRg.length || wantLv.length || wantRg.includes(region.toLowerCase())));
    if (rows.length) blocks.push({ heading: region, items: rows.map((r) => `${r.level}: ${sentence(r.findings.map(findingText).join("; ")).replace(/^./, (c) => c.toLowerCase()).replace(/^(\d|[a-z])/, (c) => c.toUpperCase())}`) });
  }
  if (p.general.length && !wantLv.length) blocks.push({ heading: "General", items: [p.general.map((g, i) => (i ? (/^Modic\b/.test(g) ? g : g.replace(/^[A-Z](?![A-Z0-9>])/, (c) => c.toLowerCase())) : g)).join(", ")] });
  return blocks;
}

/** True when the text reads like a spine impression we can structure. */
export function isStructurable(p: SpineFindings): boolean {
  return p.levels.length > 0;
}
