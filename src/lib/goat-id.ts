/**
 * G.O.A.T. ID reading — pure helpers (no browser APIs, fully testable).
 *
 * From a driver's license / state ID we take ONLY: Last name, First name, DOB,
 * Sex and Address (street, unit, city, state, ZIP). License number, height,
 * eyes, expiry etc. are never read into the patient record.
 *
 * 1. Back of the card: the PDF417 barcode holds an AAMVA record (exact data).
 * 2. No barcode: OCR text from the front, parsed field by field, each with a
 *    confidence ("read" vs "check") so nothing is guessed silently.
 */
import { composeAddressParts, parseAddressString } from "@/lib/address-parts";
import { dayLabel, resolveRequestedDay } from "@/lib/goat-howto";
import { finishDraft, parseBookingTime, snapToOfficeHours, type BookingDraft } from "@/lib/goat-booking";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { ScheduleSettingsConfig } from "@/lib/schedule-settings";

export type IdField = "lastName" | "firstName" | "dob" | "sex" | "street" | "unit" | "city" | "state" | "zip";
export const ID_FIELDS: IdField[] = ["lastName", "firstName", "dob", "sex", "street", "unit", "city", "state", "zip"];
export const ID_FIELD_LABEL: Record<IdField, string> = {
  lastName: "Last name",
  firstName: "First name",
  dob: "DOB",
  sex: "Sex",
  street: "Street",
  unit: "Unit",
  city: "City",
  state: "State",
  zip: "ZIP",
};

/** "exact" = from the barcode; "read" = OCR with a clear label; "check" = OCR guess the user must check. */
export type IdConfidence = "exact" | "read" | "check";
export interface IdValue { value: string; confidence: IdConfidence }
export interface IdRead {
  source: "barcode" | "ocr";
  /** Only the fields that were found. DOB is MM/DD/YYYY, sex is Male/Female/Other. */
  fields: Partial<Record<IdField, IdValue>>;
  /** Plain notes for the card ("DOB not found — please type it"). */
  notes: string[];
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/\bMc([a-z])/g, (_m, c: string) => `Mc${c.toUpperCase()}`).trim();
const streetCase = (s: string) => titleCase(s).replace(/\b(Ne|Nw|Se|Sw|Po)\b/g, (x) => x.toUpperCase());

function validMdy(mm: number, dd: number, yyyy: number): boolean {
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yyyy >= 1900 && yyyy <= 2100)) return false;
  const d = new Date(yyyy, mm - 1, dd);
  return d.getMonth() === mm - 1 && d.getDate() === dd;
}
const mdy = (mm: number, dd: number, yyyy: number) => `${String(mm).padStart(2, "0")}/${String(dd).padStart(2, "0")}/${yyyy}`;

/** AAMVA 8-digit date: MMDDCCYY (US) or CCYYMMDD (Canada); picks the one that's a real date. */
export function aamvaDate(raw: string, canada = false): string {
  const s = raw.replace(/\D/g, "");
  if (s.length !== 8) return "";
  const us = { mm: +s.slice(0, 2), dd: +s.slice(2, 4), y: +s.slice(4) };
  const ca = { y: +s.slice(0, 4), mm: +s.slice(4, 6), dd: +s.slice(6) };
  const order = canada ? [ca, us] : [us, ca];
  for (const o of order) if (validMdy(o.mm, o.dd, o.y)) return mdy(o.mm, o.dd, o.y);
  return "";
}

/** True when decoded barcode text is an AAMVA DL/ID record. */
export function isAamva(text: string): boolean {
  return /ANSI\s*\d{6}|AAMVA/.test(text) || (/\bDCS/.test(text) && /\bDBB/.test(text));
}

/**
 * Parse the AAMVA text from the PDF417 barcode. Element ids (3 letters) start
 * each line; older versions use DAA (full name) / DAB / DAC.
 */
