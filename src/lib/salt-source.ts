/**
 * Picks which prior encounter a new note should be pre-filled ("salted") from.
 *
 * Rule: the patient's most recent prior note BY VISIT DATE (strictly before
 * the new note's date) that has SOAP content. Used only while a brand-new
 * note is being created. Never by last-edited time — reopening an old note
 * (e.g. the Initial Exam) bumps its updatedAt, and the old updatedAt ordering
 * made that old note the salt source for the next new visit.
 */
export interface SaltCandidate {
  id: string;
  patientId: string;
  encounterDate: string; // MM/DD/YYYY or YYYY-MM-DD
  updatedAt: string;
  soap: Record<string, string>;
  macroRuns?: ReadonlyArray<SaltMacroRun>;
}

export interface SaltMacroRun {
  id?: string;
  section: string;
  macroId: string;
  answers?: Record<string, unknown>;
}

function visitStamp(raw: string): number {
  const text = (raw ?? "").trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2])).getTime();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
  return Number.NaN;
}

/** Prior encounters for the patient, newest visit date first. */
export function priorEncountersByVisitDate<T extends SaltCandidate>(
  encounters: readonly T[],
  patientId: string,
  currentEncounterDate: string,
  excludeId?: string,
): T[] {
  const cur = visitStamp(currentEncounterDate);
  return encounters
    .filter((e) => {
      if (e.patientId !== patientId || e.id === excludeId) return false;
      const t = visitStamp(e.encounterDate);
      return Number.isFinite(t) && Number.isFinite(cur) && t < cur;
    })
    .sort((a, b) => {
      const d = visitStamp(b.encounterDate) - visitStamp(a.encounterDate);
      return d !== 0 ? d : b.updatedAt.localeCompare(a.updatedAt);
    });
}

export function hasSoapContent(e: SaltCandidate, sections?: readonly string[]): boolean {
  const keys = sections ?? Object.keys(e.soap);
  if (keys.some((k) => (e.soap[k] ?? "").trim().length > 0)) return true;
  return (e.macroRuns ?? []).some((run) => !sections || sections.includes(run.section));
}

/** Default Copy From / SALT source: newest prior visit that has content. */
export function pickSaltSource<T extends SaltCandidate>(
  encounters: readonly T[],
  patientId: string,
  currentEncounterDate: string,
  excludeId?: string,
  sections?: readonly string[],
): T | null {
  return (
    priorEncountersByVisitDate(encounters, patientId, currentEncounterDate, excludeId).find((e) =>
      hasSoapContent(e, sections),
    ) ?? null
  );
}

/** HTML with macro-run ids and tags removed, so a copied note still matches its source. */
export function sectionTextFingerprint(html: string): string {
  return (html ?? "")
    .replace(/data-macro-run-id=["'][^"']*["']/gi, "")
    .replace(/data-prompt-id=["'][^"']*["']/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function macroAnswerFingerprint(runs: ReadonlyArray<SaltMacroRun> | undefined, section: string): string {
  return (runs ?? [])
    .filter((run) => run.section === section)
    .map((run) => `${run.macroId}:${stableJson(run.answers ?? {})}`)
    .sort()
    .join("||");
}

export function sectionIsBlank(note: SaltCandidate, section: string): boolean {
  if ((note.soap[section] ?? "").trim()) return false;
  return !(note.macroRuns ?? []).some((run) => run.section === section);
}

/** Editor text and macro answers both match, ignoring copied run ids. */
export function sectionMatchesSource(current: SaltCandidate, source: SaltCandidate, section: string): boolean {
  return (
    sectionTextFingerprint(current.soap[section] ?? "") === sectionTextFingerprint(source.soap[section] ?? "") &&
    macroAnswerFingerprint(current.macroRuns, section) === macroAnswerFingerprint(source.macroRuns, section)
  );
}

/**
 * Sections that are still blank, or still a verbatim copy of some prior note.
 * A section the user changed by hand is left out, so a refresh will not wipe it.
 */
export function sectionsSafeToResalt<S extends string>(
  current: SaltCandidate,
  priors: readonly SaltCandidate[],
  sections: readonly S[],
): S[] {
  return sections.filter((section) => {
    if (sectionIsBlank(current, section)) return true;
    return priors.some((prior) => sectionMatchesSource(current, prior, section));
  });
}

/** When the same note exists in two copies, keep the one saved later. */
export function mergeNotesByNewest<T extends { id: string; updatedAt: string }>(local: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const note of local) byId.set(note.id, note);
  for (const note of incoming) {
    const prev = byId.get(note.id);
    if (!prev || note.updatedAt > prev.updatedAt) byId.set(note.id, note);
  }
  return [...byId.values()];
}
