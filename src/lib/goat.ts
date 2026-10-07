/**
 * G.O.A.T. — "ask about this patient".
 *
 * Answers questions by looking things up in what is already on the patient
 * page. There is no AI and no network call here: every answer is read directly
 * off a field, a list or a note, and each one says which section it came from.
 * If the page does not contain the answer, G.O.A.T. says so rather than guessing.
 *
 * Modelled on CaseMate's Lexi (keyword topics + a plain-text search), adapted
 * to NoteGoat's clinical data. The caller builds a GoatContext from the page's
 * live state; a section the signed-in member cannot see is passed as `null`
 * and G.O.A.T. will not read it.
 */

import { answerFromFiles, type GoatFile, type GoatFilesResult, type GoatPerson } from "@/lib/goat-docs";
import { groupsInQuestion, makeMatcher, type GoatTermGroup, type TermMatcher } from "@/lib/goat-terms";
import type { DischargeInfo } from "@/lib/discharge-date";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type GoatSection =
  | "info"
  | "notes"
  | "xray"
  | "mri"
  | "specialist"
  | "appointments"
  | "treatmentPlan"
  | "diagnosis"
  | "details";

export interface GoatAppointment {
  /** ISO YYYY-MM-DD */
  date: string;
  /** HH:MM (24h) */
  startTime: string;
  type: string;
  status: string;
}

export interface GoatEncounter {
  /** Encounter note id, so a hit can open that note. */
  id: string;
  /** MM/DD/YYYY */
  date: string;
  type: string;
  signed: boolean;
  /** Stored as editor HTML; G.O.A.T. reads it as plain text. */
  soap: { subjective: string; objective: string; assessment: string; plan: string };
  /** Macros run in the note (e.g. "Spinal Decompression") with their picked answers ("L5-S1"). */
  treatments: Array<{ name: string; answers: string[] }>;
  /** Charge names and codes only (no amounts). */
  charges: Array<{ name: string; code: string }>;
}

export interface GoatImaging {
  modality: string; // "X-Ray" | "MRI" | "CT"
  center: string;
  regions: string[];
  sentDate: string;
  scheduledDate: string;
  doneDate: string;
  reportReceivedDate: string;
  reportReviewedDate: string;
  findings: string;
  refused: boolean;
}

export interface GoatSpecialist {
  name: string;
  sentDate: string;
  scheduledDate: string;
  completedDate: string;
  reportReceivedDate: string;
  reportReviewedDate: string;
  recommendations: string;
  refused: boolean;
}

export interface GoatPlan {
  startDate: string;
  endDate: string;
  active: boolean;
  weekdays: string[];
  regions: string[];
}