export function parseAamva(text: string): IdRead | null {
  if (!isAamva(text)) return null;
  const canada = /ANSI\s*(6043|6046|6047|6048|6049|6050|6051|6052|6053|6054|6055|6056|6057|6058|6059|6060|6061)/.test(text);
  const el = new Map<string, string>();
  // Lines are separated by LF / CR / RS; the first element of the subfile follows "DL"/"ID".
  // Readers in "escaped" text mode spell control characters as <LF>, <RS>, <CR>.
  const body = text.replace(/<(LF|CR|RS|GS)>/g, "\n").replace(/\r\n?/g, "\n").replace(/[\x1d\x1e]/g, "\n");
  for (const rawLine of body.split("\n")) {
    let line = rawLine.trim();
    const sub = /(?:^|[^A-Z])(?:DL|ID)(D[A-Z]{2}.*)$/.exec(line);
    if (sub && !/^D[A-Z]{2}/.test(line)) line = sub[1];
    const m = /^(D[A-Z]{2})(.*)$/.exec(line);
    if (m && !el.has(m[1])) el.set(m[1], m[2].trim());
  }
  const v = (k: string) => {
    const x = (el.get(k) ?? "").trim();
    return /^(NONE|UNAVL|UNAVAIL|N\/A)$/i.test(x) ? "" : x;
  };
  let last = v("DCS") || v("DAB");
  let first = v("DAC") || v("DCT");
  if (!last && v("DAA")) {
    // DAA "LAST,FIRST,MIDDLE" (or "LAST FIRST")
    const parts = v("DAA").split(/[,$]/).map((x) => x.trim()).filter(Boolean);
    last = parts[0] ?? "";
    first = first || parts[1] || "";
  }
  // DCT in v1 can be "FIRST MIDDLE" or "FIRST,MIDDLE": keep the first name only.
  first = first.split(/[,$]/)[0].trim();
  if (/\s/.test(first) && !v("DAC")) first = first.split(/\s+/)[0];
  const fields: IdRead["fields"] = {};
  const put = (k: IdField, val: string) => { if (val) fields[k] = { value: val, confidence: "exact" }; };
  put("lastName", titleCase(last));
  put("firstName", titleCase(first));
  put("dob", aamvaDate(v("DBB"), canada));
  const sex = v("DBC");
  put("sex", sex === "1" || /^M/i.test(sex) ? "Male" : sex === "2" || /^F/i.test(sex) ? "Female" : sex === "9" ? "Other" : "");
  put("street", streetCase(v("DAG")));
  put("unit", streetCase(v("DAH")));
  put("city", titleCase(v("DAI")));
  put("state", v("DAJ").toUpperCase().slice(0, 2));
  const zip = v("DAK").replace(/[^0-9]/g, "");
  put("zip", zip.slice(0, 5));
  const notes = ID_FIELDS.filter((k) => k !== "unit" && !fields[k]).map((k) => `${ID_FIELD_LABEL[k]} wasn't in the barcode — please type it.`);
  return { source: "barcode", fields, notes };
}

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));

