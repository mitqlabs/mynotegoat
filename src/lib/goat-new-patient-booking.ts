/**
 * "schedule john smith next thursday for initial appointment" when there's no John Smith yet:
 * G.O.A.T. adds them as a new patient in chat. Asks only for what's missing (phone, then
 * time, then day), one short question at a time, then shows ONE confirm card
 * (patient + New Patient visit). Pure and mock-testable; saving happens in the chat on Confirm.
 */
import { resolveRequestedDay, dayLabel } from "@/lib/goat-howto";
import { finishDraft, parseBookingTime, snapToOfficeHours, type BookingDraft } from "@/lib/goat-booking";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { ScheduleSettingsConfig } from "@/lib/schedule-settings";

export interface PendingNewPatientBooking {
  firstName: string;
  lastName: string;
  phone: string;
  date: string; // YYYY-MM-DD or ""
  time: string; // HH:MM or ""
  type: string;
  durationMin: number;
  notes: string[];
}

export interface NewPatientCard {
  firstName: string;
  lastName: string;
  phone: string;
  provider: string;
  location: string;
  draft: BookingDraft;
}

export type NewPatientStep =
  | { kind: "ask"; field: "phone" | "time" | "day"; say: string; pending: PendingNewPatientBooking }
  | { kind: "card"; card: NewPatientCard; say: string };

export interface NewPatientCtx {
  todayIso: string;
  settings: ScheduleSettingsConfig;
  appointments: ScheduleAppointmentRecord[];
  /** Appointment type names offered (the New Patient one is picked). */
  types: Array<{ name: string; durationMin: number }>;
  provider: string;
  location: string;
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export function newPatientType(types: Array<{ name: string; durationMin: number }>): { name: string; durationMin: number } {
  return types.find((t) => /new patient/i.test(t.name)) ?? types.find((t) => /initial|\bnp\b/i.test(t.name)) ?? { name: "New Patient", durationMin: 60 };
}

export function phoneIn(text: string): string {
  const d = (/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.exec(text)?.[0] ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : "";
}

function timeIn(text: string, date: string, ctx: NewPatientCtx): { time: string; note: string } | null {
  const t = parseBookingTime(text.replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, " "));
  if (!t) return null;
  return snapToOfficeHours(t, ctx.settings, date || ctx.todayIso);
}

function next(p: PendingNewPatientBooking, ctx: NewPatientCtx): NewPatientStep {
  const name = `${p.firstName} ${p.lastName}`;
  if (!p.phone) return { kind: "ask", field: "phone", say: `What's ${p.firstName}'s phone number?`, pending: p };
  if (!p.date) return { kind: "ask", field: "day", say: `What day for ${p.firstName}'s New Patient visit?`, pending: p };
  if (!p.time) return { kind: "ask", field: "time", say: `What time on ${dayLabel(p.date)}?`, pending: p };
  const draft = finishDraft({ patientId: "", patientName: `${p.lastName}, ${p.firstName}`, date: p.date, time: p.time, type: p.type, durationMin: p.durationMin, notes: p.notes }, ctx.appointments, ctx.settings);
  return { kind: "card", card: { firstName: p.firstName, lastName: p.lastName, phone: p.phone, provider: ctx.provider, location: ctx.location, draft }, say: `New patient ${name}, ${p.phone}. ${p.type} ${dayLabel(p.date)}?` };
}

/** First turn. `fullName` is the name typed ("John Smith"); `text` is the whole request. */
export function startNewPatientBooking(fullName: string, text: string, ctx: NewPatientCtx): NewPatientStep {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const t = newPatientType(ctx.types);
  const day = resolveRequestedDay(text, ctx.todayIso);
  const date = day?.iso ?? "";
  const tm = timeIn(text, date, ctx);
  const p: PendingNewPatientBooking = { firstName: cap(first), lastName: rest.map(cap).join(" "), phone: phoneIn(text), date, time: tm?.time ?? "", type: t.name, durationMin: t.durationMin, notes: tm?.note ? [tm.note] : [] };
  return next(p, ctx);
}

/** The answer to the last short question. Null when it doesn't answer it (ask again). */
export function continueNewPatientBooking(p: PendingNewPatientBooking, field: "phone" | "time" | "day", reply: string, ctx: NewPatientCtx): NewPatientStep | null {
  const q = { ...p, notes: [...p.notes] };
  // Any detail given (even out of order) is taken.
  const ph = phoneIn(reply);
  if (ph) q.phone = ph;
  const day = resolveRequestedDay(reply, ctx.todayIso);
  if (day) q.date = day.iso;
  const tm = timeIn(reply, q.date, ctx) ?? (field === "time" ? (() => { const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(reply); return m ? snapToOfficeHours({ hh: Number(m[1]), mm: Number(m[2] ?? 0), meridiem: null }, ctx.settings, q.date || ctx.todayIso) : null; })() : null);
  if (tm) { q.time = tm.time; if (tm.note) q.notes.push(tm.note); }
  const answered = field === "phone" ? Boolean(ph) : field === "day" ? Boolean(day) : Boolean(tm);
  if (!answered) return null;
  return next(q, ctx);
}
