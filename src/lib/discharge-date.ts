/**
 * The patient's discharge date — "whatever date is in the Discharge box" —
 * one rule shared by every place that reads it.
 *
 * Additional Details stores a Discharge date (patients.matrix.discharge) that
 * is only ever entered by hand (or came from the CaseMate import). Nothing
 * linked it to the patient's Discharge visit on the schedule, so it stayed
 * empty. This derives it at display time instead — nothing is written to the
 * patient record. Every reader (patient page, Quick Glance, G.O.A.T., Patients
 * list, dashboard, weekly summary) uses this, so they all show the same date:
 *
 *  1. A saved date in the Discharge box always wins (never overwritten).
 *  2. Otherwise: the date of the latest Discharge visit the patient attended —
 *     appointment type contains "discharge" (any case) and status Checked In
 *     or Checked Out. Canceled / No Show / Reschedule never count.
 *  3. A Discharge visit that is only Scheduled is NOT a discharge date (the
 *     patient may not come). It is reported separately as "scheduled" so the
 *     UI can say so, including when its date has passed without check-in.
 */

export interface DischargeAppointment {
  appointmentType: string;
  status: string;
  /** YYYY-MM-DD (schedule) or MM/DD/YYYY. */
  date: string;
}

export interface DischargeInfo {
  /** MM/DD/YYYY to show and use, or "" when there is none. */
  date: string;
  /** Where `date` came from. */
  source: "manual" | "visit" | "none";
  /** Latest attended Discharge visit (Checked In / Checked Out). */
  visit: { date: string; status: "Checked In" | "Checked Out" } | null;
  /** Latest Discharge visit still only Scheduled (not attended yet). */
  scheduled: { date: string; past: boolean } | null;
  /** The saved date differs from the attended Discharge visit. */
  differsFromVisit: boolean;
}

const DISCHARGE_TYPE = /discharg/i;
const ATTENDED: Record<string, "Checked In" | "Checked Out"> = {
  "check out": "Checked Out",
  "checked out": "Checked Out",
  seen: "Checked Out",
  "check in": "Checked In",
  "checked in": "Checked In",
};

export function isDischargeAppointmentType(type: string): boolean {
  return DISCHARGE_TYPE.test(type ?? "");
}