/** OCR text that looks like the front of a license / ID card. */
export function looksLikeIdFront(text: string): boolean {
  const t = text.toUpperCase();
  let score = 0;
  if (/DRIVER'?S?\s*LICEN[CS]E|IDENTIFICATION\s*CARD|\bID\s*CARD\b|\bREAL\s*ID\b/.test(t)) score += 2;
  if (/\bDOB\b|DATE OF BIRTH/.test(t)) score += 1;
  if (/\b(LN|FN)\b/.test(t)) score += 1;
  if (/\bEXP\b|\bISS\b|\bCLASS\b|\bHGT\b|\bEYES\b/.test(t)) score += 1;
  if (/\bSEX\s*[:.]?\s*[MF]\b/.test(t)) score += 1;
  return score >= 2;
}

/**
 * Parse front-of-ID OCR text. Labeled fields (LN, FN, DOB, SEX) are "read";
 * anything found by position (address lines, unlabeled names) is "check".
 */
export function parseIdFront(text: string): IdRead {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const up = lines.map((l) => l.toUpperCase());
  const fields: IdRead["fields"] = {};
  const put = (k: IdField, value: string, confidence: IdConfidence) => { if (value && !fields[k]) fields[k] = { value, confidence }; };
  const NAME = "([A-Z][A-Z'’ -]{0,40}?)";
  const lnIdx = up.findIndex((l) => new RegExp(`^(?:\\d\\s*)?LN\\b[:. ]*${NAME}$`).test(l));
  const fnIdx = up.findIndex((l) => new RegExp(`^(?:\\d\\s*)?FN\\b[:. ]*${NAME}$`).test(l));
  if (lnIdx >= 0) put("lastName", titleCase(up[lnIdx].replace(/^(?:\d\s*)?LN\b[:. ]*/, "")), "read");
  if (fnIdx >= 0) put("firstName", titleCase(up[fnIdx].replace(/^(?:\d\s*)?FN\b[:. ]*/, "").split(" ")[0]), "read");
  const dob = /(?:DOB|DATE OF BIRTH|BIRTH)\b[:. ]*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(up.join("\n"));
  if (dob && validMdy(+dob[1], +dob[2], +dob[3])) put("dob", mdy(+dob[1], +dob[2], +dob[3]), "read");
  const sex = /\bSEX\b[:. ]*([MFX])\b/.exec(up.join("\n"));
  if (sex) put("sex", sex[1] === "M" ? "Male" : sex[1] === "F" ? "Female" : "Other", "read");
  // City, ST 12345 line; the street is the line just above it.
  const cityRe = /^([A-Z][A-Z .'-]{1,30}?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/;
  const cIdx = up.findIndex((l) => { const m = cityRe.exec(l); return Boolean(m && US_STATES.has(m[2])); });
  if (cIdx >= 0) {
    const m = cityRe.exec(up[cIdx])!;
    put("city", titleCase(m[1]), "check");
    put("state", m[2], "check");
    put("zip", m[3], "check");
    const prev = up[cIdx - 1] ?? "";
    if (/^\d+\s+[A-Z0-9]/.test(prev)) {
      const unit = /\s+((?:APT|UNIT|STE|SUITE|#)\s*\S+)$/.exec(prev);
      put("street", streetCase(unit ? prev.slice(0, unit.index) : prev), "check");
      if (unit) put("unit", streetCase(unit[1]), "check");
    }
  }
  // No LN/FN labels: an all-caps "LAST, FIRST" line is a guess to check.
  if (!fields.lastName) {
    const nm = up.map((l) => /^([A-Z'’-]{2,}),\s*([A-Z'’-]{2,})(?:\s+[A-Z.]+)?$/.exec(l)).find(Boolean);
    if (nm) { put("lastName", titleCase(nm[1]), "check"); put("firstName", titleCase(nm[2]), "check"); }
  }
  const notes: string[] = [];
  const missing = ID_FIELDS.filter((k) => k !== "unit" && !fields[k]);
  if (missing.length) notes.push(`Couldn't read: ${missing.map((k) => ID_FIELD_LABEL[k]).join(", ")}. Please type ${missing.length === 1 ? "it" : "them"} in.`);
  if (Object.values(fields).some((f) => f?.confidence === "check")) notes.push("Fields marked \u201ccheck\u201d were read from the picture — make sure they're right.");
  return { source: "ocr", fields, notes };
}

/** "MM/DD/YYYY" → "YYYY-MM-DD" ("" when not a date). */
export const mdyIso = (v: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim()); return m ? `${m[3]}-${m[1]}-${m[2]}` : ""; };
const isoMdy = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? ""); return m ? `${m[2]}/${m[3]}/${m[1]}` : ""; };

export function idAddress(f: Partial<Record<IdField, string>>): string {
  return composeAddressParts({ address1: f.street ?? "", address2: f.unit ?? "", city: f.city ?? "", state: f.state ?? "", zip: f.zip ?? "" });
}
export const idValues = (r: IdRead): Partial<Record<IdField, string>> =>
  Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, v!.value])) as Partial<Record<IdField, string>>;

