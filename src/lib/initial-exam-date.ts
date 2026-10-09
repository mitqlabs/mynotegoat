/**
 * The patient's Initial Exam date — "whatever date is in the Initial Exam
 * box" in Patient Info — one rule shared by every place that reads it.
 * Same approach as lib/discharge-date (PR #14): derived at display time,
 * nothing is written to the patient record.
 *
 *  1. A saved date in the Initial Exam box always wins (never overwritten).
 *  2. Otherwise: the EARLIEST New Patient visit the patient attended —
 *     appointment type contains "new patient" (any case, e.g. "Personal
 *     Injury New Patient", "Cash New Patient") and status Checked In or
 *     Checked Out, or a New Patient encounter note on that date (the note
 *     proves the visit happened). Canceled / No Show / Reschedule never count.
 *  3. A New Patient visit that is only Scheduled is NOT an initial exam date
 *     (the patient may not come). It's reported separately as "scheduled" so
 *     the UI can say so.
 *
 * The patient page passes the patient's encounter notes; list pages (Patients,
 * dashboard, weekly summary) don't load notes, so they use the schedule only.
 */

import { localTodayIso, nameKeys, normalizeName } from "@/lib/discharge-date";

export interface InitialExamAppointment {
  appointmentType: string;
  status: string;
  /** YYYY-MM-DD (schedule) or MM/DD/YYYY. */
  date: string;
}

export interface InitialExamNote {
  appointmentType: string;
  /** MM/DD/YYYY. */
  encounterDate: string;
}

export type InitialExamVisitStatus = "Checked In" | "Checked Out" | "Encounter note";

export interface InitialExamInfo {
  /** MM/DD/YYYY to show and use, or "" when there is none. */
  date: string;
  /** Where `date` came from. */
  source: "manual" | "visit" | "none";
  /** Earliest attended New Patient visit. */
  visit: { date: string; status: InitialExamVisitStatus } | null;
  /** Earliest New Patient visit that is still only Scheduled — only when none was attended. */
  scheduled: { date: string; past: boolean } | null;
  /** The saved date differs from the earliest attended New Patient visit. */
  differsFromVisit: boolean;
}

const NEW_PATIENT_TYPE = /new\s*patient/i;
const ATTENDED: Record<string, "Checked In" | "Checked Out"> = {
  "check out": "Checked Out",
  "checked out": "Checked Out",
  seen: "Checked Out",
  "check in": "Checked In",
  "checked in": "Checked In",
};

export function isNewPatientAppointmentType(type: string): boolean {
  return NEW_PATIENT_TYPE.test(type ?? "");
}

/** YYYY-MM-DD / M/D/YYYY / MM/DD/YY (optionally followed by text) → YYYY-MM-DD, or "". */
function toIso(value: string): string {
  const t = (value ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/.exec(t);
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
 * @param manual  The saved Initial Exam value (any of the stored formats).
 * @param appointments  This patient's schedule appointments.
 * @param notes  This patient's encounter notes (optional).
 * @param todayIso  Today as YYYY-MM-DD (local), to tell past from upcoming.
 */
export function resolveInitialExamDate(
  manual: string,
  appointments: InitialExamAppointment[],
  notes: InitialExamNote[] = [],
  todayIso: string = localTodayIso(),
): InitialExamInfo {
  let visitIso = "";
  let visitStatus: InitialExamVisitStatus = "Checked Out";
  let scheduledIso = "";
  const consider = (iso: string, status: InitialExamVisitStatus) => {
    // Earliest wins; on the same day a checked-in/out appointment beats a note.
    if (!visitIso || iso < visitIso || (iso === visitIso && visitStatus === "Encounter note" && status !== "Encounter note")) {
      visitIso = iso;
      visitStatus = status;
    }
  };
  for (const a of appointments ?? []) {
    if (!isNewPatientAppointmentType(a.appointmentType)) continue;
    const iso = toIso(a.date);
    if (!iso) continue;
    const status = (a.status ?? "").trim().toLowerCase();
    const attended = ATTENDED[status];
    if (attended) consider(iso, attended);
    else if (status === "scheduled" && (!scheduledIso || iso < scheduledIso)) scheduledIso = iso;
  }
  for (const n of notes ?? []) {
    if (!isNewPatientAppointmentType(n.appointmentType)) continue;
    const iso = toIso(n.encounterDate);
    if (iso) consider(iso, "Encounter note");
  }
  const visit = visitIso ? { date: toUs(visitIso), status: visitStatus } : null;
  const scheduled = !visit && scheduledIso ? { date: toUs(scheduledIso), past: scheduledIso < todayIso } : null;
  // Anything in the box counts as its value — even half-entered, so the
  // field doesn't jump back to the visit date while someone is typing.
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

// ---------------------------------------------------------------------------
// Every other reader (Patients list, dashboard, weekly summary, Case Flow,
// Encounters Quick Glance, G.O.A.T.) — the same date the Initial Exam box shows.
// ---------------------------------------------------------------------------

export interface InitialExamScheduleEntry extends InitialExamAppointment {
  patientId: string;
  patientName: string;
}

export interface InitialExamNoteEntry extends InitialExamNote {
  patientId: string;
  patientName?: string;
}

export interface InitialExamIndex {
  byId: Map<string, InitialExamAppointment[]>;
  byName: Map<string, InitialExamAppointment[]>;
  notesById: Map<string, InitialExamNote[]>;
}

/** Index the schedule's (and optionally the notes') New Patient visits once per page. */
export function buildInitialExamIndex(
  appointments: InitialExamScheduleEntry[],
  notes: InitialExamNoteEntry[] = [],
): InitialExamIndex {
  const byId = new Map<string, InitialExamAppointment[]>();
  const byName = new Map<string, InitialExamAppointment[]>();
  const notesById = new Map<string, InitialExamNote[]>();
  const push = <T,>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };
  for (const a of appointments ?? []) {
    if (!isNewPatientAppointmentType(a.appointmentType)) continue;
    const entry = { appointmentType: a.appointmentType, status: a.status, date: a.date };
    if (a.patientId) push(byId, a.patientId, entry);
    else {
      const key = normalizeName(a.patientName);
      if (key) push(byName, key, entry);
    }
  }
  for (const n of notes ?? []) {
    if (!n.patientId || !isNewPatientAppointmentType(n.appointmentType)) continue;
    push(notesById, n.patientId, { appointmentType: n.appointmentType, encounterDate: n.encounterDate });
  }
  return { byId, byName, notesById };
}

/** The full Initial Exam answer for a patient record (saved value + schedule). */
export function patientInitialExamInfo(
  patient: { id: string; fullName: string; matrix?: Partial<Record<string, string>> },
  index: InitialExamIndex,
  todayIso: string = localTodayIso(),
): InitialExamInfo {
  const appts = [...(index.byId.get(patient.id) ?? [])];
  if (index.byName.size) for (const key of nameKeys(patient.fullName)) appts.push(...(index.byName.get(key) ?? []));
  return resolveInitialExamDate(patient.matrix?.initialExam ?? "", appts, index.notesById.get(patient.id) ?? [], todayIso);
}

/** The date in the patient's Initial Exam box as YYYY-MM-DD ("" when empty). */
export function patientInitialExamIso(
  patient: { id: string; fullName: string; matrix?: Partial<Record<string, string>> },
  index: InitialExamIndex,
): string {
  return toIso(patientInitialExamInfo(patient, index).date);
}
