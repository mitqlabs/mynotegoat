/**
 * Treatment periods — for patients who come back for a second course of care
 * (e.g. a Personal Injury course, then Spinal Decompression months later).
 * Reports use these to cover one course only. Pure functions; nothing is
 * stored — a period is worked out from the schedule and the notes each time.
 *
 * Rule:
 *  - Only visits that happened count: an appointment that is Checked In or
 *    Checked Out, or any encounter note (Discharge visits are often never
 *    checked out, but they do have a note). Canceled / No Show / Reschedule /
 *    still-Scheduled appointments never count.
 *  - Each New Patient visit starts a period. It ends at the next Discharge
 *    visit; if another New Patient visit comes first, it ends at the last
 *    visit before that; otherwise it is still open.
 *  - Same-day duplicates (two New Patient entries on one day, an appointment
 *    and its note) count once. A second Discharge visit before any new
 *    New Patient visit extends the period that just ended.
 */

export interface PeriodAppointment {
  /** YYYY-MM-DD (schedule) or MM/DD/YYYY. */
  date: string;
  appointmentType: string;
  status: string;
}

export interface PeriodNote {
  /** MM/DD/YYYY or YYYY-MM-DD. */
  encounterDate: string;
  appointmentType: string;
}

export type PeriodEnd = "discharge" | "next-new-patient" | "open";

export interface TreatmentPeriod {
  id: string;
  /** YYYY-MM-DD, inclusive. */
  startIso: string;
  /** YYYY-MM-DD, inclusive; "" while the period is still open. */
  endIso: string;
  endKind: PeriodEnd;
  /** The Discharge visit that closed this period (YYYY-MM-DD), or "". */
  dischargeIso: string;
  /** e.g. "06/24/2025 – 09/15/2025 · New Patient → Discharge" */
  label: string;
}

/** A date range for a report. Either end may be "" (open). */
export interface PeriodRange {
  startIso: string;
  endIso: string;
}

const NEW_PATIENT = /new\s*patient/i;
const DISCHARGE = /discharg/i;
const ATTENDED = new Set(["check in", "checked in", "check out", "checked out", "seen"]);

/** YYYY-MM-DD / MM/DD/YYYY / M/D/YY → YYYY-MM-DD, or "" when not a date. */
export function toPeriodIso(value: string): string {
  const t = (value ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(t);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return "";
}

/** YYYY-MM-DD → MM/DD/YYYY ("" stays ""). */
export function periodIsoToUs(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function isAttended(status: string): boolean {
  return ATTENDED.has((status ?? "").trim().toLowerCase());
}

type Visit = { iso: string; kind: "new" | "discharge" | "other" };

function kindOf(type: string): Visit["kind"] {
  if (NEW_PATIENT.test(type ?? "")) return "new";
  if (DISCHARGE.test(type ?? "")) return "discharge";
  return "other";
}

/** Every visit that happened, one per day per kind, oldest first. */
function attendedVisits(appointments: PeriodAppointment[], notes: PeriodNote[]): Visit[] {
  const seen = new Set<string>();
  const out: Visit[] = [];
  const add = (iso: string, type: string) => {
    if (!iso) return;
    const kind = kindOf(type);
    const key = `${iso}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ iso, kind });
  };
  for (const a of appointments ?? []) if (isAttended(a.status)) add(toPeriodIso(a.date), a.appointmentType);
  for (const n of notes ?? []) add(toPeriodIso(n.encounterDate), n.appointmentType);
  // Same day: New Patient first, Discharge last, so a one-day course still reads in order.
  const rank = { new: 0, other: 1, discharge: 2 } as const;
  return out.sort((x, y) => x.iso.localeCompare(y.iso) || rank[x.kind] - rank[y.kind]);
}

function labelFor(p: Omit<TreatmentPeriod, "label" | "id">): string {
  const start = periodIsoToUs(p.startIso);
  if (p.endKind === "open") return `${start} – ongoing · New Patient → no discharge yet`;
  const end = periodIsoToUs(p.endIso);
  return p.endKind === "discharge"
    ? `${start} – ${end} · New Patient → Discharge`
    : `${start} – ${end} · New Patient → next New Patient`;
}

export function detectTreatmentPeriods(
  appointments: PeriodAppointment[],
  notes: PeriodNote[],
): TreatmentPeriod[] {
  const periods: Omit<TreatmentPeriod, "label" | "id">[] = [];
  let open: { startIso: string; lastIso: string } | null = null;
  for (const v of attendedVisits(appointments, notes)) {
    if (v.kind === "new") {
      if (open) {
        // Started again without a discharge: the earlier period ends at its last visit.
        periods.push({ startIso: open.startIso, endIso: open.lastIso, endKind: "next-new-patient", dischargeIso: "" });
      }
      open = { startIso: v.iso, lastIso: v.iso };
    } else if (v.kind === "discharge") {
      if (open) {
        periods.push({ startIso: open.startIso, endIso: v.iso, endKind: "discharge", dischargeIso: v.iso });
        open = null;
      } else {
        const last = periods.at(-1);
        if (last && last.endKind === "discharge" && v.iso > last.endIso) {
          last.endIso = v.iso;
          last.dischargeIso = v.iso;
        }
      }
    } else if (open) {
      open.lastIso = v.iso;
    }
  }
  if (open) periods.push({ startIso: open.startIso, endIso: "", endKind: "open", dischargeIso: "" });
  return periods.map((p) => ({ ...p, id: `period-${p.startIso}`, label: labelFor(p) }));
}

export function isInPeriod(dateValue: string, range: PeriodRange): boolean {
  const iso = toPeriodIso(dateValue);
  if (!iso) return false;
  if (range.startIso && iso < range.startIso) return false;
  if (range.endIso && iso > range.endIso) return false;
  return true;
}

/** Notes dated inside the range (inclusive). Order is kept. */
export function filterNotesToPeriod<T extends { encounterDate: string }>(notes: T[], range: PeriodRange): T[] {
  return notes.filter((n) => isInPeriod(n.encounterDate, range));
}

/** The latest Discharge visit that happened inside the range (YYYY-MM-DD), or "". */
export function dischargeVisitInPeriod(
  appointments: PeriodAppointment[],
  notes: PeriodNote[],
  range: PeriodRange,
): string {
  let best = "";
  for (const v of attendedVisits(appointments, notes)) {
    if (v.kind === "discharge" && isInPeriod(v.iso, range) && v.iso > best) best = v.iso;
  }
  return best;
}

/** Attended New Patient / Discharge visits, counted once per day. */
export function countCourseVisits(
  appointments: PeriodAppointment[],
  notes: PeriodNote[],
): { newPatient: number; discharge: number } {
  const visits = attendedVisits(appointments, notes);
  return {
    newPatient: visits.filter((v) => v.kind === "new").length,
    discharge: visits.filter((v) => v.kind === "discharge").length,
  };
}

/**
 * Whether the patient has had more than one course of care: 2+ attended
 * New Patient visits AND 2+ attended Discharge visits, forming 2+ periods.
 * The Reports treatment-period picker and diagnosis checklist only appear
 * then; every other patient's Reports box is unchanged.
 */
export function hasMultipleTreatmentPeriods(
  appointments: PeriodAppointment[],
  notes: PeriodNote[],
  periods: TreatmentPeriod[] = detectTreatmentPeriods(appointments, notes),
): boolean {
  const counts = countCourseVisits(appointments, notes);
  return counts.newPatient >= 2 && counts.discharge >= 2 && periods.length >= 2;
}