export interface IdPatientLike { id: string; fullName: string; dob?: string; sex?: string; address?: string; deleted?: boolean }

const normName = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Patients whose last AND first name match the ID (never first name only). DOB, when both have one, must agree. */
export function matchIdPatients<T extends IdPatientLike>(f: Partial<Record<IdField, string>>, patients: T[]): T[] {
  const last = normName(f.lastName ?? "");
  const first = normName(f.firstName ?? "");
  if (!last || !first) return [];
  const dob = mdyIso(f.dob ?? "");
  return patients.filter((p) => {
    if (p.deleted) return false;
    const [pl = "", pf = ""] = p.fullName.split(",").map((x) => x.trim());
    if (normName(pl) !== last) return false;
    const pfn = normName(pf.split(/\s+/)[0] ?? "");
    if (pfn !== first) return false;
    return !(dob && p.dob && p.dob.slice(0, 10) !== dob);
  });
}

export type IdPatchKey = "dob" | "sex" | "address";
export interface IdUpdatePlan {
  /** Blank on the patient → filled from the ID. */
  fills: Array<{ key: IdPatchKey; label: string; value: string }>;
  /** Different on the patient: the user picks (default keeps what's there). */
  conflicts: Array<{ key: IdPatchKey; label: string; current: string; fromId: string }>;
  same: IdPatchKey[];
}

/** Update an existing patient: fill blanks only; differences are conflicts to choose, never overwritten silently. */
export function planIdUpdate(p: IdPatientLike, f: Partial<Record<IdField, string>>): IdUpdatePlan {
  const plan: IdUpdatePlan = { fills: [], conflicts: [], same: [] };
  const consider = (key: IdPatchKey, label: string, current: string, fromId: string, eq: (a: string, b: string) => boolean) => {
    if (!fromId) return;
    if (!current.trim() || current.trim() === "-") plan.fills.push({ key, label, value: fromId });
    else if (eq(current, fromId)) plan.same.push(key);
    else plan.conflicts.push({ key, label, current, fromId });
  };
  consider("dob", "DOB", isoMdy(p.dob ?? ""), f.dob ?? "", (a, b) => a === b);
  consider("sex", "Sex", p.sex ?? "", f.sex ?? "", (a, b) => a.toLowerCase() === b.toLowerCase());
  const addr = idAddress(f);
  const addrKey = (s: string) => { const a = parseAddressString(s); return `${a.address1}|${a.zip}`.toLowerCase().replace(/[^a-z0-9|]/g, ""); };
  consider("address", "Address", p.address ?? "", addr, (a, b) => addrKey(a) === addrKey(b));
  return plan;
}

/** The patient patch from a plan and the user's conflict picks (true = use the ID value). */
export function idPatch(plan: IdUpdatePlan, useId: Partial<Record<IdPatchKey, boolean>>): { dob?: string; sex?: "Male" | "Female" | "Other"; address?: string } {
  const out: { dob?: string; sex?: "Male" | "Female" | "Other"; address?: string } = {};
  const set = (k: IdPatchKey, v: string) => {
    if (k === "dob") out.dob = mdyIso(v);
    else if (k === "sex") out.sex = v as "Male" | "Female" | "Other";
    else out.address = v;
  };
  for (const f of plan.fills) set(f.key, f.value);
  for (const c of plan.conflicts) if (useId[c.key]) set(c.key, c.fromId);
  return out;
}

// ---------------------------------------------------------------------------
// What the user typed with the picture ("add this new patient wednesday 1pm").
// ---------------------------------------------------------------------------

