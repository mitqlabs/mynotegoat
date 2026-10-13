/**
 * Built-in ICD-10-CM code list (FY2026, billable codes) and its search.
 *
 * The list is the official public-domain CMS/CDC code file, converted at dev
 * time by scripts/build-icd10.mjs into public/icd10/icd10cm-2026.json and
 * served by NoteGoat itself. It is fetched only when a search box is first
 * used, then kept in memory; no outside service is ever called.
 *
 * Search is pure and synchronous once loaded: code prefixes ("M54.12",
 * "m5412", "M51") or words in any order, each word matching the start of a
 * word in the description ("lumb sten" → "Spinal stenosis, lumbar region…").
 */

export const ICD10_VERSION = "FY2026";
export const ICD10_ASSET = "/icd10/icd10cm-2026.json";

export interface Icd10Code {
  /** Dotted, as written on claims: "M54.12". */
  code: string;
  description: string;
}

export interface Icd10Entry extends Icd10Code {
  /** Undotted upper-case: "M5412". */
  raw: string;
  /** " word word …" lower-case, for word-prefix matching. */
  hay: string;
}

export interface Icd10Index {
  version: string;
  entries: Icd10Entry[];
  byRaw: Map<string, Icd10Entry>;
}

/** "m5412" / "M54.12" → "M5412". */
export function rawCode(code: string): string {
  return (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "M5412" → "M54.12" (codes of 4+ characters get a dot after the third). */
export function dottedCode(code: string): string {
  const raw = rawCode(code);
  return raw.length > 3 ? `${raw.slice(0, 3)}.${raw.slice(3)}` : raw;
}

/** Same code regardless of dots/case ("M51.26" = "m5126"). */
export function sameCode(a: string, b: string): boolean {
  const ra = rawCode(a);
  return ra.length > 0 && ra === rawCode(b);
}

function hayOf(description: string): string {
  return ` ${description.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export function buildIcd10Index(codes: Array<[string, string]>, version = ICD10_VERSION): Icd10Index {
  const entries: Icd10Entry[] = codes.map(([raw, description]) => ({
    raw: rawCode(raw),
    code: dottedCode(raw),
    description,
    hay: hayOf(description),
  }));
  return { version, entries, byRaw: new Map(entries.map((e) => [e.raw, e] as const)) };
}

// Words people type that the official descriptions spell differently.
// Each typed word also matches its alternatives.
const SYNONYMS: Record<string, string[]> = {
  herniated: ["displacement"],
  herniation: ["displacement"],
  hernia: ["displacement", "hernia"],
  hnp: ["displacement"],
  bulge: ["displacement", "degeneration"],
  bulging: ["displacement", "degeneration"],
  bulges: ["displacement", "degeneration"],
  protrusion: ["displacement"],
  protruding: ["displacement"],
  extrusion: ["displacement"],
  extruded: ["displacement"],
  ddd: ["degeneration"],
  djd: ["spondylosis", "degeneration"],
  degenerative: ["degeneration", "degenerative"],
  neck: ["cervical", "neck", "cervicalgia"],
  cervical: ["cervical", "cervicalgia", "cervicothoracic"],
  thoracic: ["thoracic", "thoracolumbar", "cervicothoracic", "thorax"],
  lumbar: ["lumbar", "lumbosacral", "lower back", "low back"],
  lumbosacral: ["lumbosacral"],
  whiplash: ["sprain of ligaments of cervical spine"],
  lbp: ["low back pain"],
  sciatic: ["sciatica", "sciatic"],
  listhesis: ["spondylolisthesis"],
  radic: ["radiculopathy"],
  radicular: ["radiculopathy"],
  radiculitis: ["radiculopathy", "radiculitis"],
  stenotic: ["stenosis"],
  spondylitic: ["spondylosis"],
  spasms: ["spasm"],
  rotator: ["rotator"],
};

// Clinical phrases → the words the official descriptions use (all FY2026
// billable code families; see scripts/tests/icd10-synonyms.test.ts):
//   annular tear / fissure → M51.A* "Intervertebral annulus fibrosus defect"
//   neck pain → M54.2 Cervicalgia;  facet syndrome → M47.81* spondylosis without myelopathy or radiculopathy
//   mid / upper back pain → M54.6 "Pain in thoracic spine"
//   pinched nerve → M54.1* radiculopathy;  SI joint → sacroiliac
const PHRASES: Array<[RegExp, string[][]]> = [
  [/\bannul(?:ar|us)\s+(?:tears?|fissures?|defects?)\b|\bannular\b/g, [["annulus fibrosus defect"]]],
  [/\bneck\s+pain\b/g, [["cervicalgia"]]],
  [/\bfacet\s+(?:syndrome|arthropathy|joint\s+syndrome|joint\s+pain|pain|joints?)\b/g, [["spondylosis without myelopathy or radiculopathy"]]],
  [/\b(?:mid|middle|upper|thoracic)\s+back\s+pain\b/g, [["pain in thoracic spine"]]],
  [/\bpinched\s+nerves?\b/g, [["radiculopathy"]]],
  [/\bs\.?i\.?\s+joints?\b|\bsij\b/g, [["sacroiliac"]]],
  [/\bdisc\s+bulges?\b|\bbulging\s+discs?\b/g, [["disc"], ["displacement", "degeneration"]]],
];

// Spinal levels ("C5-6", "c5-c6", "L4/5", "L5-S1"): the region is required; the exact level only ranks first.
const LEVEL_RE = /\b([ctls])(\d{1,2})(?![\d.])\s*(?:[-–/]\s*([ctls])?(\d{1,2})(?![\d.]))?(?![a-z])/g;
function levelGroups(region: string, n: number, region2: string | undefined, n2: number | undefined): Array<{ alts: string[]; soft?: boolean }> {
  const r2 = region2 ?? region;
  const pair = `${region}${r2}`;
  let regionAlts: string[];
  if (pair === "cc") regionAlts = ["cervical", "cervicalgia"];
  else if (pair === "ct") regionAlts = ["cervicothoracic"];
  else if (pair === "tt") regionAlts = ["thoracic"];
  else if (pair === "tl") regionAlts = ["thoracolumbar"];
  else if (pair === "ls" || pair === "ss") regionAlts = ["lumbosacral"];
  else regionAlts = ["lumbar", "lumbosacral", "lower back", "low back"];
  const out: Array<{ alts: string[]; soft?: boolean }> = [{ alts: regionAlts }];
  if (n2 !== undefined) out.push({ alts: [`${region}${n} ${r2}${n2}`], soft: true });
  return out;
}

/** "M54", "m5412", "S13.4" — but not a spinal level word like "c5" (two characters). */
function isCodeToken(token: string): boolean {
  return /^[a-z][0-9][0-9a-z]$|^[a-z][0-9][0-9a-z]\.?[0-9a-z]{1,4}$/i.test(token);
}

export interface Icd10SearchOptions {
  limit?: number;
}

/**
 * Search the list. Every typed word must match (any order). Code-like words
 * ("M54", "m54.12") match the start of the code; other words match the start
 * of any word in the description (or a synonym, e.g. "herniated" →
 * "displacement"). Exact code first, then code prefixes, then the shortest
 * (most general) descriptions.
 */
export function searchIcd10(index: Icd10Index | null, query: string, opts: Icd10SearchOptions = {}): Icd10Entry[] {
  if (!index) return [];
  const limit = opts.limit ?? 50;
  let q = (query ?? "").toLowerCase();
  const groups: Array<{ alts: string[]; soft?: boolean }> = [];
  for (const [re, gs] of PHRASES) {
    if (re.test(q)) {
      re.lastIndex = 0;
      q = q.replace(re, " ");
      for (const g of gs) groups.push({ alts: g });
    }
    re.lastIndex = 0;
  }
  q = q.replace(LEVEL_RE, (m, r1: string, a1: string, r2: string | undefined, a2: string | undefined) => {
    // "c5" alone is a level word too; plain codes ("m54", "s13") never match [ctls]+digits only.
    const n1 = Number(a1);
    const n2 = a2 !== undefined ? Number(a2) : undefined;
    const max: Record<string, number> = { c: 8, t: 12, l: 5, s: 5 };
    if (a1.startsWith("0") || (a2 ?? "").startsWith("0")) return m; // "T07", "C01": codes
    if (n1 < 1 || n1 > max[r1] || (n2 !== undefined && (n2 < 1 || n2 > max[r2 ?? r1]))) return m;
    if (r1 === "s" && !r2) return m;
    if (n2 !== undefined && !r2 && n2 <= n1) return m;
    const second = n2 !== undefined ? (r2 ?? r1) : undefined;
    const secondN = n2 !== undefined ? n2 : undefined;
    groups.push(...levelGroups(r1, n1, second, secondN));
    return " ";
  });
  const tokens = q
    .replace(/[,;:()/\-–]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9.]+$/g, ""))
    .filter(Boolean);
  if (!tokens.length && !groups.length) return [];
  const codeTokens = tokens.filter(isCodeToken).map(rawCode);
  const wordTokens = tokens.filter((t) => !isCodeToken(t)).map((t) => t.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  // Single short words ("a") would match nearly everything.
  if (!codeTokens.length && !groups.length && wordTokens.every((w) => w.length < 2)) return [];
  const wordAlts = [...wordTokens.map((w) => [w, ...(SYNONYMS[w] ?? [])]), ...groups.filter((g) => !g.soft).map((g) => g.alts)].map((alts) => alts.map((a) => ` ${a}`));
  const softAlts = groups.filter((g) => g.soft).map((g) => g.alts.map((a) => ` ${a}`));

  const scored: Array<{ e: Icd10Entry; s: number }> = [];
  for (const e of index.entries) {
    let s = 0;
    let ok = true;
    for (const c of codeTokens) {
      if (!e.raw.startsWith(c)) {
        ok = false;
        break;
      }
      s += e.raw === c ? 1000 : 500 - (e.raw.length - c.length) * 10;
    }
    if (!ok) continue;
    let pos = 0;
    for (const alts of wordAlts) {
      let at = -1;
      for (const a of alts) {
        const i = e.hay.indexOf(a);
        if (i >= 0 && (at < 0 || i < at)) at = i;
      }
      if (at < 0) {
        ok = false;
        break;
      }
      pos += at;
    }
    if (!ok) continue;
    for (const alts of softAlts) if (alts.some((a) => e.hay.includes(a))) s += 60;
    if (wordAlts.length) {
      // Words found early in a short description rank first
      // ("Radiculopathy, cervical region" before "Cervical disc disorder … with radiculopathy").
      s += 100 - pos / 4 - e.description.length / 20;
    }
    scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s || a.e.raw.localeCompare(b.e.raw));
  return scored.slice(0, limit).map((x) => x.e);
}

/** A code from the office's own list (Diagnosis settings), with its folder. */
export interface LocalCode {
  code: string;
  description: string;
  /** Folder name shown next to the match ("Cervical"). */
  group?: string;
}

export interface LocalCodeIndex<T extends LocalCode> {
  index: Icd10Index;
  byRaw: Map<string, T>;
}

/** Index the office's own codes so they search exactly like the ICD-10 list. First entry wins on duplicates. */
export function buildLocalIndex<T extends LocalCode>(list: T[]): LocalCodeIndex<T> {
  const byRaw = new Map<string, T>();
  for (const item of list) {
    const raw = rawCode(item.code);
    if (raw && item.description.trim() && !byRaw.has(raw)) byRaw.set(raw, item);
  }
  const index = buildIcd10Index([...byRaw.entries()].map(([raw, item]) => [raw, item.description]), "local");
  return { index, byRaw };
}

/**
 * One search over both lists: the office's codes first, then ICD-10 codes that
 * aren't already in the office's list (a code shows once, under "Your codes").
 */
export function searchCombined<T extends LocalCode>(
  local: LocalCodeIndex<T> | null,
  icd: Icd10Index | null,
  query: string,
  opts: { localLimit?: number; limit?: number } = {},
): { local: Array<{ item: T; entry: Icd10Entry }>; icd: Icd10Entry[] } {
  const localHits = local
    ? searchIcd10(local.index, query, { limit: opts.localLimit ?? 20 })
        .map((entry) => ({ item: local.byRaw.get(entry.raw) as T, entry }))
        .filter((hit) => hit.item)
    : [];
  const limit = opts.limit ?? 30;
  const icdHits = local
    ? searchIcd10(icd, query, { limit: limit + local.byRaw.size }).filter((e) => !local.byRaw.has(e.raw)).slice(0, limit)
    : searchIcd10(icd, query, { limit });
  return { local: localHits, icd: icdHits };
}

// ---------------------------------------------------------------------------
// Loading (browser): once, on first use.
// ---------------------------------------------------------------------------

let loading: Promise<Icd10Index> | null = null;
let loaded: Icd10Index | null = null;

/** The list if it's already in memory (no fetch). */
export function icd10IfLoaded(): Icd10Index | null {
  return loaded;
}

/** Fetch the self-hosted list once and keep it; later calls share the same promise. */
export function loadIcd10(): Promise<Icd10Index> {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = fetch(ICD10_ASSET, { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`ICD-10 list failed to load (HTTP ${res.status})`);
        return res.json() as Promise<{ version?: string; codes?: Array<[string, string]> }>;
      })
      .then((json) => {
        if (!Array.isArray(json.codes)) throw new Error("ICD-10 list is malformed");
        loaded = buildIcd10Index(json.codes, json.version ?? ICD10_VERSION);
        return loaded;
      })
      .catch((err: unknown) => {
        loading = null; // allow a retry
        throw err;
      });
  }
  return loading;
}
