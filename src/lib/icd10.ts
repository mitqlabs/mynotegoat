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
  bulge: ["displacement"],
  bulging: ["displacement"],
  protrusion: ["displacement"],
  extrusion: ["displacement"],
  ddd: ["degeneration"],
  degenerative: ["degeneration", "degenerative"],
  neck: ["cervical", "neck", "cervicalgia"],
  whiplash: ["sprain"],
  lbp: ["low back pain"],
  sciatic: ["sciatica", "sciatic"],
  listhesis: ["spondylolisthesis"],
  rotator: ["rotator"],
};

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
  const tokens = (query ?? "")
    .toLowerCase()
    .replace(/[,;:()/\-–]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9.]+$/g, ""))
    .filter(Boolean);
  if (!tokens.length) return [];
  const codeTokens = tokens.filter(isCodeToken).map(rawCode);
  const wordTokens = tokens.filter((t) => !isCodeToken(t)).map((t) => t.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  // Single short words ("a") would match nearly everything.
  if (!codeTokens.length && wordTokens.every((w) => w.length < 2)) return [];
  const wordAlts = wordTokens.map((w) => [w, ...(SYNONYMS[w] ?? [])].map((a) => ` ${a}`));

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
