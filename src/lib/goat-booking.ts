/**
 * G.O.A.T. booking (rules only, confirm first): "book kara tmrw 3" →
 * a draft (patient, type, day, time snapped to office hours), a slot check against the
 * schedule (2 open times before + 2 after when it's taken), and the record to save only
 * after the user clicks Confirm (saved through the regular appointment save path).
 */
import { editDistance } from "@/lib/goat-ai/global-chat";
import { dayLabel, resolveRequestedDay } from "@/lib/goat-howto";
import { appointmentTypeOptions, type ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { getOfficeHoursForDate, isAppointmentWithinOfficeHours, type ScheduleSettingsConfig } from "@/lib/schedule-settings";
import { to12hLabel } from "@/lib/time-12h";

export interface BookingPatient {
  id: string;
  fullName: string;
}

export interface BookingDraft {
  patientId: string;
  patientName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
  type: string;
  durationMin: number;
  /** Times that were assumed ("3" → 3:00 PM, within office hours). */
  notes: string[];
  /** Slot full or overlapping booked visits. */
  taken: boolean;
  outsideHours: boolean;
  /** Up to 2 open times before and 2 after (HH:MM). */
  suggestions: string[];
  override?: boolean;
}

const toMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const toHHMM = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** The time asked for: "at 3", "3pm", "3:30", "330p", "10 am", "noon". Null if none. */
export function parseBookingTime(question: string): { hh: number; mm: number; meridiem: "am" | "pm" | null } | null {
  const q = question.toLowerCase().replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ");
  if (/\bnoon\b/.test(q)) return { hh: 12, mm: 0, meridiem: "pm" };
  const re = /(?:\bat\s+|@\s*)?\b(\d{1,2})(?::(\d{2})|(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p)?(?![\w/])/g;
  let best: { hh: number; mm: number; meridiem: "am" | "pm" | null; score: number } | null = null;
  for (const m of q.matchAll(re)) {
    const hh = Number(m[1]);
    const mm = Number(m[2] ?? m[3] ?? 0);
    if (hh > 23 || mm > 59) continue;
    const mer = m[4] ? (m[4].startsWith("p") ? "pm" : "am") : null;
    const at = /^(at\s+|@)/.test(m[0]);
    const score = (mer ? 3 : 0) + (m[2] ? 2 : 0) + (at ? 2 : 0) + (m[3] ? 1 : 0);
    if (score === 0 && !/\b(book|schedul\w*|appt|appointment)\b/.test(q)) continue;
    if (score === 0 && /\b(weeks?|days?|months?|visits?|sessions?)\b/.test(q.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 10))) continue;
    if (!best || score > best.score) best = { hh, mm, meridiem: mer, score };
  }
  return best ? { hh: best.hh, mm: best.mm, meridiem: best.meridiem } : null;
}

/**
 * 12-hour time → 24h inside office hours: "3" means 3 PM in an 8–6 office, "9" means 9 AM.
 * Minutes are snapped to the appointment interval.
 */
export function snapToOfficeHours(t: { hh: number; mm: number; meridiem: "am" | "pm" | null }, settings: ScheduleSettingsConfig, dateIso: string): { time: string; note: string } {
  const interval = Math.max(5, settings.appointmentIntervalMin || 15);
  const snapMin = (n: number) => Math.round(n / interval) * interval;
  let hh = t.hh;
  let note = "";
  if (t.meridiem === "pm" && hh < 12) hh += 12;
  else if (t.meridiem === "am" && hh === 12) hh = 0;
  else if (!t.meridiem && hh >= 1 && hh <= 12) {
    const hours = getOfficeHoursForDate(settings, dateIso);
    const open = hours ? toMin(hours.start) : 8 * 60;
    const close = hours ? toMin(hours.end2 || hours.end) : 18 * 60;
    const am = (hh % 12) * 60 + t.mm;
    const pm = am + 12 * 60;
    const inAm = am >= open && am < close;
    const inPm = pm >= open && pm < close;
    hh = inAm && !inPm ? hh % 12 : inPm && !inAm ? (hh % 12) + 12 : hh < 7 || hh === 12 ? (hh === 12 ? 12 : hh + 12) : hh;
    note = `I read "${t.hh}${t.mm ? `:${String(t.mm).padStart(2, "0")}` : ""}" as ${to12hLabel(toHHMM(hh * 60 + t.mm))} (office hours).`;
  }
  let total = hh * 60 + t.mm;
  const snapped = snapMin(total);
  if (snapped !== total) {
    note = `${note ? `${note} ` : ""}Rounded to ${to12hLabel(toHHMM(snapped))} (${interval}-minute slots).`;
    total = snapped;
  }
  return { time: toHHMM(total), note };
}

/** "initial appointment", "initial", "new appt", "first visit", "NP", "eval", "new patient" → the New Patient type. */
export const NEW_PATIENT_ASK = /\bnew\s*(?:patient|pt|appt|appointment|visit|intake)s?\b|\binitial\b|\bfirst\s+(?:visit|appt|appointment)\b|\bnp\b|\b(?:new\s+patient\s+)?eval(?:uation)?\b|\bintake\b/i;

const TYPE_HINTS: Array<[RegExp, RegExp]> = [
  [/re-?exam|reeval|re-?eval/i, /re-?exam/i],
  [/decomp\w*/i, /decompression/i],
  [/discharg\w*/i, /discharge/i],
  [/follow[\s-]?up|f\/u|\bfu\b|regular|adjust\w*|treatment|tx\b/i, /follow-?up/i],
  [NEW_PATIENT_ASK, /new patient|initial|\bnp\b/i],
  [/consult\w*|office visit|\bov\b/i, /office visit|initial|new patient/i],
];

/** Appointment type from the request (typos ok), else the patient's last type, else Follow-Up Visit. */
export function bookingType(question: string, types: string[], lastType?: string): { type: string; guessed: boolean } {
  const all = [...new Set([...types, ...appointmentTypeOptions])];
  for (const [ask, pick] of TYPE_HINTS) {
    if (ask.test(question)) {
      const t = all.find((x) => pick.test(x));
      if (t) return { type: t, guessed: false };
    }
  }
  const ws = question.toLowerCase().split(/[^a-z-]+/).filter((w) => w.length >= 5);
  const fuzzy = all.find((t) => t.toLowerCase().split(/[^a-z-]+/).some((p) => p.length >= 5 && ws.some((w) => editDistance(w, p) <= 1)));
  if (fuzzy && !/^(visit|office)$/i.test(fuzzy)) return { type: fuzzy, guessed: false };
  return { type: lastType || all.find((x) => /follow-?up/i.test(x)) || all[0], guessed: true };
}

/** Booked (not canceled) visits overlapping [start, start+duration). */
export function overlapping(appts: ScheduleAppointmentRecord[], date: string, time: string, durationMin: number): ScheduleAppointmentRecord[] {
  const s = toMin(time);
  const e = s + durationMin;
  return appts.filter((a) => a.date === date && !/cancel|no.?show/i.test(a.status) && toMin(a.startTime) < e && toMin(a.startTime) + (a.durationMin || 15) > s);
}

export function slotTaken(appts: ScheduleAppointmentRecord[], settings: ScheduleSettingsConfig, date: string, time: string, durationMin: number, patientId?: string): boolean {
  const o = overlapping(appts, date, time, durationMin);
  if (patientId && o.some((a) => a.patientId === patientId)) return true; // this patient is already booked then
  return o.length >= Math.max(1, settings.maxAppointmentsPerSlot || 1);
}

/** Up to 2 open times before and 2 after, inside office hours. */
export function nearbyOpenTimes(appts: ScheduleAppointmentRecord[], settings: ScheduleSettingsConfig, date: string, time: string, durationMin: number, patientId?: string): string[] {
  const interval = Math.max(5, settings.appointmentIntervalMin || 15);
  const t = toMin(time);
  const free = (n: number) => n >= 0 && n < 24 * 60 && isAppointmentWithinOfficeHours(settings, date, toHHMM(n), durationMin) && !slotTaken(appts, settings, date, toHHMM(n), durationMin, patientId);
  const before: string[] = [];
  const after: string[] = [];
  for (let n = t - interval; n >= 0 && before.length < 2; n -= interval) if (free(n)) before.unshift(toHHMM(n));
  for (let n = t + interval; n < 24 * 60 && after.length < 2; n += interval) if (free(n)) after.push(toHHMM(n));
  return [...before, ...after];
}

/** The first open slot that day (from opening time), or null. For "book smith friday" with no time. */
export function firstOpenTime(appts: ScheduleAppointmentRecord[], settings: ScheduleSettingsConfig, date: string, durationMin: number, patientId?: string, from?: string): string | null {
  const interval = Math.max(5, settings.appointmentIntervalMin || 15);
  const hours = getOfficeHoursForDate(settings, date);
  const open = hours ? toMin(hours.start) : 9 * 60;
  const start = from ? Math.max(open, Math.ceil(toMin(from) / interval) * interval) : open;
  for (let n = start; n < 24 * 60; n += interval) {
    const t = toHHMM(n);
    if (isAppointmentWithinOfficeHours(settings, date, t, durationMin) && !slotTaken(appts, settings, date, t, durationMin, patientId)) return t;
  }
  return null;
}

export interface BookingInput {
  question: string;
  patient: BookingPatient;
  todayIso: string;
  appointments: ScheduleAppointmentRecord[];
  settings: ScheduleSettingsConfig;
  types?: string[];
}

export type BookingStep =
  | { kind: "needDay"; patient: BookingPatient; partial: Partial<BookingDraft> }
  | { kind: "needTime"; patient: BookingPatient; date: string; partial: Partial<BookingDraft> }
  | { kind: "draft"; draft: BookingDraft };

/** Build the draft (or say what's missing). Never saves anything. */
export function planBooking(input: BookingInput): BookingStep {
  const { question, patient, settings, appointments } = input;
  const mine = appointments.filter((a) => a.patientId === patient.id).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const last = mine[mine.length - 1];
  const { type, guessed } = bookingType(question, input.types ?? [], last?.appointmentType);
  const durationMin = last?.durationMin || Math.max(5, settings.appointmentIntervalMin || 15);
  const day = resolveRequestedDay(question, input.todayIso);
  const notes: string[] = [];
  if (guessed) notes.push(`Type: ${type} (${last ? "same as the last visit" : "default"}). Say another type to change it.`);
  if (!day) return { kind: "needDay", patient, partial: { type, durationMin } };
  if (day.note.includes(".")) notes.push(day.note);
  const t = parseBookingTime(question);
  // Action first: no time given → the first open slot that day ("morning"/"afternoon" → from 9 / 2), tweakable on the card.
  if (!t) {
    const part = /\bafternoon\b/i.test(question) ? "14:00" : /\bevening\b/i.test(question) ? "17:00" : undefined;
    const open = firstOpenTime(appointments, settings, day.iso, durationMin, patient.id, part);
    if (!open) return { kind: "needTime", patient, date: day.iso, partial: { type, durationMin, notes } };
    notes.push("First open time that day. Tap Different time to change it.");
    return { kind: "draft", draft: finishDraft({ patientId: patient.id, patientName: patient.fullName, date: day.iso, time: open, type, durationMin, notes }, appointments, settings) };
  }
  const snapped = snapToOfficeHours(t, settings, day.iso);
  if (snapped.note) notes.push(snapped.note);
  const draft = finishDraft({ patientId: patient.id, patientName: patient.fullName, date: day.iso, time: snapped.time, type, durationMin, notes }, appointments, settings);
  // Taken / outside hours → the nearest open time, said once; the asked time stays a chip.
  if ((draft.taken || draft.outsideHours) && draft.suggestions.length) {
    const near = [...draft.suggestions].sort((a, b) => Math.abs(toMin(a) - toMin(snapped.time)) - Math.abs(toMin(b) - toMin(snapped.time)))[0];
    const moved = finishDraft({ ...draft, time: near, notes: [...notes, `${to12hLabel(snapped.time)} ${draft.taken ? "was taken" : "is outside office hours"}, so the nearest open time.`] }, appointments, settings);
    // The asked time stays a chip (picking it shows the "book anyway" override).
    return { kind: "draft", draft: { ...moved, suggestions: [...draft.suggestions.filter((x) => x !== near), snapped.time].sort() } };
  }
  return { kind: "draft", draft };
}

/** Recheck a draft (after a time change): taken / outside hours / suggestions. */
export function finishDraft(d: Pick<BookingDraft, "patientId" | "patientName" | "date" | "time" | "type" | "durationMin" | "notes"> & { override?: boolean }, appointments: ScheduleAppointmentRecord[], settings: ScheduleSettingsConfig): BookingDraft {
  const taken = slotTaken(appointments, settings, d.date, d.time, d.durationMin, d.patientId);
  const outsideHours = !isAppointmentWithinOfficeHours(settings, d.date, d.time, d.durationMin);
  return { ...d, taken, outsideHours, suggestions: taken || outsideHours ? nearbyOpenTimes(appointments, settings, d.date, d.time, d.durationMin, d.patientId) : [] };
}

export function draftSummary(d: BookingDraft): string {
  const lines = [`Book ${d.patientName}: ${d.type}, ${dayLabel(d.date)} at ${to12hLabel(d.time)}?`];
  if (d.taken) lines.push(`That time is taken.${d.suggestions.length ? " Open nearby:" : ""}`);
  else if (d.outsideHours) lines.push(`That's outside office hours.${d.suggestions.length ? " Open times nearby:" : ""}`);
  return [...lines, ...d.notes].join("\n");
}

/** The appointment to save once the user clicks Confirm (same shape the Schedule saves). */
export function bookingRecord(d: BookingDraft, id: string, appointments: ScheduleAppointmentRecord[]): ScheduleAppointmentRecord {
  const last = appointments.filter((a) => a.patientId === d.patientId).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)).pop();
  return {
    id,
    patientId: d.patientId,
    patientName: d.patientName,
    provider: last?.provider ?? "",
    location: last?.location ?? "",
    appointmentType: d.type,
    caseLabel: last?.caseLabel ?? "",
    room: "",
    date: d.date,
    startTime: d.time,
    durationMin: d.durationMin,
    status: "Scheduled",
    note: "Booked with G.O.A.T.",
    overrideOfficeHours: Boolean(d.override && d.outsideHours),
  };
}

/** A changed time typed by the user ("4:15", "4p"), snapped like the request. */
export function retime(d: BookingDraft, text: string, appointments: ScheduleAppointmentRecord[], settings: ScheduleSettingsConfig): BookingDraft | null {
  const t = parseBookingTime(`at ${text}`);
  if (!t) return null;
  const s = snapToOfficeHours(t, settings, d.date);
  return finishDraft({ ...d, time: s.time, notes: s.note ? [s.note] : [], override: false }, appointments, settings);
}