export interface GoatContext {
  /** ISO YYYY-MM-DD, local. */
  today: string;
  patientName: string;
  dob: string;
  phone: string;
  email: string;
  address: string;
  alerts: string[];
  attorney: string;
  caseStatus: string;
  lien: string;
  review: string;
  isCashPatient: boolean;
  doi: string;
  initialExam: string;
  priorCare: string;
  xrayFindings: string;
  mriFindings: string;
  specialistRecommendations: string;
  imaging: GoatImaging[];
  specialists: GoatSpecialist[];
  /** null = section hidden for this member. */
  notes: string | null;
  appointments: GoatAppointment[] | null;
  encounters: GoatEncounter[] | null;
  plans: GoatPlan[] | null;
  diagnoses: Array<{ code: string; description: string }> | null;
  /** discharge: MM/DD/YYYY as the Discharge box shows it (saved, or from the Discharge visit). */
  details: { discharge: string; dischargeInfo?: DischargeInfo } | null;
  billing: { billed: string; paid: string; paidDate: string; rbSent: string } | null;
  /** The office's words & synonym groups (Settings → G.O.A.T.). */
  termGroups?: GoatTermGroup[];
  /** Referred specialists + Specialist contacts, for "PM" → the doctor. */
  people?: GoatPerson[];
  /** Uploaded Patient Files with their text once read; null = hidden for this member; undefined = not available here. */
  files?: GoatFile[] | null;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface GoatAnswer {
  title: string;
  lines: string[];
  /** Where the answer was read from, in words. */
  source: string;
  section: GoatSection;
  /** Something worth a second look, e.g. a gap or an unreviewed report. */
  flag?: string;
}

export interface GoatHit {
  kind: "Note" | "SOAP" | "X-Ray findings" | "MRI/CT findings" | "Specialist" | "Prior care" | "Alert";
  title: string;
  snippet: string;
  date: string | null;
  section: GoatSection;
  /** SOAP hits: the note it came from. */
  encounterId?: string;
  score: number;
}

export interface GoatResult {
  answers: GoatAnswer[];
  hits: GoatHit[];
  /** Words searched for (synonyms included), for highlighting. */
  terms: string[];
  /** Quotes from uploaded Patient Files, or null when files weren't asked about/available. */
  files: GoatFilesResult | null;
}

/** Breaks between visits shorter than this are normal scheduling. */
export const GOAT_GAP_DAYS = 14;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Days since epoch (UTC) for ISO or US dates; null when unreadable. */
export function dayStamp(value: string): number | null {
  const s = (value ?? "").trim();
  let y = 0;
  let m = 0;
  let d = 0;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (match) {
    y = +match[1];
    m = +match[2];
    d = +match[3];
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
    if (!match) return null;
    m = +match[1];
    d = +match[2];
    y = +match[3];
    if (y < 100) y += 2000;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fmtDay(stamp: number): string {
  const dt = new Date(stamp * 86_400_000);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${WEEKDAY[dt.getUTCDay()]} ${mm}/${dd}/${dt.getUTCFullYear()}`;
}

function relative(stamp: number, today: number): string {
  const diff = stamp - today;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

function fmtTime(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!match) return "";
  const h = +match[1];
  return `${h % 12 || 12}:${match[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** A typed date as shown on the page, or "—". */
function shown(value: string): string {
  const stamp = dayStamp(value);
  return stamp === null ? (value?.trim() || "—") : fmtDay(stamp);
}

function money(value: string): string {
  const n = Number.parseFloat(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n !== 0
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "";
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  "a an and are as at be been but by can did do does for from had has have her hers him his how i in is it its me my of on or our she so that the their them then there these they this to was we were what when where which who whom why will with you your any all about tell show give find get much many patient pt please".split(
    " ",
  ),
);

/** Words that only pick a topic — poor search terms on their own. */
const STEERING = new Set(
  "visit visits appointment appointments appt appts next last first recent previous upcoming gap gaps count times total date dates status plan treatment findings report reports".split(
    " ",
  ),
);

export function tokenize(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/x[\s-]?rays?/g, "xray")
    .replace(/mri\/ct|mri or ct/g, "mri ct")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Exact or plural match, or prefix match for keys of 4+ letters ("diagnos" → "diagnoses"). */
function has(tokens: string[], keys: string[]): boolean {
  return tokens.some((t) =>
    keys.some((k) => t === k || t === `${k}s` || (k.length >= 4 && t.startsWith(k))),
  );
}

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

const ATTENDED = new Set(["check in", "check out", "checked in", "checked out"]);
const UPCOMING = new Set(["scheduled", "reschedule"]);

function norm(status: string): string {
  return (status ?? "").trim().toLowerCase();
}

/** Unique days the patient was actually seen: checked-in/out appointments plus encounters. */
function attendedDays(ctx: GoatContext): number[] {
  const days = new Set<number>();
  for (const a of ctx.appointments ?? []) {
    if (!ATTENDED.has(norm(a.status))) continue;
    const s = dayStamp(a.date);
    if (s !== null) days.add(s);
  }
  for (const e of ctx.encounters ?? []) {
    const s = dayStamp(e.date);
    if (s !== null) days.add(s);
  }
  return [...days].sort((a, b) => a - b);
}

function upcoming(ctx: GoatContext, today: number): GoatAppointment[] {
  return (ctx.appointments ?? [])
    .filter((a) => UPCOMING.has(norm(a.status)) && (dayStamp(a.date) ?? -1) >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

function hidden(title: string, section: GoatSection): GoatAnswer {
  return {
    title,
    lines: ["That section is hidden for your account, so I can't read it."],
    source: "Hidden for your account",
    section,
  };
}

const APPTS_SOURCE = "Appointments / Encounters";

// ---------------------------------------------------------------------------
// Topic answers
// ---------------------------------------------------------------------------

function visitsAnswer(ctx: GoatContext, today: number, focus: "next" | "last" | "first" | null): GoatAnswer {
  if (ctx.appointments === null) return hidden("Visits", "appointments");
  const appts = ctx.appointments;
  const counts = { attended: 0, upcoming: 0, canceled: 0, noShow: 0, pastUnmarked: 0 };
  for (const a of appts) {
    const s = norm(a.status);
    const stamp = dayStamp(a.date) ?? 0;
    if (ATTENDED.has(s)) counts.attended++;
    else if (s === "canceled" || s === "cancelled") counts.canceled++;
    else if (s === "no show") counts.noShow++;
    else if (UPCOMING.has(s)) {
      if (stamp >= today) counts.upcoming++;
      else counts.pastUnmarked++;
    }
  }
  const days = attendedDays(ctx);
  const past = days.filter((d) => d <= today);
  const next = upcoming(ctx, today)[0];

  const parts = [
    `${counts.attended} attended`,
    counts.upcoming ? `${counts.upcoming} upcoming` : "",
    counts.canceled ? `${counts.canceled} canceled` : "",
    counts.noShow ? `${counts.noShow} no-show` : "",
    counts.pastUnmarked ? `${counts.pastUnmarked} past still marked Scheduled` : "",
  ].filter(Boolean);
  const summary = appts.length
    ? `${appts.length} appointment${appts.length === 1 ? "" : "s"} on file: ${parts.join(", ")}.`
    : "No appointments on file yet.";

  const lineFirst = past.length ? `First visit: ${fmtDay(past[0])} (${relative(past[0], today)}).` : "";
  const lineLast = past.length
    ? `Last visit: ${fmtDay(past[past.length - 1])} (${relative(past[past.length - 1], today)}).`
    : "No visits yet.";
  const lineNext = next
    ? `Next visit: ${fmtDay(dayStamp(next.date)!)}${next.startTime ? ` at ${fmtTime(next.startTime)}` : ""} (${relative(dayStamp(next.date)!, today)})${next.type ? ` — ${next.type}` : ""}.`
    : "Nothing scheduled ahead.";

  const enc = ctx.encounters;
  const lineEnc = enc
    ? `${enc.length} encounter${enc.length === 1 ? "" : "s"}: ${enc.filter((e) => e.signed).length} signed, ${enc.filter((e) => !e.signed).length} open.`
    : "";

  const ordered =
    focus === "next"
      ? [lineNext, lineLast, summary, lineFirst]
      : focus === "last"
        ? [lineLast, lineNext, summary, lineFirst]
        : focus === "first"
          ? [lineFirst, lineLast, lineNext, summary]
          : [summary, lineFirst, lineLast, lineNext];

  return {
    title: focus === "next" ? "Next visit" : focus === "last" ? "Last visit" : focus === "first" ? "First visit" : "Visits",
    lines: [...ordered, lineEnc].filter(Boolean),
    source: APPTS_SOURCE,
    section: "appointments",
    flag: counts.pastUnmarked
      ? `${counts.pastUnmarked} past appointment${counts.pastUnmarked === 1 ? " is" : "s are"} still marked Scheduled.`
      : !next && past.length
        ? "No visit is scheduled after the last one."
        : undefined,
  };
}

function gapsAnswer(ctx: GoatContext, today: number): GoatAnswer {
  if (ctx.appointments === null) return hidden("Gaps in care", "appointments");
  const days = attendedDays(ctx).filter((d) => d <= today);
  const lines: string[] = [];
  const doi = dayStamp(ctx.doi);
  if (doi !== null && days.length && days[0] - doi > GOAT_GAP_DAYS) {
    lines.push(`First visit was ${days[0] - doi} days after the date of injury (${fmtDay(doi)} → ${fmtDay(days[0])}).`);
  }
  for (let i = 1; i < days.length; i++) {
    const span = days[i] - days[i - 1];
    if (span > GOAT_GAP_DAYS) {
      lines.push(`${span} days with no visit: ${fmtDay(days[i - 1])} → ${fmtDay(days[i])}.`);
    }
  }
  const last = days[days.length - 1];
  if (last !== undefined && !upcoming(ctx, today).length && today - last > GOAT_GAP_DAYS) {
    lines.push(`${today - last} days since the last visit (${fmtDay(last)}), and nothing is scheduled.`);
  }
  if (!days.length) {
    return {
      title: "Gaps in care",
      lines: ["No visits yet, so there's nothing to measure."],
      source: APPTS_SOURCE,
      section: "appointments",
    };
  }
  return {
    title: "Gaps in care",
    lines: lines.length ? lines : [`No breaks longer than ${GOAT_GAP_DAYS} days across ${days.length} visits.`],
    source: `${APPTS_SOURCE} (checked-in/out visits and encounters)`,
    section: "appointments",
    flag: lines.length ? `Breaks longer than ${GOAT_GAP_DAYS} days are listed.` : undefined,
  };
}

function datesAnswer(ctx: GoatContext, today: number): GoatAnswer {
  const doi = dayStamp(ctx.doi);
  const ie = dayStamp(ctx.initialExam);
  const lines = [
    `Date of injury: ${doi === null ? "not entered" : `${fmtDay(doi)} (${relative(doi, today)})`}.`,
    `Initial exam: ${ie === null ? "not entered" : `${fmtDay(ie)}${doi !== null ? ` — ${ie - doi} days after the injury` : ""}`}.`,
  ];
  if (ctx.details) {
    const dc = dayStamp(ctx.details.discharge);
    const info = ctx.details.dischargeInfo;
    if (dc !== null) {
      const from =
        info?.source === "visit" && info.visit
          ? ` (date of the Discharge visit, ${info.visit.status.toLowerCase()})`
          : info?.differsFromVisit && info.visit
            ? ` (from the Discharge box, but the Discharge visit was ${info.visit.date})`
            : "";
      lines.push(`Discharged: ${fmtDay(dc)}${from}.`);
    } else if (info?.scheduled) {
      lines.push(
        info.scheduled.past
          ? `Discharge: the Discharge visit on ${info.scheduled.date} is still marked Scheduled (not checked in or out), so there's no discharge date yet.`
          : `Discharge visit scheduled for ${info.scheduled.date}; not discharged yet.`,
      );
    }
  }
  return { title: "Key dates", lines, source: "Patient info", section: "info" };
}

function imagingStatus(i: { sentDate: string; scheduledDate: string; reportReceivedDate: string; reportReviewedDate: string; refused: boolean }, done: string): { text: string; flag?: string } {
  if (i.refused) return { text: "patient refused" };
  if (dayStamp(i.reportReviewedDate) !== null) return { text: `report reviewed ${shown(i.reportReviewedDate)}` };
  if (dayStamp(i.reportReceivedDate) !== null) {
    return { text: `report received ${shown(i.reportReceivedDate)}, not reviewed yet`, flag: "A report is in but not marked reviewed." };
  }
  if (dayStamp(done) !== null) return { text: `done ${shown(done)}, waiting on the report`, flag: "Waiting on a report." };
  if (dayStamp(i.scheduledDate) !== null) return { text: `scheduled ${shown(i.scheduledDate)}` };
  if (dayStamp(i.sentDate) !== null) return { text: `referral sent ${shown(i.sentDate)}, not scheduled yet` };
  return { text: "no dates entered" };
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/**
 * Editor HTML (SOAP notes, macro output) → readable plain text. Block ends and
 * <br> become line breaks, every other tag is dropped, entities are decoded.
 * Plain text passes through unchanged.
 */
export function plainText(value: string): string {
  const s = value ?? "";
  if (!/[<&]/.test(s)) return s;
  return s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, code: string) => {
      const c = code.toLowerCase();
      if (c in ENTITIES) return ENTITIES[c];
      if (c.startsWith("#x")) return String.fromCodePoint(Number.parseInt(c.slice(2), 16) || 32);
      if (c.startsWith("#")) return String.fromCodePoint(Number(c.slice(1)) || 32);
      return m;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
}

function clip(text: string, max = 600): string {
  const t = plainText(text).trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function imagingAnswer(ctx: GoatContext, which: "xray" | "mri"): GoatAnswer {
  const list = ctx.imaging.filter((i) => (which === "xray" ? i.modality === "X-Ray" : i.modality !== "X-Ray"));
  const label = which === "xray" ? "X-Ray" : "MRI / CT";
  const lines: string[] = [];
  const flags: string[] = [];
  for (const i of list) {
    const where = [i.center, i.regions.length ? i.regions.join(", ") : ""].filter(Boolean).join(" · ");
    const status = imagingStatus(i, i.doneDate);
    if (status.flag) flags.push(status.flag);
    lines.push(`${i.modality}${where ? ` (${where})` : ""}: ${status.text}.`);
    if (i.findings.trim()) lines.push(`Findings: ${clip(i.findings)}`);
  }
  const panelFindings = which === "xray" ? ctx.xrayFindings : ctx.mriFindings;
  if (panelFindings.trim() && !list.some((i) => i.findings.trim() === panelFindings.trim())) {
    lines.push(`Findings: ${clip(panelFindings)}`);
  }
  if (!lines.length) lines.push(`No ${label} referrals or findings on file.`);
  return {
    title: label,
    lines,
    source: `${label} panel`,
    section: which,
    flag: [...new Set(flags)].join(" ") || undefined,
  };
}

function specialistAnswer(ctx: GoatContext): GoatAnswer {
  const lines: string[] = [];
  const flags: string[] = [];
  for (const s of ctx.specialists) {
    const status = imagingStatus(s, s.completedDate);
    if (status.flag) flags.push(status.flag);
    lines.push(`${s.name || "Specialist"}: ${status.text.replace("done", "seen")}.`);
    if (s.recommendations.trim()) lines.push(`Recommendations: ${clip(s.recommendations)}`);
  }
  if (ctx.specialistRecommendations.trim() && !ctx.specialists.some((s) => s.recommendations.trim() === ctx.specialistRecommendations.trim())) {
    lines.push(`Recommendations: ${clip(ctx.specialistRecommendations)}`);
  }
  if (!lines.length) lines.push("No specialist referrals on file.");
  return {
    title: "Specialist referrals",
    lines,
    source: "Specialist panel",
    section: "specialist",
    flag: [...new Set(flags)].join(" ") || undefined,
  };
}

function planAnswer(ctx: GoatContext, today: number): GoatAnswer {
  if (ctx.plans === null) return hidden("Treatment plan", "treatmentPlan");
  if (!ctx.plans.length) {
    return { title: "Treatment plan", lines: ["No treatment plan set up yet."], source: "Treatment Plan", section: "treatmentPlan" };
  }
  const days = attendedDays(ctx);
  const lines: string[] = [];
  const sorted = [...ctx.plans].sort((a, b) => (dayStamp(b.startDate) ?? 0) - (dayStamp(a.startDate) ?? 0));
  for (const p of sorted) {
    const start = dayStamp(p.startDate);
    const end = dayStamp(p.endDate);
    const current = p.active && start !== null && end !== null && start <= today && today <= end;
    const label = current ? "Current plan" : p.active ? "Plan" : "Inactive plan";
    lines.push(`${label}: ${shown(p.startDate)} → ${shown(p.endDate)}${p.weekdays.length ? `, ${p.weekdays.join("/")}` : ""}.`);
    if (p.regions.length) lines.push(`Regions: ${p.regions.join(", ")}.`);
    if (start !== null && end !== null) {
      const seen = days.filter((d) => d >= start && d <= Math.min(end, today)).length;
      const ahead = upcoming(ctx, today).filter((a) => {
        const s = dayStamp(a.date);
        return s !== null && s <= end;
      }).length;
      lines.push(`${seen} visit${seen === 1 ? "" : "s"} so far in this plan${ahead ? `, ${ahead} more scheduled` : ""}.`);
    }
  }
  return { title: "Treatment plan", lines, source: "Treatment Plan", section: "treatmentPlan" };
}

function diagnosisAnswer(ctx: GoatContext): GoatAnswer {
  if (ctx.diagnoses === null) return hidden("Diagnoses", "diagnosis");
  return {
    title: "Diagnoses",
    lines: ctx.diagnoses.length
      ? ctx.diagnoses.map((d) => [d.code, d.description].filter(Boolean).join(" — "))
      : ["No diagnoses added yet."],
    source: "Diagnosis",
    section: "diagnosis",
  };
}

function billingAnswer(ctx: GoatContext): GoatAnswer {
  if (ctx.billing === null) return hidden("Billing", "details");
  const b = ctx.billing;
  const lines = [
    `Billed: ${money(b.billed) || "not entered"}.`,
    `Paid: ${money(b.paid) || "not entered"}${dayStamp(b.paidDate) !== null ? ` on ${shown(b.paidDate)}` : ""}.`,
  ];
  if (dayStamp(b.rbSent) !== null) lines.push(`R&B sent: ${shown(b.rbSent)}.`);
  return { title: "Billing", lines, source: "Additional Details", section: "details" };
}

function caseAnswer(ctx: GoatContext): GoatAnswer {
  return {
    title: "Case",
    lines: [
      `Attorney: ${ctx.attorney.trim() || "none entered"}.`,
      `Case status: ${ctx.caseStatus.trim() || "not set"}.`,
      `Lien: ${ctx.lien.trim() || "not set"}.`,
      ctx.review.trim() ? `Review: ${ctx.review.trim()}.` : "",
      ctx.isCashPatient ? "Cash patient." : "",
    ].filter(Boolean),
    source: "Patient info",
    section: "info",
  };
}

function contactAnswer(ctx: GoatContext, today: number): GoatAnswer {
  const dob = dayStamp(ctx.dob);
  let age = "";
  if (dob !== null) {
    const b = new Date(dob * 86_400_000);
    const t = new Date(today * 86_400_000);
    let years = t.getUTCFullYear() - b.getUTCFullYear();
    if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) years--;
    age = ` (age ${years})`;
  }
  return {
    title: "Contact",
    lines: [
      `Phone: ${ctx.phone && ctx.phone !== "-" ? ctx.phone : "not entered"}.`,
      `Email: ${ctx.email.trim() || "not entered"}.`,
      `Address: ${ctx.address.trim() || "not entered"}.`,
      `Date of birth: ${dob === null ? "not entered" : `${fmtDay(dob)}${age}`}.`,
    ],
    source: "Patient info",
    section: "info",
  };
}

function notesAnswer(ctx: GoatContext): GoatAnswer {
  if (ctx.notes === null) return hidden("Case notes", "notes");
  return {
    title: "Case notes",
    lines: [ctx.notes.trim() ? clip(ctx.notes, 800) : "No case notes yet."],
    source: "Notes",
    section: "notes",
  };
}

function priorCareAnswer(ctx: GoatContext): GoatAnswer {
  return {
    title: "Prior care",
    lines: [ctx.priorCare.trim() ? clip(ctx.priorCare) : "Nothing entered for prior care."],
    source: "Patient info",
    section: "info",
  };
}

// ---------------------------------------------------------------------------
// Decompression sessions
// ---------------------------------------------------------------------------

export type DecompRegion = "Lumbar" | "Cervical" | "Thoracic";
const DECOMP_REGIONS: DecompRegion[] = ["Lumbar", "Cervical", "Thoracic"];

/** A decompression treatment, appointment type or charge, but not "Begin decompression" style plan notes. */
export function isDecompression(name: string): boolean {
  return /decompress/i.test(name ?? "") && !/\b(begin|start|recommend|consider|consult|eval|discuss)/i.test(name ?? "");
}

/** Regions named in a type, answer or charge: "Lumbar (flat)", "L5-S1", "Spinal Decompression - C/S", … */
export function decompRegions(value: string): DecompRegion[] {
  const s = value ?? "";
  const out: DecompRegion[] = [];
  if (/lumbar|lumbo|low(er)? back|\bl\/s\b|\bL[1-5]\s*[-/]\s*(L[1-5]|S1)\b/i.test(s)) out.push("Lumbar");
  if (/cervical|neck|\bc\/s\b|\bC[1-7]\s*[-/]\s*(C[1-7]|T1)\b/i.test(s)) out.push("Cervical");
  if (/thoracic|mid[- ]?back|\bt\/s\b|\bT\d{1,2}\s*[-/]\s*(T\d{1,2}|L1)\b/i.test(s)) out.push("Thoracic");
  return out;
}

interface DecompDay {
  stamp: number;
  regions: Set<DecompRegion>;
  /** Picked levels / programs as written, e.g. "L5-S1", "Lumbar (flat)". */
  details: Set<string>;
  sources: Set<string>;
}

interface DecompData {
  done: DecompDay[];
  upcoming: Array<{ stamp: number; regions: DecompRegion[]; time: string }>;
  /** Appointments that didn't happen (or weren't marked), with their regions. */
  missed: Array<{ kind: "canceled" | "noShow" | "pastUnmarked"; regions: DecompRegion[] }>;
}

function collectDecompression(ctx: GoatContext, today: number): DecompData {
  const days = new Map<number, DecompDay>();
  const day = (stamp: number) => {
    let d = days.get(stamp);
    if (!d) {
      d = { stamp, regions: new Set(), details: new Set(), sources: new Set() };
      days.set(stamp, d);
    }
    return d;
  };
  for (const e of ctx.encounters ?? []) {
    const stamp = dayStamp(e.date);
    if (stamp === null) continue;
    const typeHit = isDecompression(e.type);
    const runs = e.treatments.filter((t) => isDecompression(t.name));
    const charges = e.charges.filter((c) => c.code.trim().toUpperCase() === "S9090" || isDecompression(c.name));
    if (!typeHit && !runs.length && !charges.length) continue;
    const d = day(stamp);
    if (typeHit) {
      d.sources.add("encounter type");
      decompRegions(e.type).forEach((r) => d.regions.add(r));
    }
    for (const run of runs) {
      d.sources.add(`${run.name} in the note`);
      decompRegions(run.name).forEach((r) => d.regions.add(r));
      for (const answer of run.answers) {
        const found = decompRegions(answer);
        if (found.length) {
          found.forEach((r) => d.regions.add(r));
          // Short picks ("L5-S1", "Lumbar (flat)") are shown; long free text isn't.
          if (answer.trim().length <= 40) d.details.add(answer.trim());
        }
      }
    }
    for (const c of charges) {
      d.sources.add(c.code ? `${c.code} charge` : "charge");
      decompRegions(c.name).forEach((r) => d.regions.add(r));
    }
  }
  const out: DecompData = { done: [], upcoming: [], missed: [] };
  for (const a of ctx.appointments ?? []) {
    if (!isDecompression(a.type)) continue;
    const stamp = dayStamp(a.date);
    if (stamp === null) continue;
    const status = norm(a.status);
    if (ATTENDED.has(status)) {
      const d = day(stamp);
      d.sources.add("appointment");
      decompRegions(a.type).forEach((r) => d.regions.add(r));
    } else if (status === "canceled" || status === "cancelled") {
      out.missed.push({ kind: "canceled", regions: decompRegions(a.type) });
    } else if (status === "no show") {
      out.missed.push({ kind: "noShow", regions: decompRegions(a.type) });
    } else if (UPCOMING.has(status)) {
      if (stamp >= today) out.upcoming.push({ stamp, regions: decompRegions(a.type), time: a.startTime });
      else if (!days.has(stamp)) out.missed.push({ kind: "pastUnmarked", regions: decompRegions(a.type) });
    }
  }
  out.done = [...days.values()].sort((a, b) => a.stamp - b.stamp);
  out.upcoming.sort((a, b) => a.stamp - b.stamp || a.time.localeCompare(b.time));
  return out;
}

/** One session per region per day (cervical + lumbar on one day = 2); a day with no region named = 1. */
function sessionsOn(d: DecompDay, region: DecompRegion | null): number {
  if (region) return d.regions.has(region) ? 1 : 0;
  return Math.max(1, d.regions.size);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function decompressionAnswer(ctx: GoatContext, today: number, region: DecompRegion | null): GoatAnswer {
  const title = region ? `${region} decompression` : "Decompression sessions";
  if (ctx.appointments === null && ctx.encounters === null) return hidden(title, "appointments");
  const data = collectDecompression(ctx, today);
  const label = region ? `${region.toLowerCase()} decompression` : "decompression";
  const days = data.done.filter((d) => sessionsOn(d, region) > 0);
  const total = days.reduce((n, d) => n + sessionsOn(d, region), 0);
  const lines: string[] = [];
  const flags: string[] = [];

  if (!total) {
    lines.push(`No ${label} sessions found in the appointments or encounter notes.`);
  } else {
    const first = days[0].stamp;
    const last = days[days.length - 1].stamp;
    lines.push(
      `${plural(total, `${label} session`)} done${region ? "" : ` on ${plural(days.length, "day")}`}: first ${fmtDay(first)}, last ${fmtDay(last)} (${relative(last, today)}).`,
    );
  }
  if (!region && total) {
    const parts = DECOMP_REGIONS.map((r) => [r, data.done.filter((d) => d.regions.has(r)).length] as const)
      .filter(([, n]) => n > 0)
      .map(([r, n]) => `${r} ${n}`);
    const unknown = data.done.filter((d) => d.regions.size === 0).length;
    if (unknown) parts.push(`region not recorded ${unknown}`);
    if (parts.length) lines.push(`By region: ${parts.join(" · ")}.`);
  }
  if (region) {
    const others = DECOMP_REGIONS.filter((r) => r !== region)
      .map((r) => [r, data.done.filter((d) => d.regions.has(r)).length] as const)
      .filter(([, n]) => n > 0)
      .map(([r, n]) => `${r.toLowerCase()} ${n}`);
    const unknown = data.done.filter((d) => d.regions.size === 0).length;
    if (others.length) lines.push(`Also on file: ${others.join(", ")}.`);
    if (unknown) {
      lines.push(`${plural(unknown, "other decompression day")} ${unknown === 1 ? "doesn't" : "don't"} say which region, so ${unknown === 1 ? "it isn't" : "they aren't"} counted here.`);
    }
  }
  const upcoming = data.upcoming.filter((u) => !region || u.regions.includes(region));
  if (upcoming.length) {
    const next = upcoming[0];
    lines.push(
      `${upcoming.length} more scheduled; next ${fmtDay(next.stamp)}${next.time ? ` at ${fmtTime(next.time)}` : ""} (${relative(next.stamp, today)}).`,
    );
  }
  const missed = data.missed.filter((m) => !region || m.regions.includes(region));
  const canceled = missed.filter((m) => m.kind === "canceled").length;
  const noShow = missed.filter((m) => m.kind === "noShow").length;
  const pastUnmarked = missed.filter((m) => m.kind === "pastUnmarked").length;
  if (canceled || noShow) {
    lines.push(`Not counted: ${[canceled ? `${canceled} canceled` : "", noShow ? `${noShow} no-show` : ""].filter(Boolean).join(", ")} ${label} appointment${canceled + noShow === 1 ? "" : "s"}.`);
  }
  if (pastUnmarked) flags.push(`${plural(pastUnmarked, `past ${label} appointment`)} still marked Scheduled.`);
  if (!total && ctx.plans?.some((p) => p.regions.some(isDecompression))) {
    lines.push("The treatment plan includes decompression, but no sessions are recorded yet.");
  }
  if (days.length) {
    const MAX = 12;
    const recent = days.slice(-MAX).reverse();
    const rows = recent.map((d) => {
      // "Lumbar L5-S1", "Cervical (flat)": the region plus whatever was picked for it.
      const regions =
        [...d.regions]
          .map((r) => {
            const extras = [...d.details]
              .filter((x) => decompRegions(x).includes(r) && x.toLowerCase() !== r.toLowerCase())
              .map((x) => (x.toLowerCase().startsWith(r.toLowerCase()) ? x.slice(r.length).trim() : x));
            return extras.length ? `${r} ${extras.join(", ")}` : r;
          })
          .join(" + ") || "region not recorded";
      return `• ${fmtDay(d.stamp)}: ${regions}. From: ${[...d.sources].join(", ")}`;
    });
    if (days.length > MAX) rows.push(`…and ${plural(days.length - MAX, "earlier day")}.`);
    lines.push(`Dates, newest first:\n${rows.join("\n")}`);
  }
  if (ctx.encounters === null) lines.push("Encounter notes are hidden for your account, so this counts appointments only.");
  return {
    title,
    lines,
    source: "Appointments / Encounters (appointment type, decompression macro, S9090 charge)",
    section: "appointments",
    flag: flags.join(" ") || undefined,
  };
}

// ---------------------------------------------------------------------------
// Searching the page's own text
// ---------------------------------------------------------------------------

function snippetAround(text: string, matchers: TermMatcher[]): string {
  let at = -1;
  for (const m of matchers) {
    const first = m.ranges(text)[0];
    if (first && (at < 0 || first[0] < at)) at = first[0];
  }
  const start = Math.max(0, at - 70);
  const end = Math.min(text.length, (at < 0 ? 0 : at) + 110);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** One point per word / synonym group found (whole words only). */
function scoreText(text: string, matchers: TermMatcher[]): number {
  return matchers.reduce((n, m) => (m.test(text) ? n + 1 : n), 0);
}

function searchPage(ctx: GoatContext, terms: TermMatcher[]): GoatHit[] {
  if (!terms.length) return [];
  const hits: GoatHit[] = [];
  const add = (
    kind: GoatHit["kind"],
    title: string,
    raw: string,
    date: string | null,
    section: GoatSection,
    encounterId?: string,
  ) => {
    // Match and show readable text only; tags and attributes never count.
    const text = plainText(raw ?? "");
    if (!text.trim()) return;
    const score = scoreText(text, terms);
    if (score > 0) hits.push({ kind, title, snippet: snippetAround(text, terms), date, section, encounterId, score });
  };
  if (ctx.notes !== null) add("Note", "Case notes", ctx.notes, null, "notes");
  for (const a of ctx.alerts) add("Alert", "Patient alert", a, null, "info");
  add("Prior care", "Prior care", ctx.priorCare, null, "info");
  for (const i of ctx.imaging) {
    add(i.modality === "X-Ray" ? "X-Ray findings" : "MRI/CT findings", `${i.modality}${i.center ? ` · ${i.center}` : ""}`, i.findings, i.doneDate || i.sentDate || null, i.modality === "X-Ray" ? "xray" : "mri");
  }
  if (!ctx.imaging.some((i) => i.modality === "X-Ray" && i.findings.trim() === ctx.xrayFindings.trim())) {
    add("X-Ray findings", "X-Ray findings", ctx.xrayFindings, null, "xray");
  }
  if (!ctx.imaging.some((i) => i.modality !== "X-Ray" && i.findings.trim() === ctx.mriFindings.trim())) {
    add("MRI/CT findings", "MRI / CT findings", ctx.mriFindings, null, "mri");
  }
  for (const s of ctx.specialists) add("Specialist", s.name || "Specialist", s.recommendations, s.completedDate || s.sentDate || null, "specialist");
  add("Specialist", "Specialist recommendations", ctx.specialistRecommendations, null, "specialist");
  for (const e of ctx.encounters ?? []) {
    const sections: Array<[string, string]> = [
      ["S", e.soap.subjective],
      ["O", e.soap.objective],
      ["A", e.soap.assessment],
      ["P", e.soap.plan],
    ];
    for (const [letter, text] of sections) {
      add("SOAP", `${e.date} · ${letter}${e.type ? ` · ${e.type}` : ""}`, text, e.date, "appointments", e.id || undefined);
    }
  }
  return hits.sort((a, b) => b.score - a.score || (dayStamp(b.date ?? "") ?? 0) - (dayStamp(a.date ?? "") ?? 0));
}

// ---------------------------------------------------------------------------

export function askGoat(ctx: GoatContext, question: string): GoatResult {
  const tokens = tokenize(question);
  const text = question.toLowerCase();
  const today = dayStamp(ctx.today) ?? Math.floor(Date.now() / 86_400_000);
  const answers: GoatAnswer[] = [];
  const push = (a: GoatAnswer) => {
    if (!answers.some((x) => x.title === a.title)) answers.push(a);
  };

  const asksGap = has(tokens, ["gap", "break", "lapse", "stopped", "missed"]) || text.includes("no visit");
  const visitWords = has(tokens, ["visit", "appointment", "appt", "seen", "came", "come", "scheduled", "schedule", "booked", "encounter"]);
  const focus: "next" | "last" | "first" | null = has(tokens, ["next", "upcoming", "coming"])
    ? "next"
    : has(tokens, ["last", "recent", "latest", "previous"])
      ? "last"
      : tokens.includes("first") && !has(tokens, ["injur", "accident", "exam"])
        ? "first"
        : null;
  const asksCount = text.includes("how many") || text.includes("so far") || has(tokens, ["count", "total"]);

  const asksDecomp = has(tokens, ["decomp", "decompress"]) || text.includes("spinal decompression");
  if (asksDecomp) {
    // "lumbar decompression", "L/S decompression", "neck decompression", …
    const asked = decompRegions(question);
    if (asked.length) asked.forEach((r) => push(decompressionAnswer(ctx, today, r)));
    else push(decompressionAnswer(ctx, today, null));
  }

  if (asksGap) push(gapsAnswer(ctx, today));
  if (!asksGap && !(asksDecomp && !visitWords) && (visitWords || (focus && !has(tokens, ["xray", "mri", "specialist", "plan"])) || (asksCount && !has(tokens, ["bill", "diagnos"])))) {
    push(visitsAnswer(ctx, today, focus));
  }
  if (has(tokens, ["doi", "injur", "accident", "loss", "crash", "initial", "ie", "exam", "discharg"]) || text.includes("date of")) {
    push(datesAnswer(ctx, today));
  }
  const asksXray = has(tokens, ["xray", "radiograph"]);
  const asksMri = has(tokens, ["mri", "ct", "scan"]);
  // Synonym groups the question uses (Settings → G.O.A.T.): "ROM" brings in
  // flexion/extension/…, "PM" brings in pain management and the PM doctor.
  const groups = ctx.termGroups ?? [];
  const asked = groupsInQuestion(question, groups);
  const people = ctx.people ?? [];
  const askedTerms = asked.flatMap((g) => g.terms);
  const isFindingsGroup = (g: GoatTermGroup) => g.terms.some((t) => /^(findings|impression)$/i.test(t));
  const isImagingGroup = (g: GoatTermGroup) => g.terms.some((t) => /^(x-?ray|mri|ct|imaging)$/i.test(t));
  const specialistWords =
    has(tokens, ["specialist", "referr", "refer", "consult", "pm", "ortho", "neuro", "recommend"]) || text.includes("pain management");
  // "Findings" means imaging only when nothing else is named ("PM findings", "ROM findings" aren't imaging).
  const otherTopic = specialistWords || asked.some((g) => !isFindingsGroup(g) && !isImagingGroup(g));
  const asksImaging = has(tokens, ["imaging", "radiology"]) || (has(tokens, ["findings"]) && !otherTopic);
  if (asksXray || (asksImaging && !asksMri)) push(imagingAnswer(ctx, "xray"));
  if (asksMri || (asksImaging && !asksXray)) push(imagingAnswer(ctx, "mri"));
  if (specialistWords) push(specialistAnswer(ctx));
  if (has(tokens, ["plan", "frequency", "weekly", "week", "regions"]) || text.includes("treatment plan")) push(planAnswer(ctx, today));
  if (has(tokens, ["diagnos", "dx", "icd", "code", "codes"])) push(diagnosisAnswer(ctx));
  if (has(tokens, ["bill", "charge", "balance", "paid", "payment", "owe", "money", "cost", "amount", "rb", "reduction"])) push(billingAnswer(ctx));
  if (has(tokens, ["attorney", "lawyer", "firm", "law", "lien", "review", "cash"]) || text.includes("case status") || text.includes("status of the case")) {
    push(caseAnswer(ctx));
  }
  if (has(tokens, ["phone", "email", "address", "contact", "call", "dob", "birth", "birthday", "age", "old"])) push(contactAnswer(ctx, today));
  if (has(tokens, ["note", "notes"])) push(notesAnswer(ctx));
  if (has(tokens, ["prior", "before", "history"])) push(priorCareAnswer(ctx));

  // Search terms: each asked group as one unit (any synonym counts), plus the
  // question's other words. "Findings" words only count when nothing else is asked.
  const words = [...new Set(tokens.filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !STEERING.has(t)))];
  const searchGroups = asked.filter((g) => !isFindingsGroup(g) || asked.length === 1);
  const covered = new Set(askedTerms.flatMap((t) => tokenize(t)));
  const leftovers = words.filter((w) => !covered.has(w));
  const matchers = [...searchGroups.map((g) => makeMatcher(g.terms)), ...leftovers.map((w) => makeMatcher([w]))];
  const terms = [...new Set([...searchGroups.flatMap((g) => g.terms), ...leftovers])];

  const files =
    ctx.files && ctx.files.length
      ? answerFromFiles(ctx.files, { question, words, asked, allGroups: groups, people })
      : null;
  return { answers, hits: searchPage(ctx, matchers).slice(0, 8), terms, files };
}
