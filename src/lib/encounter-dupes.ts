/**
 * G.O.A.T. duplicate encounters (rules only, pure): find a patient's encounters
 * that share a date, score which one holds the real data, and plan a merge
 * ("keep the fuller one" or a field-level union). Never applies anything.
 */
import type { EncounterNoteRecord, EncounterSection } from "@/lib/encounter-notes";

const SECTIONS: EncounterSection[] = ["subjective", "objective", "assessment", "plan"];

/** Visible text of a SOAP section (HTML tags and entities stripped). */
export function plainText(html: string): string {
  return (html ?? "")
    .replace(/<br\s*\/?>|<\/(p|div|li)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Fullness {
  score: number;
  sections: number;
  chars: number;
  diagnoses: number;
  charges: number;
  macroRuns: number;
  signed: boolean;
}

/** How much real data an encounter holds. Charges and diagnoses weigh most. */
export function fullness(r: EncounterNoteRecord): Fullness {
  const texts = SECTIONS.map((s) => plainText(r.soap?.[s] ?? ""));
  const sections = texts.filter(Boolean).length;
  const chars = texts.reduce((n, t) => n + t.length, 0);
  const diagnoses = r.diagnoses?.length ?? 0;
  const charges = r.charges?.length ?? 0;
  const macroRuns = r.macroRuns?.length ?? 0;
  const score = sections * 10 + Math.min(chars, 4000) / 40 + diagnoses * 8 + charges * 12 + macroRuns * 3 + (r.signed ? 5 : 0);
  return { score: Math.round(score * 10) / 10, sections, chars, diagnoses, charges, macroRuns, signed: Boolean(r.signed) };
}

/** MM/DD/YYYY or YYYY-MM-DD → YYYY-MM-DD (for grouping). */
function dateKey(d: string): string {
  const s = (d ?? "").trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return s.slice(0, 10);
}

export interface DuplicateGroup {
  date: string; // as stored on the encounters (MM/DD/YYYY)
  /** Fullest first: [0] holds the real data. */
  encounters: EncounterNoteRecord[];
  scores: Fullness[];
}

/** Same-date encounters for one patient, fullest first; newest date first. */
export function findDuplicateEncounters(records: EncounterNoteRecord[], patientId: string): DuplicateGroup[] {
  const byDate = new Map<string, EncounterNoteRecord[]>();
  for (const r of records) {
    if (r.patientId !== patientId || !r.encounterDate) continue;
    const k = dateKey(r.encounterDate);
    byDate.set(k, [...(byDate.get(k) ?? []), r]);
  }
  const groups: Array<DuplicateGroup & { k: string }> = [];
  for (const [k, list] of byDate) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => fullness(b).score - fullness(a).score || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    groups.push({ k, date: sorted[0].encounterDate, encounters: sorted, scores: sorted.map(fullness) });
  }
  return groups.sort((a, b) => b.k.localeCompare(a.k)).map((g) => ({ date: g.date, encounters: g.encounters, scores: g.scores }));
}

export type MergeMode = "keepFuller" | "union";

export interface MergePlan {
  mode: MergeMode;
  keep: EncounterNoteRecord;
  /** The kept encounter after the merge. */
  merged: EncounterNoteRecord;
  remove: EncounterNoteRecord[];
  /** Plain-words list of what moves into the kept encounter. */
  changes: string[];
}

const chargeKey = (c: EncounterNoteRecord["charges"][number]) => (c.procedureCode || c.name || "").trim().toLowerCase();
const dxKey = (d: EncounterNoteRecord["diagnoses"][number]) => (d.code || d.description || "").trim().toLowerCase();

/**
 * keepFuller: the fullest encounter stays exactly as is; the others are removed.
 * union: the fullest stays and takes, field by field, whatever only the others
 * have (empty SOAP sections filled, different text appended, missing charges /
 * diagnoses / macro runs added; duplicates by CPT / ICD skipped).
 */
export function planMerge(group: DuplicateGroup, mode: MergeMode): MergePlan {
  const [keep, ...rest] = group.encounters;
  const changes: string[] = [];
  if (mode === "keepFuller") {
    return { mode, keep, merged: keep, remove: rest, changes };
  }
  const merged: EncounterNoteRecord = {
    ...keep,
    soap: { ...keep.soap },
    diagnoses: [...(keep.diagnoses ?? [])],
    charges: [...(keep.charges ?? [])],
    macroRuns: [...(keep.macroRuns ?? [])],
  };
  for (const other of rest) {
    for (const s of SECTIONS) {
      const mine = plainText(merged.soap[s] ?? "");
      const theirs = plainText(other.soap?.[s] ?? "");
      if (!theirs || mine === theirs || mine.includes(theirs)) continue;
      if (!mine) {
        merged.soap[s] = other.soap[s];
        changes.push(`${s[0].toUpperCase()}${s.slice(1)} filled in`);
      } else {
        merged.soap[s] = `${merged.soap[s]}\n${other.soap[s]}`;
        changes.push(`${s[0].toUpperCase()}${s.slice(1)} text added`);
      }
    }
    const haveDx = new Set(merged.diagnoses.map(dxKey));
    for (const d of other.diagnoses ?? []) {
      if (haveDx.has(dxKey(d))) continue;
      haveDx.add(dxKey(d));
      merged.diagnoses.push(d);
      changes.push(`Diagnosis ${d.code || d.description}`);
    }
    const haveCh = new Set(merged.charges.map(chargeKey));
    for (const c of other.charges ?? []) {
      if (haveCh.has(chargeKey(c))) continue;
      haveCh.add(chargeKey(c));
      merged.charges.push(c);
      changes.push(`Charge ${c.procedureCode ? `${c.procedureCode} ` : ""}${c.name}`.trim());
    }
    const haveRun = new Set(merged.macroRuns.map((m) => m.id));
    for (const m of other.macroRuns ?? []) {
      if (haveRun.has(m.id)) continue;
      haveRun.add(m.id);
      merged.macroRuns.push(m);
    }
    if (!merged.appointmentId && other.appointmentId) merged.appointmentId = other.appointmentId;
    if (!merged.startTime && other.startTime) merged.startTime = other.startTime;
  }
  return { mode, keep, merged, remove: rest, changes };
}
