/**
 * New patient + first visit in ONE step on the existing New Patient form
 * (Patient List → New Patient): the "New Patient Evaluation" date/time books
 * the first appointment (the office's New Patient visit type, snapped to
 * office hours) and sets the Initial Exam date. G.O.A.T. "/new" parses pasted
 * call text into that same form. Pure helpers — the form does the saving.
 */
import { finishDraft, parseBookingTime, snapToOfficeHours } from "@/lib/goat-booking";
import { resolveRequestedDay } from "@/lib/goat-howto";
import { isNewPatientAppointmentType } from "@/lib/initial-exam-date";
import { formatUsPhoneInput } from "@/lib/phone-format";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { ScheduleSettingsConfig } from "@/lib/schedule-settings";

export interface IntakeDraft {
  lastName: string;
  firstName: string;
  phone: string;
  attorney: string;
  /** MM/DD/YYYY */
  dateOfInjury: string;
  nonPi: boolean;
  note: string;
  book: boolean;
  /** YYYY-MM-DD */
  apptDate: string;
  /** HH:MM 24h */
  apptTime: string;
  provider: string;
  locationId: string;
  appointmentType: string;
  durationMin: number;
}

/** The office's New Patient visit type (same test the Initial Exam date uses), else the default type. */
export function newPatientVisitType(types: Array<{ name: string; durationMin: number; isDefault?: boolean }>): { name: string; durationMin: number } | null {
  const t = types.find((x) => isNewPatientAppointmentType(x.name) && !/cash/i.test(x.name)) ?? types.find((x) => isNewPatientAppointmentType(x.name)) ?? types.find((x) => x.isDefault) ?? types[0];
  return t ? { name: t.name, durationMin: t.durationMin } : null;
}

const MDY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
export const mdyToIso = (v: string) => { const m = MDY.exec(v.trim()); return m ? `${m[3]}-${m[1]}-${m[2]}` : ""; };

/** The appointment check before Save: office hours / slot taken, with nearby open times. */
export function checkIntakeAppointment(d: Pick<IntakeDraft, "apptDate" | "apptTime" | "appointmentType" | "durationMin">, appointments: ScheduleAppointmentRecord[], settings: ScheduleSettingsConfig) {
  return finishDraft({ patientId: "__new__", patientName: "", date: d.apptDate, time: d.apptTime, type: d.appointmentType, durationMin: d.durationMin, notes: [] }, appointments, settings);
}

/** Typed "3", "3:30p", "10 am" → HH:MM snapped to office hours / the slot interval. */
export function intakeTime(text: string, dateIso: string, settings: ScheduleSettingsConfig): { time: string; note: string } | null {
  const t = parseBookingTime(`at ${text}`);
  return t ? snapToOfficeHours(t, settings, dateIso) : null;
}

// ---- Free text ("I have a new patient: …") → draft --------------------------

export interface ParsedIntake {
  draft: Partial<IntakeDraft>;
  /** Things the user should check (shown in the chat + on the form). */
  ask: string[];
}

const NAME_WORD = "[A-Z][a-zA-Z'’-]+";
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