export interface IdRequest {
  /** "new patient" / "new pt" / "add this patient": create a patient. */
  newPatient: boolean;
  /** "new patient" wording also means a New Patient appointment when a day is given. */
  book: boolean;
  date?: string;
  time?: string;
  /** Time assumed ("1" → 1:00 PM) or snapped to office hours. */
  timeNote?: string;
  dayNote?: string;
  /** A day was given without a time (or the reverse): ask. */
  askTime?: boolean;
  askDay?: boolean;
  /** A patient's name typed with the picture ("update john smith"). */
  phone?: string;
}

export function parseIdRequest(text: string, todayIso: string, settings?: ScheduleSettingsConfig): IdRequest {
  const t = (text ?? "").trim();
  const newPatient = /\bnew\s*(patient|pt|client)\b|\badd\s+(this|him|her|them|the)?\s*(as\s+)?(a\s+)?(new\s+)?(patient|pt)\b|\bnew\s+intake\b/i.test(t);
  const req: IdRequest = { newPatient, book: false };
  const ph = /\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/.exec(t);
  if (ph) req.phone = `(${ph[1]}) ${ph[2]}-${ph[3]}`;
  const noPhone = ph ? t.replace(ph[0], " ") : t;
  const day = resolveRequestedDay(noPhone, todayIso);
  const tm = parseBookingTime(noPhone.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " "));
  if (day || tm || /\b(appt|appointment|book|schedule)\b/i.test(t)) req.book = true;
  if (!req.book) return req;
  if (day) { req.date = day.iso; if (day.note && /I read/.test(day.note)) req.dayNote = day.note; }
  else req.askDay = true;
  if (tm && day && settings) {
    const s = snapToOfficeHours(tm, settings, day.iso);
    req.time = s.time;
    if (s.note) req.timeNote = s.note;
  } else if (tm && !day) {
    req.time = `${String(tm.meridiem === "pm" && tm.hh < 12 ? tm.hh + 12 : tm.hh).padStart(2, "0")}:${String(tm.mm).padStart(2, "0")}`;
  } else if (!tm) req.askTime = true;
  return req;
}

/** The New Patient visit draft for the confirm card (office hours + slot checks, nearby open times). */
export function idVisitDraft(
  input: { patientName: string; date: string; time: string; type: string; durationMin: number },
  appointments: ScheduleAppointmentRecord[],
  settings: ScheduleSettingsConfig,
): BookingDraft {
  return finishDraft({ patientId: "", patientName: input.patientName, date: input.date, time: input.time, type: input.type, durationMin: input.durationMin, notes: [] }, appointments, settings);
}

export const idVisitLabel = (date: string, time12: string) => `${dayLabel(date)} at ${time12}`;

/** A 10-digit US phone typed as the answer to "What's their phone?" (null when it isn't one). */
export function phoneAnswer(text: string): string | null {
  const d = text.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10 || text.replace(/[\d\s().+-]/g, "").length > 2) return null;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

