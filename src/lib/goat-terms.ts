/**
 * G.O.A.T. words & synonym groups.
 *
 * A group is a list of words that mean the same thing to the office, e.g.
 *   ["pain management", "PM"]
 *   ["range of motion", "ROM", "flexion", "extension", "rotation", …]
 * Asking with any word in a group looks for every word in it, so a pain
 * management report that only says "anterior flexion 40 degrees" still
 * answers "PM findings for range of motion". Abbreviations are simply small
 * groups.
 *
 * Stored per workspace in localStorage (casemate.goat-settings.v1) and
 * dual-written to workspace_kv like the other office settings, so every
 * device in the office sees the same list. Matching is plain text, in the
 * browser; nothing is sent anywhere.
 */

export interface GoatTermGroup {
  id: string;
  /** First word is the group's name; the rest mean the same thing. */
  terms: string[];
  updatedAt: string;
  /**
   * Deleted groups stay in storage as tombstones so the list never shrinks:
   * cloud hydration keeps whichever copy has MORE entries, so a plain removal
   * could be undone by another device's older, longer copy.
   */
  deleted?: boolean;
}

export const GOAT_TERMS_STORAGE_KEY = "casemate.goat-settings.v1";

const seed = (id: string, terms: string[]): GoatTermGroup => ({ id: `seed-${id}`, terms, updatedAt: "" });

/** Starting list for a new office — editable in Settings → G.O.A.T. */
export const DEFAULT_GOAT_TERM_GROUPS: GoatTermGroup[] = [
  seed("rom", ["range of motion", "ROM", "flexion", "extension", "rotation", "lateral flexion", "lateral bending", "anterior flexion", "degrees"]),
  seed("pm", ["pain management", "PM", "pain mgmt", "pain medicine", "interventional pain"]),
  seed("ortho", ["orthopedic", "ortho", "orthopedist", "orthopaedic", "orthopedic surgeon"]),
  seed("neuro", ["neurology", "neuro", "neurologist"]),
  seed("cervical", ["cervical", "C/S", "C-spine", "cervical spine", "neck"]),
  seed("thoracic", ["thoracic", "T/S", "T-spine", "thoracic spine", "mid back"]),
  seed("lumbar", ["lumbar", "L/S", "L-spine", "lumbar spine", "low back", "lower back"]),
  seed("findings", ["findings", "impression", "assessment", "conclusion", "results"]),
  seed("recommend", ["recommendations", "recommendation", "recommended", "plan of care"]),
  seed("xray", ["x-ray", "XR", "radiograph", "radiographs"]),
  seed("mri", ["MRI", "magnetic resonance"]),
  seed("ct", ["CT", "CT scan", "computed tomography", "CAT scan"]),
  seed("ie", ["initial exam", "IE", "initial examination", "initial evaluation"]),
  seed("reexam", ["re-exam", "re-examination", "re-evaluation", "reexam"]),
  seed("doi", ["date of injury", "DOI", "date of loss", "DOL", "accident date"]),
  seed("soap", ["SOAP", "SOAP note", "progress note", "daily note"]),
  seed("lop", ["letter of protection", "LOP", "lien"]),
  seed("mva", ["motor vehicle accident", "MVA", "MVC", "car accident", "auto accident"]),
  seed("esi", ["epidural steroid injection", "ESI", "epidural"]),
  seed("mbb", ["medial branch block", "MBB"]),
  seed("rfa", ["radiofrequency ablation", "RFA"]),
  seed("ttp", ["tenderness", "tender to palpation", "TTP", "tender"]),
  seed("spasm", ["spasm", "spasms", "muscle spasm", "hypertonicity"]),
  seed("radic", ["radiculopathy", "radicular", "radiating", "numbness", "tingling", "paresthesia"]),
  seed("ha", ["headache", "headaches", "HA"]),
];

// ---------------------------------------------------------------------------
// Normalising + storage
// ---------------------------------------------------------------------------

export function cleanTerms(terms: unknown): string[] {
  if (!Array.isArray(terms)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    if (typeof raw !== "string") continue;
    const t = raw.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 40);
}

export function normalizeGoatTermGroups(value: unknown): GoatTermGroup[] {
  if (!Array.isArray(value)) return DEFAULT_GOAT_TERM_GROUPS.map((g) => ({ ...g, terms: [...g.terms] }));
  const out: GoatTermGroup[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<GoatTermGroup>;
    const terms = cleanTerms(r.terms);
    if (!terms.length || typeof r.id !== "string" || !r.id) continue;
    out.push({
      id: r.id,
      terms,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
      ...(r.deleted === true ? { deleted: true } : {}),
    });
  }
  return out;
}