function pastDate(m: RegExpExecArray, todayIso: string): string {
  const mo = m[1].padStart(2, "0");
  const da = m[2].padStart(2, "0");
  let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(todayIso.slice(0, 4));
  if (!m[3] && `${y}-${mo}-${da}` > todayIso) y -= 1;
  return `${mo}/${da}/${y}`;
}
const isoToMdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const addDaysIso = (iso: string, n: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export function parseIntakeText(raw: string, opts: { todayIso: string; attorneys?: string[]; settings?: ScheduleSettingsConfig }): ParsedIntake {
  const ask: string[] = [];
  const d: Partial<IntakeDraft> = {};
  let text = raw.replace(/\s+/g, " ").trim()
    .replace(/^\/new\b\s*/i, "")
    .replace(/^(hi|hey|hello)\b[,!.]?\s*/i, "")
    .replace(/^(i|we)\s+(have|got)\s+(a\s+)?new\s+(patient|pt)(\s+for\s+(you|u))?\s*[:,.!-]?\s*/i, "")
    .replace(/^new\s+(patient|pt)\s*[:,.!-]?\s*/i, "");
  const used: string[] = [];
  const take = (s: string) => { used.push(s); };

  // Phone
  const ph = /\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/.exec(text);
  if (ph) { d.phone = formatUsPhoneInput(ph[1] + ph[2] + ph[3]); take(ph[0]); }

  // Requested appointment ("appt tomorrow at 3", "can come in friday 10am", "book her 10/22 2:30")
  const ap = /(?:\b(?:she|he|they|pt)\s+)?(?:\b(?:can|could|will|wants? to|would like to)\s+)?\b(appt|appointment|come in|coming in|book(?: (?:him|her|them))?|schedule(?: (?:him|her|them))?|see (?:him|her|them)|wants? to come)\b([^.;]*)/i.exec(text);
  if (ap) {
    const tail = ap[2];
    const day = resolveRequestedDay(tail, opts.todayIso);
    const t = parseBookingTime(`book ${tail}`);
    if (day) {
      d.book = true;
      d.apptDate = day.iso;
      if (t && opts.settings) {
        const s = snapToOfficeHours(t, opts.settings, day.iso);
        d.apptTime = s.time;
        if (s.note) ask.push(s.note);
      } else ask.push("What time for the first appointment?");
      take(ap[0]);
    } else if (t) {
      ask.push("Which day for the first appointment?");
      take(ap[0]);
    }
  }

  // Date of injury: labeled, or an accident word near a date / yesterday
  const doiRe = /\b(?:doi|dol|date of (?:injury|loss|accident)|injured|accident|wreck|mva|crash|hurt|rear[- ]ended|hit)\b[^0-9]{0,25}?(?:on\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/i;
  const doi = doiRe.exec(text);
  if (doi) { d.dateOfInjury = pastDate(doi, opts.todayIso); take(doi[0]); }
  else {
    const rel = /\b(?:doi|accident|wreck|mva|crash|injured|hurt|rear[- ]ended|hit)\b[^.;]{0,25}?\b(yesterday|today|last night)\b/i.exec(text);
    if (rel) { d.dateOfInjury = isoToMdy(rel[1].toLowerCase() === "today" ? opts.todayIso : addDaysIso(opts.todayIso, -1)); take(rel[0]); }
    else {
      const bare = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text.replace(ap?.[0] ?? "\u0000", " "));
      if (bare) ask.push(`Is ${bare[0]} the date of injury?`);
    }
  }

  // Attorney: a known contact named in the text, else "atty/attorney/lawyer X"
  const lower = text.toLowerCase();
  const known = (opts.attorneys ?? []).filter((a) => a.trim().length >= 3 && lower.includes(a.toLowerCase()));
  const kw = /\b(?:atty|attorney|lawyer|law firm|represented by|rep(?:resented)? by|with attorney)\s*(?:is|:)?\s*([A-Za-z][\w&.'’ -]{1,40}?)(?=\s*(?:[,.;]|\b(?:doi|dol|phone|ph|cell|appt|appointment|accident|wreck|mva|note|she|he|they|wants?|can|call)\b|$))/i.exec(text);
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (known.length === 1) {
    d.attorney = known[0];
    const lab = new RegExp(`\\b(?:atty|attorney|lawyer|law firm|represented by)\\s*(?:is|:)?\\s*${esc(known[0])}`, "i").exec(text);
    take(lab ? lab[0] : (new RegExp(esc(known[0]), "i").exec(text)?.[0] ?? known[0]));
  }
  else if (known.length > 1) { d.attorney = known.sort((a, b) => b.length - a.length)[0]; ask.push(`Attorney: ${known.join(" or ")}?`); }
  else if (kw) {
    d.attorney = kw[1].trim();
    take(kw[0]);
    const fuzzy = (opts.attorneys ?? []).filter((a) => a.toLowerCase().includes(d.attorney!.toLowerCase()) || d.attorney!.toLowerCase().includes(a.toLowerCase().split(/\s+/)[0] ?? "\u0000"));
    if (fuzzy.length === 1) d.attorney = fuzzy[0];
    else if (fuzzy.length > 1) ask.push(`Attorney: ${fuzzy.slice(0, 3).join(" or ")}?`);
    else ask.push(`"${d.attorney}" isn't in Contacts — check the attorney name.`);
  }
  if (/\b(cash|self[- ]pay|no attorney|non[- ]?pi|not pi)\b/i.test(text)) { d.nonPi = true; d.attorney = d.attorney ?? ""; }

  // Name: "Last, First", "name is First Last", or the leading capitalised words
  let rest = text;
  for (const u of used) rest = rest.replace(u, " ");
  rest = rest.replace(/\s+/g, " ").trim();
  const named = /\b(?:name(?:'s| is)?|patient(?: is)?|pt(?: is)?)\s*:?\s*([A-Za-z'’-]+(?:\s+[A-Za-z'’-]+){0,2})/i.exec(rest);
  const comma = new RegExp(`^(${NAME_WORD}),\\s*(${NAME_WORD})\\b`).exec(rest);
  const lead = new RegExp(`^(${NAME_WORD})\\s+(${NAME_WORD})(?:\\s+(${NAME_WORD}))?\\b`).exec(rest);
  const lowerLead = /^([a-z][a-z'’-]+)\s+([a-z][a-z'’-]+)\b/.exec(rest);
  const STOP = /^(she|he|they|the|was|is|in|at|on|and|with|call|calling|called|needs?|wants?|can|has|had|from|for|her|his|rear|accident|wreck|mva|hurt|appt)$/i;
  let nameUsed = "";
  if (comma) { d.lastName = titleCase(comma[1]); d.firstName = titleCase(comma[2]); nameUsed = comma[0]; }
  else if (named && !STOP.test(named[1].split(/\s+/)[0])) {
    const ws = named[1].split(/\s+/).filter((w) => !STOP.test(w));
    if (ws.length >= 2) { d.firstName = titleCase(ws[0]); d.lastName = titleCase(ws[ws.length - 1]); if (ws.length === 3) ask.push(`Is the last name "${titleCase(ws[2])}" or "${titleCase(ws[1])} ${titleCase(ws[2])}"?`); }
    else if (ws.length === 1) { d.firstName = titleCase(ws[0]); ask.push("What's the last name?"); }
    nameUsed = named[0];
  } else if (lead && !STOP.test(lead[2])) {
    const third = lead[3] && !STOP.test(lead[3]) ? lead[3] : "";
    d.firstName = titleCase(lead[1]);
    d.lastName = titleCase(third || lead[2]);
    if (third) ask.push(`Is the last name "${titleCase(third)}" or "${titleCase(lead[2])} ${titleCase(third)}"?`);
    nameUsed = third ? lead[0] : `${lead[1]} ${lead[2]}`;
  } else if (lowerLead && !STOP.test(lowerLead[1]) && !STOP.test(lowerLead[2])) {
    d.firstName = titleCase(lowerLead[1]); d.lastName = titleCase(lowerLead[2]); nameUsed = lowerLead[0];
  }
  const lone = new RegExp(`^(${NAME_WORD})\\b`).exec(rest);
  if (!d.firstName && lone && !STOP.test(lone[1])) { d.firstName = titleCase(lone[1]); nameUsed = lone[0]; ask.push("What's the last name?"); }
  if (!d.firstName || !d.lastName) { if (!ask.includes("What's the last name?")) ask.unshift("What's the patient's name?"); }

  // Note: whatever is left (the call details)
  const note = (nameUsed ? rest.replace(nameUsed, " ") : rest)
    .replace(/\b(?:phone|ph|cell|number|#)\s*:?\s*(?=[,.;]|$)/gi, " ")
    .replace(/\s*([,;.])\s*(?=[,;.]|$)/g, "$1")
    .replace(/^[\s,;.:-]+|[\s,;:-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (note && /[a-z]{3,}/i.test(note)) d.note = note.replace(/^./, (c) => c.toUpperCase());
  return { draft: d, ask };
}

// ---- G.O.A.T. → New Patient form handoff ---------------------------------
export const NEW_PATIENT_PREFILL_KEY = "casemate.new-patient-prefill.v1";
export interface NewPatientPrefill { draft: Partial<IntakeDraft>; ask: string[]; at: number }
export function stashNewPatientPrefill(p: ParsedIntake) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(NEW_PATIENT_PREFILL_KEY, JSON.stringify({ ...p, at: Date.now() }));
}
/** Read once (and clear). Stale (> 10 min) prefills are ignored. */
export function takeNewPatientPrefill(): NewPatientPrefill | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(NEW_PATIENT_PREFILL_KEY);
  window.sessionStorage.removeItem(NEW_PATIENT_PREFILL_KEY);
  try {
    const v = raw ? (JSON.parse(raw) as NewPatientPrefill) : null;
    return v && Date.now() - v.at < 10 * 60_000 ? v : null;
  } catch {
    return null;
  }
}

/** The Schedule's case label: MMDDYY + first 2 of last + first 2 of first (DOI ISO, "Last, First"). */
export function scheduleCaseLabel(dateOfLossIso: string, fullName: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfLossIso);
  if (!m) return "";
  const [last = "", first = ""] = fullName.split(",").map((x) => x.trim());
  const two = (x: string) => x.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
  return `${m[2]}${m[3]}${m[1].slice(-2)}${two(last)}${two(first)}`;
}

/**
 * One provider and one location in this workspace (Office Settings holds a
 * single doctor and office name) → fill them into a new appointment / visit
 * so nobody has to pick. Never overwrites a value already there.
 */
export function officeDefaultsForDraft<T extends { provider: string; location: string }>(d: T, office: { doctorName?: string; officeName?: string }): T {
  return {
    ...d,
    provider: d.provider.trim() || (office.doctorName ?? "").trim(),
    location: d.location.trim() || (office.officeName ?? "").trim(),
  };
}

/** G.O.A.T.'s new-patient prefill → the New Appointment new-patient fields (blank keys ignored, phone formatted). */
export function newPtFromPrefill<T extends Record<string, string>>(empty: T, pre: Partial<Record<keyof T, string | undefined>> | undefined): T {
  const out = { ...empty };
  for (const k of Object.keys(empty) as Array<keyof T>) {
    const v = pre?.[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim() as T[keyof T];
  }
  if ("phone" in out && out.phone) {
    const d = String(out.phone).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (d.length === 10) (out as Record<string, string>).phone = `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return out;
}

/**
 * "+ Case" Appt Date + Time → the New Patient visit to book (patient page and New Patient popup).
 * Blank date → nothing to book. Already booked (same patient, day and time) → nothing new (no duplicate).
 * Bad date/time, outside office hours (when enforced) or a full slot → an error to show; never silent.
 */
export type CaseVisitPlan =
  | { kind: "none" }
  | { kind: "exists"; appointmentId: string }
  | { kind: "error"; message: string }
  | { kind: "book"; date: string; time: string; type: string; durationMin: number; note: string };

export function planCaseFirstVisit(
  input: { dateMdy: string; timeText: string; patientId?: string },
  appointments: ScheduleAppointmentRecord[],
  settings: ScheduleSettingsConfig,
  types: Array<{ name: string; durationMin: number; isDefault?: boolean }>,
): CaseVisitPlan {
  if (!input.dateMdy.trim()) return { kind: "none" };
  const iso = mdyToIso(input.dateMdy);
  if (!iso) return { kind: "error", message: "Appt Date must be MM/DD/YYYY." };
  if (!input.timeText.trim()) return { kind: "error", message: "Add the appointment time (e.g. 10:00 AM)." };
  const t = intakeTime(input.timeText, iso, settings);
  if (!t) return { kind: "error", message: "Appointment time should look like 10:00 AM." };
  const type = newPatientVisitType(types);
  if (!type) return { kind: "error", message: "No appointment types are set up (Settings → Schedule)." };
  if (input.patientId) {
    const same = appointments.find((a) => a.patientId === input.patientId && a.date === iso && a.startTime === t.time && a.status !== "Canceled");
    if (same) return { kind: "exists", appointmentId: same.id };
  }
  const check = finishDraft({ patientId: input.patientId ?? "__new__", patientName: "", date: iso, time: t.time, type: type.name, durationMin: type.durationMin, notes: [] }, appointments, settings);
  const fmt = (x: string) => { const [h, m] = x.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  if (check.outsideHours && settings.enforceOfficeHours) return { kind: "error", message: `${fmt(t.time)} is outside office hours that day.${check.suggestions.length ? ` Open: ${check.suggestions.map(fmt).join(", ")}.` : ""}` };
  if (check.taken) return { kind: "error", message: `${fmt(t.time)} is taken.${check.suggestions.length ? ` Open nearby: ${check.suggestions.map(fmt).join(", ")}.` : ""}` };
  return { kind: "book", date: iso, time: t.time, type: type.name, durationMin: type.durationMin, note: t.note };
}
