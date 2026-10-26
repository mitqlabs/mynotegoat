/**
 * Picks which prior encounter a new note should be pre-filled ("salted") from.
 *
 * Rule: the patient's most recent prior note BY VISIT DATE (strictly before
 * the new note's date) that has SOAP content. Never by last-edited time —
 * reopening an old note (e.g. the Initial Exam) bumps its updatedAt, and the
 * old updatedAt ordering made that old note the salt source for the next
 * new visit.
 */
export interface SaltCandidate {
  id: string;
  patientId: string;
  encounterDate: string; // MM/DD/YYYY
  updatedAt: string;
  soap: Record<string, string>;
}

function visitStamp(us: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((us ?? "").trim());
  if (!m) return Number.NaN;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
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
  return keys.some((k) => (e.soap[k] ?? "").trim().length > 0);
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