/** The groups in use (no tombstones). */
export function loadGoatTermGroups(): GoatTermGroup[] {
  return loadStoredGoatTermGroups().filter((g) => !g.deleted);
}

/** Everything stored, tombstones included — edit this list, then save it. */
export function loadStoredGoatTermGroups(): GoatTermGroup[] {
  if (typeof window === "undefined") return normalizeGoatTermGroups(undefined);
  try {
    const raw = window.localStorage.getItem(GOAT_TERMS_STORAGE_KEY);
    return normalizeGoatTermGroups(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizeGoatTermGroups(undefined);
  }
}

export function saveGoatTermGroups(groups: GoatTermGroup[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeGoatTermGroups(groups);
  window.localStorage.setItem(GOAT_TERMS_STORAGE_KEY, JSON.stringify(normalized));
  // Same office-wide sync as patient-page prefs / SMS templates.
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(GOAT_TERMS_STORAGE_KEY, "tasks", normalized));
}

export function createGoatTermGroupId() {
  return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** "PM, pain management; ROM" style text → terms. Commas, semicolons, "=" or new lines separate words. */
export function parseTermList(text: string): string[] {
  return cleanTerms(text.split(/[,;=\n]+/));
}

// ---------------------------------------------------------------------------
// Matching (pure)
// ---------------------------------------------------------------------------

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Short all-caps abbreviations (PM, ROM, C/S, XR) must match as written, so "from" isn't ROM. */
function isAbbreviation(term: string) {
  return term.length <= 5 && /[A-Z]/.test(term) && term === term.toUpperCase();
}

/**
 * Regex source for one term: whole words, spaces/hyphens interchangeable
 * ("x-ray" = "x ray"), optional plural on longer words. "PM"/"AM" never match
 * a clock time ("4:30 PM").
 */
export function termPattern(term: string): { source: string; caseSensitive: boolean } {
  const t = term.trim();
  const abbr = isAbbreviation(t);
  let body = t
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRe)
    .join("[\\s-]*");
  if (!abbr && t.length > 3 && /[a-z]$/i.test(t)) body += "(?:s|es)?";
  const timeGuard = /^(am|pm)$/i.test(t) ? "(?<!\\d\\s?)(?<!\\d:\\d\\d\\s?)" : "";
  return { source: `${timeGuard}(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, caseSensitive: abbr };
}

export interface TermMatcher {
  terms: string[];
  /** Does the text contain any of the terms? */
  test(text: string): boolean;
  /** Every [start, end) match of any term, sorted, non-overlapping. */
  ranges(text: string): Array<[number, number]>;
}

export function makeMatcher(terms: string[]): TermMatcher {
  const list = cleanTerms(terms);
  const sensitive = list.map(termPattern).filter((p) => p.caseSensitive).map((p) => p.source);
  const insensitive = list.map(termPattern).filter((p) => !p.caseSensitive).map((p) => p.source);
  const res: RegExp[] = [];
  if (sensitive.length) res.push(new RegExp(sensitive.join("|"), "g"));
  if (insensitive.length) res.push(new RegExp(insensitive.join("|"), "gi"));
  const ranges = (text: string) => {
    const out: Array<[number, number]> = [];
    for (const re of res) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (m[0].length === 0) {
          re.lastIndex += 1;
          continue;
        }
        out.push([m.index, m.index + m[0].length]);
      }
    }
    out.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged: Array<[number, number]> = [];
    for (const r of out) {
      const last = merged[merged.length - 1];
      if (last && r[0] < last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    return merged;
  };
  return {
    terms: list,
    test: (text) => res.some((re) => {
      re.lastIndex = 0;
      return re.test(text);
    }),
    ranges,
  };
}

/**
 * Groups the question mentions. Questions are typed casually, so here every
 * term matches regardless of case ("pm findings"), except "pm"/"am" after a
 * number (a time).
 */
export function groupsInQuestion(question: string, groups: GoatTermGroup[]): GoatTermGroup[] {
  const q = question ?? "";
  return groups.filter((g) =>
    g.terms.some((t) => {
      const p = termPattern(t);
      return new RegExp(p.source, "i").test(q);
    }),
  );
}
