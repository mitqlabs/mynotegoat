/**
 * Primo — "ask about this patient".
 *
 * Answers questions by looking things up in what is already on the patient
 * page. There is no AI and no network call here: every answer is read directly
 * off a field, a list or a note, and each one says which section it came from.
 * If the page does not contain the answer, Primo says so rather than guessing.
 *
 * Modelled on CaseMate's Lexi (keyword topics + a plain-text search), adapted
 * to NoteGoat's clinical data. The caller builds a PrimoContext from the page's
 * live state; a section the signed-in member cannot see is passed as `null`
 * and Primo will not read it.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type PrimoSection =
  | "info"
  | "notes"
  | "xray"
  | "mri"
  | "specialist"
  | "appointments"
  | "treatmentPlan"
  | "diagnosis"
  | "details";

export interface PrimoAppointment {
  /** ISO YYYY-MM-DD */
  date: string;
  /** HH:MM (24h) */
  startTime: string;
  type: string;
  status: string;
}

export interface PrimoEncounter {
  /** MM/DD/YYYY */
  date: string;
  type: string;
  signed: boolean;
  soap: { subjective: string; objective: string; assessment: string; plan: string };
}

export interface PrimoImaging {
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

export interface PrimoSpecialist {
  name: string;
  sentDate: string;
  scheduledDate: string;
  completedDate: string;
  reportReceivedDate: string;
  reportReviewedDate: string;
  recommendations: string;
  refused: boolean;
}

export interface PrimoPlan {
  startDate: string;
  endDate: string;
  active: boolean;
  weekdays: string[];
  regions: string[];
}

export interface PrimoContext {
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
  imaging: PrimoImaging[];
  specialists: PrimoSpecialist[];
  /** null = section hidden for this member. */
  notes: string | null;
  appointments: PrimoAppointment[] | null;
  encounters: PrimoEncounter[] | null;
  plans: PrimoPlan[] | null;
  diagnoses: Array<{ code: string; description: string }> | null;
  details: { discharge: string } | null;
  billing: { billed: string; paid: string; paidDate: string; rbSent: string } | null;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface PrimoAnswer {
  title: string;
  lines: string[];
  /** Where the answer was read from, in words. */
  source: string;
  section: PrimoSection;
  /** Something worth a second look, e.g. a gap or an unreviewed report. */
  flag?: string;
}

export interface PrimoHit {
  kind: "Note" | "SOAP" | "X-Ray findings" | "MRI/CT findings" | "Specialist" | "Prior care" | "Alert";
  title: string;
  snippet: string;
  date: string | null;
  section: PrimoSection;
  score: number;
}

export interface PrimoResult {
  answers: PrimoAnswer[];
  hits: PrimoHit[];
  /** Words searched for, for highlighting. */
  terms: string[];
}

/** Breaks between visits shorter than this are normal scheduling. */
export const PRIMO_GAP_DAYS = 14;

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
function attendedDays(ctx: PrimoContext): number[] {
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

function upcoming(ctx: PrimoContext, today: number): PrimoAppointment[] {
  return (ctx.appointments ?? [])
    .filter((a) => UPCOMING.has(norm(a.status)) && (dayStamp(a.date) ?? -1) >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

function hidden(title: string, section: PrimoSection): PrimoAnswer {
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

function visitsAnswer(ctx: PrimoContext, today: number, focus: "next" | "last" | "first" | null): PrimoAnswer {
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

function gapsAnswer(ctx: PrimoContext, today: number): PrimoAnswer {
  if (ctx.appointments === null) return hidden("Gaps in care", "appointments");
  const days = attendedDays(ctx).filter((d) => d <= today);
  const lines: string[] = [];
  const doi = dayStamp(ctx.doi);
  if (doi !== null && days.length && days[0] - doi > PRIMO_GAP_DAYS) {
    lines.push(`First visit was ${days[0] - doi} days after the date of injury (${fmtDay(doi)} → ${fmtDay(days[0])}).`);
  }
  for (let i = 1; i < days.length; i++) {
    const span = days[i] - days[i - 1];
    if (span > PRIMO_GAP_DAYS) {
      lines.push(`${span} days with no visit: ${fmtDay(days[i - 1])} → ${fmtDay(days[i])}.`);
    }
  }
  const last = days[days.length - 1];
  if (last !== undefined && !upcoming(ctx, today).length && today - last > PRIMO_GAP_DAYS) {
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
    lines: lines.length ? lines : [`No breaks longer than ${PRIMO_GAP_DAYS} days across ${days.length} visits.`],
    source: `${APPTS_SOURCE} (checked-in/out visits and encounters)`,
    section: "appointments",
    flag: lines.length ? `Breaks longer than ${PRIMO_GAP_DAYS} days are listed.` : undefined,
  };
}

function datesAnswer(ctx: PrimoContext, today: number): PrimoAnswer {
  const doi = dayStamp(ctx.doi);
  const ie = dayStamp(ctx.initialExam);
  const lines = [
    `Date of injury: ${doi === null ? "not entered" : `${fmtDay(doi)} (${relative(doi, today)})`}.`,
    `Initial exam: ${ie === null ? "not entered" : `${fmtDay(ie)}${doi !== null ? ` — ${ie - doi} days after the injury` : ""}`}.`,
  ];
  if (ctx.details) {
    const dc = dayStamp(ctx.details.discharge);
    if (dc !== null) lines.push(`Discharged: ${fmtDay(dc)}.`);
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

function clip(text: string, max = 600): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function imagingAnswer(ctx: PrimoContext, which: "xray" | "mri"): PrimoAnswer {
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

function specialistAnswer(ctx: PrimoContext): PrimoAnswer {
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

function planAnswer(ctx: PrimoContext, today: number): PrimoAnswer {
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

function diagnosisAnswer(ctx: PrimoContext): PrimoAnswer {
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

function billingAnswer(ctx: PrimoContext): PrimoAnswer {
  if (ctx.billing === null) return hidden("Billing", "details");
  const b = ctx.billing;
  const lines = [
    `Billed: ${money(b.billed) || "not entered"}.`,
    `Paid: ${money(b.paid) || "not entered"}${dayStamp(b.paidDate) !== null ? ` on ${shown(b.paidDate)}` : ""}.`,
  ];
  if (dayStamp(b.rbSent) !== null) lines.push(`R&B sent: ${shown(b.rbSent)}.`);
  return { title: "Billing", lines, source: "Additional Details", section: "details" };
}

function caseAnswer(ctx: PrimoContext): PrimoAnswer {
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

function contactAnswer(ctx: PrimoContext, today: number): PrimoAnswer {
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

function notesAnswer(ctx: PrimoContext): PrimoAnswer {
  if (ctx.notes === null) return hidden("Case notes", "notes");
  return {
    title: "Case notes",
    lines: [ctx.notes.trim() ? clip(ctx.notes, 800) : "No case notes yet."],
    source: "Notes",
    section: "notes",
  };
}

function priorCareAnswer(ctx: PrimoContext): PrimoAnswer {
  return {
    title: "Prior care",
    lines: [ctx.priorCare.trim() ? clip(ctx.priorCare) : "Nothing entered for prior care."],
    source: "Patient info",
    section: "info",
  };
}

// ---------------------------------------------------------------------------
// Searching the page's own text
// ---------------------------------------------------------------------------

function snippetAround(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at - 70);
  const end = Math.min(text.length, (at < 0 ? 0 : at) + 110);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0);
}

function searchPage(ctx: PrimoContext, terms: string[]): PrimoHit[] {
  if (!terms.length) return [];
  const hits: PrimoHit[] = [];
  const add = (kind: PrimoHit["kind"], title: string, text: string, date: string | null, section: PrimoSection) => {
    if (!text?.trim()) return;
    const score = scoreText(text, terms);
    if (score > 0) hits.push({ kind, title, snippet: snippetAround(text, terms), date, section, score });
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
      add("SOAP", `${e.date} · ${letter}${e.type ? ` · ${e.type}` : ""}`, text, e.date, "appointments");
    }
  }
  return hits.sort((a, b) => b.score - a.score || (dayStamp(b.date ?? "") ?? 0) - (dayStamp(a.date ?? "") ?? 0));
}

// ---------------------------------------------------------------------------

export function askPrimo(ctx: PrimoContext, question: string): PrimoResult {
  const tokens = tokenize(question);
  const text = question.toLowerCase();
  const today = dayStamp(ctx.today) ?? Math.floor(Date.now() / 86_400_000);
  const answers: PrimoAnswer[] = [];
  const push = (a: PrimoAnswer) => {
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

  if (asksGap) push(gapsAnswer(ctx, today));
  if (!asksGap && (visitWords || (focus && !has(tokens, ["xray", "mri", "specialist", "plan"])) || (asksCount && !has(tokens, ["bill", "diagnos"])))) {
    push(visitsAnswer(ctx, today, focus));
  }
  if (has(tokens, ["doi", "injur", "accident", "loss", "crash", "initial", "ie", "exam", "discharg"]) || text.includes("date of")) {
    push(datesAnswer(ctx, today));
  }
  const asksXray = has(tokens, ["xray", "radiograph"]);
  const asksMri = has(tokens, ["mri", "ct", "scan"]);
  const asksImaging = has(tokens, ["imaging", "radiology", "findings"]);
  if (asksXray || (asksImaging && !asksMri)) push(imagingAnswer(ctx, "xray"));
  if (asksMri || (asksImaging && !asksXray)) push(imagingAnswer(ctx, "mri"));
  if (has(tokens, ["specialist", "referr", "refer", "consult", "pm", "ortho", "neuro", "recommend"]) || text.includes("pain management")) {
    push(specialistAnswer(ctx));
  }
  if (has(tokens, ["plan", "frequency", "weekly", "week", "regions", "decompress"]) || text.includes("treatment plan")) push(planAnswer(ctx, today));
  if (has(tokens, ["diagnos", "dx", "icd", "code", "codes"])) push(diagnosisAnswer(ctx));
  if (has(tokens, ["bill", "charge", "balance", "paid", "payment", "owe", "money", "cost", "amount", "rb", "reduction"])) push(billingAnswer(ctx));
  if (has(tokens, ["attorney", "lawyer", "firm", "law", "lien", "review", "cash"]) || text.includes("case status") || text.includes("status of the case")) {
    push(caseAnswer(ctx));
  }
  if (has(tokens, ["phone", "email", "address", "contact", "call", "dob", "birth", "birthday", "age", "old"])) push(contactAnswer(ctx, today));
  if (has(tokens, ["note", "notes"])) push(notesAnswer(ctx));
  if (has(tokens, ["prior", "before", "history"])) push(priorCareAnswer(ctx));

  const terms = [...new Set(tokens.filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !STEERING.has(t)))];
  return { answers, hits: searchPage(ctx, terms).slice(0, 8), terms };
}
