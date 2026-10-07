/**
 * The patient's discharge date — one rule shared by the patient page
 * (Additional Details), Quick Glance and G.O.A.T.
 *
 * Additional Details stores a Discharge date (patients.matrix.discharge) that
 * is only ever typed in (or came from the CaseMate import). Nothing linked it
 * to the patient's Discharge visit on the schedule, so it stayed empty unless
 * someone typed it. This derives it at display time instead — nothing is
 * written to the patient record:
 *
 *  1. A date typed into Additional Details always wins (never overwritten).
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
  /** A typed date that differs from the attended Discharge visit. */
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
  // Anything typed counts as the user's own value — even half-typed, so the
  // field doesn't jump back to the visit date while they type.
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