/** YYYY-MM-DD / M/D/YYYY / MM/DD/YY → YYYY-MM-DD, or "" when not a date. */
function toIso(value: string): string {
  const t = (value ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return "";
}

function toUs(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/**
 * @param manual  The Additional Details value (any of the stored formats).
 * @param appointments  This patient's schedule appointments.
 * @param todayIso  Today as YYYY-MM-DD (local), to tell past from upcoming.
 */
export function resolveDischargeDate(
  manual: string,
  appointments: DischargeAppointment[],
  todayIso: string,
): DischargeInfo {
  let visit: DischargeInfo["visit"] = null;
  let visitIso = "";
  let scheduledIso = "";
  for (const a of appointments ?? []) {
    if (!isDischargeAppointmentType(a.appointmentType)) continue;
    const iso = toIso(a.date);
    if (!iso) continue;
    const status = (a.status ?? "").trim().toLowerCase();
    const attended = ATTENDED[status];
    if (attended) {
      if (iso > visitIso) {
        visitIso = iso;
        visit = { date: toUs(iso), status: attended };
      }
    } else if (status === "scheduled") {
      if (iso > scheduledIso) scheduledIso = iso;
    }
  }
  // A scheduled one only matters if it isn't older than the attended visit.
  const scheduled = scheduledIso && scheduledIso > visitIso ? { date: toUs(scheduledIso), past: scheduledIso < todayIso } : null;
  // Anything in the box counts as its value — even half-entered, so the
  // field doesn't jump back to the visit date while someone is entering one.
  const typed = (manual ?? "").trim();
  if (typed) {
    const manualIso = toIso(typed);
    return {
      date: manualIso ? toUs(manualIso) : "",
      source: "manual",
      visit,
      scheduled,
      differsFromVisit: Boolean(visit && manualIso && visitIso !== manualIso),
    };
  }
  return { date: visit ? visit.date : "", source: visit ? "visit" : "none", visit, scheduled, differsFromVisit: false };
}

/** Today as YYYY-MM-DD in the browser's time zone. */
export function localTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Every other reader (Patients list, dashboard, weekly summary, Encounters
// Quick Glance) — the same date the patient page's Discharge box shows.
// ---------------------------------------------------------------------------

export interface DischargeScheduleEntry extends DischargeAppointment {
  patientId: string;
  patientName: string;
}

/** Same name matching as the patient page (legacy appointments without a patient id). */
function normalizeName(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nameKeys(fullName: string): string[] {
  const [lastName = "", firstName = ""] = (fullName ?? "").split(",").map((v) => v.trim());
  const keys = [fullName];
  if (firstName || lastName) {
    keys.push(`${firstName} ${lastName}`, `${lastName} ${firstName}`, `${lastName}, ${firstName}`, `${firstName}, ${lastName}`);
  }
  return [...new Set(keys.map(normalizeName).filter(Boolean))];
}

export interface DischargeIndex {
  /** Discharge appointments by patient id. */
  byId: Map<string, DischargeAppointment[]>;
  /** Discharge appointments with no patient id, by normalised name. */
  byName: Map<string, DischargeAppointment[]>;
}

/** Index the schedule's Discharge appointments once per page. */
export function buildDischargeIndex(appointments: DischargeScheduleEntry[]): DischargeIndex {
  const byId = new Map<string, DischargeAppointment[]>();
  const byName = new Map<string, DischargeAppointment[]>();
  for (const a of appointments ?? []) {
    if (!isDischargeAppointmentType(a.appointmentType)) continue;
    const entry = { appointmentType: a.appointmentType, status: a.status, date: a.date };
    if (a.patientId) {
      const list = byId.get(a.patientId) ?? [];
      list.push(entry);
      byId.set(a.patientId, list);
    } else {
      const key = normalizeName(a.patientName);
      if (!key) continue;
      const list = byName.get(key) ?? [];
      list.push(entry);
      byName.set(key, list);
    }
  }
  return { byId, byName };
}

function dischargeAppointmentsFor(patient: { id: string; fullName: string }, index: DischargeIndex): DischargeAppointment[] {
  const out = [...(index.byId.get(patient.id) ?? [])];
  if (index.byName.size) for (const key of nameKeys(patient.fullName)) out.push(...(index.byName.get(key) ?? []));
  return out;
}

/** The full Discharge-box answer for a patient record (saved value + schedule). */
export function patientDischargeInfo(
  patient: { id: string; fullName: string; matrix?: Partial<Record<string, string>> },
  index: DischargeIndex,
  todayIso: string = localTodayIso(),
): DischargeInfo {
  return resolveDischargeDate(patient.matrix?.discharge ?? "", dischargeAppointmentsFor(patient, index), todayIso);
}

/**
 * The date in the patient's Discharge box, as YYYY-MM-DD ("" when empty):
 * the saved value if there is one, otherwise the latest Discharge visit
 * that was Checked In or Checked Out.
 */
export function patientDischargeIso(
  patient: { id: string; fullName: string; matrix?: Partial<Record<string, string>> },
  index: DischargeIndex,
): string {
  return toIso(patientDischargeInfo(patient, index).date);
}

// ---------------------------------------------------------------------------
// "2 months, 22 days" — the spans the patient page shows next to the date.
// ---------------------------------------------------------------------------

function toUtcDate(value: string): Date | null {
  const iso = toIso(value ?? "");
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, day));
  if (shifted.getUTCDate() !== day) shifted.setUTCDate(0);
  return shifted;
}

/** Months + days from one date to another (null when either is missing or end < start). */
export function monthDaySpan(start: string, end: string): { months: number; days: number } | null {
  const a = toUtcDate(start);
  const b = toUtcDate(end);
  if (!a || !b || b < a) return null;
  let cursor = a;
  let months = 0;
  for (;;) {
    const next = addMonthsClamped(cursor, 1);
    if (next > b) break;
    cursor = next;
    months += 1;
  }
  return { months, days: Math.floor((b.getTime() - cursor.getTime()) / 86_400_000) };
}

export function formatMonthDaySpan(span: { months: number; days: number } | null): string {
  if (!span) return "-";
  return `${span.months} month${span.months === 1 ? "" : "s"}, ${span.days} day${span.days === 1 ? "" : "s"}`;
}