export const MARITAL_CHIPS = ["Single", "Married", "Divorced", "Widowed"] as const;
export function maritalAnswer(text: string): string | null | "skip" {
  const t = text.trim().toLowerCase();
  if (/^(skip|none|n\/a|no|-|unknown|don'?t know|idk)$/.test(t)) return "skip";
  const hit = ["Single", "Married", "Divorced", "Separated", "Widowed", "Domestic Partner"].find((m) => t === m.toLowerCase() || (t.length >= 3 && m.toLowerCase().startsWith(t)));
  return hit ?? null;
}

// ---------------------------------------------------------------------------
// Generic screenshots: answer simple questions from the OCR text.
// ---------------------------------------------------------------------------

/** Lines of a screenshot's text that answer the question (phone, email, date, or matching words). */
export function answerFromText(text: string, question: string): string[] {
  const q = question.toLowerCase();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (/\b(phone|number|cell|call)\b/.test(q)) {
    const hits = [...text.matchAll(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g)].map((m) => m[0]);
    if (hits.length) return [...new Set(hits)];
  }
  if (/\bemail\b/.test(q)) {
    const hits = [...text.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].map((m) => m[0]);
    if (hits.length) return [...new Set(hits)];
  }
  if (/\b(date|when|dob|birthday)\b/.test(q)) {
    const hits = lines.filter((l) => /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(l));
    if (hits.length) return hits.slice(0, 6);
  }
  const STOP = new Set("what whats is the a an of on in it its this that does say says to for and or me my show tell about screenshot image picture pic there from".split(" "));
  const words = q.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return [];
  return lines.filter((l) => words.some((w) => l.toLowerCase().includes(w))).slice(0, 8);
}

/** "what does it say", "read it", "what's the phone on this" — a question about the picture just shared. */
export function isAboutScreenshot(question: string): boolean {
  return /\b(it|this|that|screenshot|image|picture|pic|photo|the text)\b/i.test(question) && /\b(what|which|read|find|show|say|says|phone|email|date|number|copy)\b/i.test(question);
}

// ---------------------------------------------------------------------------
// The chat card's state (stored on the chat message).
// ---------------------------------------------------------------------------

export interface IdCardState {
  mode: "new" | "update";
  source: "barcode" | "ocr";
  side?: "front" | "back";
  /** Editable values (start as what was read). */
  values: Partial<Record<IdField, string>>;
  confidence: Partial<Record<IdField, IdConfidence>>;
  notes: string[];
  phone: string;
  marital: string;
  /** update mode */
  patientId?: string;
  patientName?: string;
  plan?: IdUpdatePlan;
  useId: Partial<Record<IdPatchKey, boolean>>;
  /** New Patient appointment booked on Confirm (new mode, "new patient wednesday 1pm"). */
  visit?: { date: string; time: string; type: string; durationMin: number; provider: string; location: string; taken: boolean; outsideHours: boolean; suggestions: string[]; notes: string[]; override: boolean };
  saveId: boolean;
  /** The picture is kept in memory only until Confirm (lost on reload). */
  fileKey: string;
  state: "open" | "done" | "canceled";
  result?: string;
  savedPatientId?: string;
}

/** Waiting on the user before the card: phone (required), then marital status (optional). */
export type IdAsk = "phone" | "marital";

export interface BuildIdCardInput<T extends IdPatientLike> {
  read: IdRead;
  side?: "front" | "back";
  request: IdRequest;
  patients: T[];
  /** The patient page G.O.A.T. was opened on. */
  pagePatientId?: string | null;
  /** A patient named in the typed text (already matched by the caller). */
  namedPatientId?: string | null;
  appointments: ScheduleAppointmentRecord[];
  settings: ScheduleSettingsConfig;
  /** The office's New Patient visit type (newPatientVisitType). */
  visitType: { name: string; durationMin: number } | null;
  /** One provider / one location → picked automatically. */
  office: { provider: string; location: string };
  fileKey: string;
}

export interface BuiltIdCard {
  card: IdCardState;
  /** Asked one at a time before the card is shown (new patients only). */
  asks: IdAsk[];
  /** Lead line for the chat bubble. */
  lead: string;
}

/** Decide new vs update, plan the fields and the New Patient visit, and what to ask first. */
export function buildIdCard<T extends IdPatientLike>(input: BuildIdCardInput<T>): BuiltIdCard {
  const { read, request } = input;
  const values = idValues(read);
  const confidence = Object.fromEntries(Object.entries(read.fields).map(([k, v]) => [k, v!.confidence])) as IdCardState["confidence"];
  const notes = [...read.notes];
  const live = input.patients.filter((p) => !p.deleted);
  const byId = (id?: string | null) => (id ? live.find((p) => p.id === id) ?? null : null);
  const idMatches = matchIdPatients(values, live);
  let target: T | null = null;
  if (request.newPatient) {
    if (idMatches.length) {
      target = idMatches[0];
      notes.push(`${target.fullName} is already a patient (same name${values.dob ? " and DOB" : ""}), so I'll update them instead of adding a duplicate.`);
    }
  } else {
    target = byId(input.namedPatientId) ?? byId(input.pagePatientId) ?? idMatches[0] ?? null;
    if (target && values.lastName && !matchIdPatients(values, [target]).length) {
      notes.push(`Heads up: the ID says ${[values.firstName, values.lastName].filter(Boolean).join(" ")}, but this is ${target.fullName}. Check it's the right person.`);
    }
    if (!input.namedPatientId && !input.pagePatientId && idMatches.length > 1) notes.push(`${idMatches.length} patients match this name; showing ${target!.fullName}.`);
  }
  const base = { source: read.source, side: input.side, values, confidence, notes, phone: request.phone ?? "", marital: "", useId: {}, saveId: true, fileKey: input.fileKey, state: "open" as const };
  if (target) {
    const plan = planIdUpdate(target, values);
    if (request.book) notes.push("To book them, say e.g. \u201cbook them wednesday at 1\u201d after this.");
    return { card: { ...base, mode: "update", patientId: target.id, patientName: target.fullName, plan }, asks: [], lead: `Update ${target.fullName} with what's on the ID?` };
  }
  const card: IdCardState = { ...base, mode: "new" };
  const fullName = values.lastName && values.firstName ? `${values.lastName}, ${values.firstName}` : "New patient";
  if (request.book && request.date && request.time && input.visitType) {
    const d = idVisitDraft({ patientName: fullName, date: request.date, time: request.time, type: input.visitType.name, durationMin: input.visitType.durationMin }, input.appointments, input.settings);
    card.visit = { date: d.date, time: d.time, type: d.type, durationMin: d.durationMin, provider: input.office.provider, location: input.office.location, taken: d.taken, outsideHours: d.outsideHours, suggestions: d.suggestions, notes: [request.dayNote, request.timeNote].filter((x): x is string => Boolean(x)), override: false };
  } else if (request.book) {
    notes.push(request.askDay ? "Which day for the New Patient visit? Say e.g. \u201cwednesday at 1\u201d." : "What time for the New Patient visit? Say e.g. \u201cat 1pm\u201d.");
  }
  const asks: IdAsk[] = [];
  if (!card.phone) asks.push("phone");
  asks.push("marital");
  return { card, asks, lead: `Add new patient${card.visit ? " and book their New Patient visit" : ""}?` };
}

/** Apply a typed "wednesday 1pm" to an open new-patient card. */
export function withIdVisit(card: IdCardState, request: IdRequest, ctx: Pick<BuildIdCardInput<IdPatientLike>, "appointments" | "settings" | "visitType" | "office">): IdCardState | null {
  if (card.mode !== "new" || !request.date || !request.time || !ctx.visitType) return null;
  const fullName = card.values.lastName && card.values.firstName ? `${card.values.lastName}, ${card.values.firstName}` : "New patient";
  const d = idVisitDraft({ patientName: fullName, date: request.date, time: request.time, type: ctx.visitType.name, durationMin: ctx.visitType.durationMin }, ctx.appointments, ctx.settings);
  return { ...card, visit: { date: d.date, time: d.time, type: d.type, durationMin: d.durationMin, provider: ctx.office.provider, location: ctx.office.location, taken: d.taken, outsideHours: d.outsideHours, suggestions: d.suggestions, notes: [request.dayNote, request.timeNote].filter((x): x is string => Boolean(x)), override: false } };
}

/** The appointment saved on Confirm (same shape the Schedule saves). */
export function idVisitRecord(card: IdCardState, id: string, patientId: string, patientName: string): ScheduleAppointmentRecord | null {
  const v = card.visit;
  if (!v) return null;
  return { id, patientId, patientName, provider: v.provider, location: v.location, appointmentType: v.type, caseLabel: "", room: "", date: v.date, startTime: v.time, durationMin: v.durationMin, status: "Scheduled", note: "Booked with G.O.A.T. (new patient from ID)", overrideOfficeHours: Boolean(v.override && v.outsideHours) };
}
