/**
 * G.O.A.T. quick schedule / case changes from one message (rules only):
 * reschedule, cancel, check in, check out, no-show, date of injury.
 * planQuick() picks the visit and builds the one-line confirm card. It never
 * saves; the chat applies the change only after Confirm, through the
 * Schedule's / patient record's own cloud-backed save paths.
 */
import { finishDraft, nearbyOpenTimes } from "@/lib/goat-booking";
import { dayLabel } from "@/lib/goat-howto";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { ScheduleSettingsConfig } from "@/lib/schedule-settings";
import { to12hLabel } from "@/lib/time-12h";
import { nameParts, type Understood } from "@/lib/goat-understand";

export type QuickKind = "reschedule" | "cancel" | "checkIn" | "checkOut" | "noShow" | "doi";

export interface QuickPlan {
  kind: QuickKind;
  patientId: string;
  patientName: string;
  appointmentId?: string;
  /** Reschedule target. */
  date?: string;
  time?: string;
  /** Date of injury (YYYY-MM-DD). */
  doi?: string;
  summary: string;
  /** Extra line under the summary ("4:00 PM was taken, so 4:15"). */
  note?: string;
  /** Other open times for a reschedule (tap to use). */
  options?: string[];
}

const LIVE = (s: string) => !/cancel|no show|check out|reschedul/i.test(s);
const when = (a: { date: string; startTime: string }) => `${dayLabel(a.date)} at ${to12hLabel(a.startTime)}`;
const us = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

export function planQuick(
  u: Understood,
  input: { today: string; appointments: ScheduleAppointmentRecord[]; settings: ScheduleSettingsConfig; currentDoi?: string },
): QuickPlan | { say: string } {
  const p = u.patient;
  if (!p) return { say: u.ask ?? "Which patient?" };
  const name = nameParts(p.fullName).display;
  const first = nameParts(p.fullName).first || name;
  const kind = u.action as QuickKind;
  if (kind === "doi") {
    if (!u.date) return { say: "What's the date of injury?" };
    const was = input.currentDoi ? ` (was ${us(input.currentDoi)})` : "";
    return { kind, patientId: p.id, patientName: p.fullName, doi: u.date.iso, summary: `Set ${name}'s date of injury to ${us(u.date.iso)}?${was}` };
  }
  const mine = input.appointments.filter((a) => a.patientId === p.id).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const today = mine.filter((a) => a.date === input.today);
  let appt: ScheduleAppointmentRecord | undefined;
  if (kind === "checkIn" || kind === "noShow") appt = today.find((a) => a.status === "Scheduled") ?? today.find((a) => LIVE(a.status));
  else if (kind === "checkOut") appt = today.find((a) => a.status === "Check In") ?? today.find((a) => LIVE(a.status));
  else {
    const upcoming = mine.filter((a) => a.date >= input.today && LIVE(a.status));
    // "cancel smith friday" → Friday's visit (else the next one).
    appt =
      kind === "cancel" && u.date
        ? upcoming.find((a) => a.date === u.date!.iso) ?? upcoming[0]
        : kind === "reschedule" && u.fromDate
          ? upcoming.find((a) => a.date === u.fromDate) ?? upcoming[0]
          : upcoming[0];
  }
  if (!appt) {
    const where = kind === "checkIn" || kind === "checkOut" || kind === "noShow" ? "today" : "coming up";
    return { say: `${first} has no visit ${where}.` };
  }
  const what = `${appt.appointmentType || "visit"}`;
  if (kind === "cancel") return { kind, patientId: p.id, patientName: p.fullName, appointmentId: appt.id, summary: `Cancel ${name}'s ${what} on ${when(appt)}?` };
  if (kind === "checkIn") return { kind, patientId: p.id, patientName: p.fullName, appointmentId: appt.id, summary: `Check in ${name} (${to12hLabel(appt.startTime)} ${what})?` };
  if (kind === "checkOut") return { kind, patientId: p.id, patientName: p.fullName, appointmentId: appt.id, summary: `Check out ${name} (${to12hLabel(appt.startTime)} ${what})?` };
  if (kind === "noShow") return { kind, patientId: p.id, patientName: p.fullName, appointmentId: appt.id, summary: `Mark ${name} a no-show for ${when(appt)}?` };
  // Reschedule: new day and/or time; whatever isn't said stays the same.
  const date = u.date?.iso ?? appt.date;
  let time = u.time?.hhmm ?? appt.startTime;
  const others = input.appointments.filter((a) => a.id !== appt!.id);
  const check = finishDraft({ patientId: p.id, patientName: p.fullName, date, time, type: appt.appointmentType, durationMin: appt.durationMin || 15, notes: [] }, others, input.settings);
  let note: string | undefined;
  let options: string[] = [];
  if (check.taken || check.outsideHours) {
    const near = nearbyOpenTimes(others, input.settings, date, time, appt.durationMin || 15, p.id);
    if (near.length) {
      const best = [...near].sort((a, b) => Math.abs(min(a) - min(time)) - Math.abs(min(b) - min(time)))[0];
      note = `${to12hLabel(time)} ${check.taken ? "was taken" : "is outside office hours"}, so the nearest open time.`;
      options = near.filter((x) => x !== best);
      time = best;
    } else note = `${to12hLabel(time)} ${check.taken ? "is taken" : "is outside office hours"}.`;
  }
  return { kind, patientId: p.id, patientName: p.fullName, appointmentId: appt.id, date, time, note, options, summary: `Move ${name}'s ${what} from ${when(appt)} to ${dayLabel(date)} at ${to12hLabel(time)}?` };
}

const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
