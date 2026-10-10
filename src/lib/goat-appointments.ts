/**
 * G.O.A.T. — the patient's appointments, one by one.
 *
 * The Visits card only gives counts ("18 on file: 17 attended, 1 canceled").
 * This answers the follow-ups: "when did they cancel", "which appointments
 * were no-shows", "when was the last Discharge", "list new patient visits",
 * "how many lumbar decompression appointments". Read straight off the
 * patient's schedule entries (date, time, type, status, appointment note);
 * nothing is guessed and nothing leaves the browser.
 *
 * Kept apart from goat.ts so it can be tested on its own; goat.ts calls
 * `appointmentListAnswer` and re-exports the decompression helpers.
 */

import type { GoatAnswer, GoatAnswerGroup, GoatAppointment, GoatBlock } from "@/lib/goat";
import { makeMatcher, type GoatTermGroup } from "@/lib/goat-terms";

// ---------------------------------------------------------------------------
// Decompression helpers (shared with goat.ts)
// ---------------------------------------------------------------------------

export type DecompRegion = "Lumbar" | "Cervical" | "Thoracic";

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

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type GoatApptStatus = "Scheduled" | "Checked In" | "Checked Out" | "Canceled" | "No Show" | "Rescheduled";

/** Stored status ("Check In", "cancelled", "no-show", …) → the label the schedule shows. */
export function apptStatus(raw: string): GoatApptStatus {
  const s = (raw ?? "").trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  if (s === "check in" || s === "checked in") return "Checked In";
  if (s === "check out" || s === "checked out" || s === "seen") return "Checked Out";
  if (s === "canceled" || s === "cancelled" || s === "cancel") return "Canceled";
  if (s === "no show" || s === "noshow") return "No Show";
  if (s === "reschedule" || s === "rescheduled") return "Rescheduled";
  return "Scheduled";
}

const STATUS_ORDER: GoatApptStatus[] = ["Canceled", "No Show", "Rescheduled", "Checked Out", "Checked In", "Scheduled"];

const STATUS_WORD: Record<GoatApptStatus, string> = {
  Canceled: "canceled",
  "No Show": "no-show",
  Rescheduled: "rescheduled",
  "Checked Out": "checked out",
  "Checked In": "checked in",
  Scheduled: "scheduled",
};

/** Which statuses a question is about. "Upcoming" = Scheduled/Rescheduled today or later. */
export interface StatusAsk {
  statuses: GoatApptStatus[];
  upcoming: boolean;
}

export function statusesAsked(question: string): StatusAsk {
  const q = question ?? "";
  const statuses = new Set<GoatApptStatus>();
  if (/\b(cancel\w*|canx|cx|cxl|cxld|cxd)\b/i.test(q)) statuses.add("Canceled");
  // "NS" only in capitals ("ns" is too common inside other text).
  if (/\b(no[\s-]?shows?|noshows?|no[\s-]?showed|(didn'?t|did not|never) ((they|he|she|the patient|the pt) )?(show|showed|come|came))\b/i.test(q) || /\bNS\b/.test(q)) {
    statuses.add("No Show");
  }
  // "Missed" covers both: the patient didn't come, whether they called ahead or not.
  if (/\b(miss|missed|misses|missing|skip|skipped)\b/i.test(q)) {
    statuses.add("No Show");
    statuses.add("Canceled");
  }
  if (/\b(re-?schedul\w*|resched\w*|r\/s)\b/i.test(q)) statuses.add("Rescheduled");
  if (/\b(attended|checked[\s-]?(in|out)|check[\s-]?(ins|outs)|showed( up)?|came in)\b/i.test(q)) {
    statuses.add("Checked Out");
    statuses.add("Checked In");
  }
  const upcoming = /\b(upcoming|future|coming up|ahead|booked|next)\b/i.test(q) || /\bstill scheduled\b/i.test(q);
  return { statuses: STATUS_ORDER.filter((s) => statuses.has(s)), upcoming };
}

// ---------------------------------------------------------------------------
// Appointment type
// ---------------------------------------------------------------------------

/** Kinds of visit the office talks about, with the words used for them. */
const TYPE_KINDS: Array<{ ask: RegExp; type: RegExp }> = [
  { ask: /\b(new patient|new pt|np|initial (exam|visit|evaluation|eval)|ie|intake)\b/i, type: /\b(new patient|new pt|np|initial|intake)\b/i },
  { ask: /\b(discharg\w*|dc|d\/c)\b/i, type: /\b(discharg\w*|d\/c)\b/i },
  { ask: /\b(re-?exam\w*|re-?eval\w*|re-?examination|progress exam)\b/i, type: /\b(re-?exam\w*|re-?eval\w*|progress exam)\b/i },
  { ask: /\b(follow[\s-]?ups?|f\/u)\b/i, type: /\b(follow[\s-]?ups?|f\/u)\b/i },
    { ask: /\bmassage\b/i, type: /\bmassage\b/i },
  { ask: /\b(adjust\w*|chiro\w*|cmt)\b/i, type: /\b(adjust\w*|chiro\w*|cmt)\b/i },
  { ask: /\b(therapy|rehab|pt session|physical therapy|exercise)\b/i, type: /\b(therapy|rehab|exercise)\b/i },
  { ask: /\b(x-?rays?|xrays?)\b/i, type: /\bx-?rays?\b/i },
];

const DECOMP_ASK = /\bdecompress\w*|\bdecomp\b|\bidd\b/i;

/** Words that never pick an appointment type on their own. */
const TYPE_STOP = new Set(
  "a an and are as at be been but by can did do does for from had has have he her his how i in is it its me my of on or our she so that the their them they this to was we were what when where which who why will with you your any all about tell show give find get much many patient patients pt please visit visits appointment appointments appt appts list date dates time times day days last first next recent latest previous upcoming count total number scheduled schedule session sessions spinal office pi personal injury new their him her she has been often ago week weeks month months year this that patient's canceled cancelled cancel cancellations cancellation cx no show shows missed miss rescheduled reschedule did didn come came ever".split(
    " ",
  ),
);

function words(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !TYPE_STOP.has(w));
}

/**
 * The appointment types (as written on this patient's schedule) a question is
 * about, or null when it names none. Office synonym groups count too: a group
 * the question uses that matches a type name picks that type.
 */
export function typesAsked(question: string, types: string[], groups: GoatTermGroup[] = []): string[] | null {
  const distinct = [...new Set(types.map((t) => (t ?? "").trim()).filter(Boolean))];
  if (!distinct.length) return null;
  const picked = new Set<string>();

  // Decompression: "lumbar decompression" → decompression types for that region.
  if (DECOMP_ASK.test(question)) {
    const regions = decompRegions(question);
    for (const t of distinct) {
      if (!isDecompression(t)) continue;
      if (!regions.length || decompRegions(t).some((r) => regions.includes(r))) picked.add(t);
    }
    return [...picked];
  }

  for (const kind of TYPE_KINDS) {
    if (!kind.ask.test(question)) continue;
    for (const t of distinct) if (kind.type.test(t)) picked.add(t);
  }
  for (const g of groups) {
    const m = makeMatcher(g.terms);
    if (!m.test(question)) continue;
    for (const t of distinct) if (m.test(t)) picked.add(t);
  }
  // A region named in the question and in the type ("lumbar" → "Spinal Decompression - L/S").
  const regionsAsked = decompRegions(question);
  if (regionsAsked.length) for (const t of distinct) if (decompRegions(t).some((r) => regionsAsked.includes(r))) picked.add(t);
  // Any other word the question shares with a type name ("massage", "ortho", "MRI review").
  const asked = words(question);
  if (asked.length) {
    for (const t of distinct) {
      const tw = words(t);
      if (asked.some((w) => tw.some((x) => x === w || (w.length >= 5 && x.startsWith(w)) || (x.length >= 5 && w.startsWith(x))))) picked.add(t);
    }
  }
  if (picked.size) return [...picked];
  // Named a kind of visit this patient doesn't have.
  return TYPE_KINDS.some((k) => k.ask.test(question)) ? [] : null;
}

/** A short name for the kind asked about, for titles ("Discharge", "New patient"). */
function kindLabel(question: string): string {
  if (/\bdecompress\w*|\bdecomp\b/i.test(question)) {
    const r = decompRegions(question);
    return `${r.length ? `${r.join(" / ")} ` : ""}decompression`;
  }
  const labels: Array<[RegExp, string]> = [
    [TYPE_KINDS[0].ask, "New patient"],
    [TYPE_KINDS[1].ask, "Discharge"],
    [TYPE_KINDS[2].ask, "Re-exam"],
    [TYPE_KINDS[3].ask, "Follow-up"],
  ];
  return labels.find(([re]) => re.test(question))?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function stampOf(value: string): number | null {
  const s = (value ?? "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return Math.floor(Date.UTC(+m[3], +m[1] - 1, +m[2]) / 86_400_000);
  return null;
}

/** "10/07/2026 (Wed)" */
export function apptDay(stamp: number): string {
  const dt = new Date(stamp * 86_400_000);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${dt.getUTCFullYear()} (${WEEKDAY[dt.getUTCDay()]})`;
}

function apptTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return "";
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface ApptRow {
  stamp: number;
  time: string;
  type: string;
  status: GoatApptStatus;
  note: string;
}

export function apptRows(appts: GoatAppointment[]): ApptRow[] {
  const rows: ApptRow[] = [];
  for (const a of appts) {
    const stamp = stampOf(a.date);
    if (stamp === null) continue;
    rows.push({
      stamp,
      time: a.startTime ?? "",
      type: (a.type ?? "").trim(),
      status: apptStatus(a.status),
      note: (a.note ?? "").replace(/\s+/g, " ").trim(),
    });
  }
  return rows;
}

const byNewest = (a: ApptRow, b: ApptRow) => b.stamp - a.stamp || b.time.localeCompare(a.time);
const byOldest = (a: ApptRow, b: ApptRow) => a.stamp - b.stamp || a.time.localeCompare(b.time);

/** "10/07/2026 (Wed) 3:00 PM — Spinal Decompression - L/S · Canceled — Note: sick" */
export function apptLine(r: ApptRow, opts: { status?: boolean } = {}): string {
  const time = apptTime(r.time);
  const head = `${apptDay(r.stamp)}${time ? ` ${time}` : ""} — ${r.type || "No type"}`;
  return `${head}${opts.status === false ? "" : ` · ${r.status}`}${r.note ? ` — Note: ${r.note}` : ""}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Long lists show the first `SHOWN` rows with "Show all" for the rest. */
const SHOWN = 15;

function block(heading: string, rows: ApptRow[], opts: { status?: boolean } = {}): GoatBlock {
  const items = rows.map((r) => apptLine(r, opts));
  return {
    heading,
    items,
    ...(items.length > SHOWN ? { focus: items.slice(0, SHOWN).map((_, i) => i) } : {}),
    more: "appointments",
  };
}

function isUpcoming(r: ApptRow, today: number): boolean {
  return (r.status === "Scheduled" || r.status === "Rescheduled") && r.stamp >= today;
}

// ---------------------------------------------------------------------------
// Answer
// ---------------------------------------------------------------------------

/** True when the question is about appointments one by one (not just the summary). */
export function asksAppointmentList(question: string): boolean {
  return /\b(list|all|every|history|which|what|when|dates?|days?|how many|count|last|first|latest|recent|next|most recent)\b/i.test(question);
}

/**
 * Appointments matching a question, as a G.O.A.T. answer card. Returns null
 * when the question isn't about particular appointments (the Visits summary
 * then answers on its own).
 */
export function appointmentListAnswer(
  appts: GoatAppointment[] | null,
  question: string,
  today: number,
  opts: { groups?: GoatTermGroup[]; visitWords: boolean },
): GoatAnswer | null {
  const ask = statusesAsked(question);
  const listWords = asksAppointmentList(question);
  const typeNamed = typesAsked(question, (appts ?? []).map((a) => a.type), opts.groups ?? []);
  // A kind of visit named outright ("Discharge", "new patient") is enough with
  // "when / last / list"; decompression and words that merely overlap a type
  // name ("lumbar") also need an appointment word, so "when was the lumbar MRI"
  // or "how many decompression sessions" stay with their own cards.
  const kindExplicit = TYPE_KINDS.some((k) => k.ask.test(question));
  const typeByWord = Boolean(typeNamed && typeNamed.length) && opts.visitWords;
  const wholeList = opts.visitWords && /\b(list|all|every|history)\b/i.test(question);
  const fires =
    ask.statuses.length > 0 ||
    (kindExplicit && (opts.visitWords || listWords)) ||
    typeByWord ||
    wholeList ||
    (ask.upcoming && opts.visitWords && /\b(list|all|which|what|dates?)\b/i.test(question));
  if (!fires) return null;

  const kind = kindLabel(question);
  const label = kind ? kind[0].toUpperCase() + kind.slice(1) : "";
  const titleBase = ask.statuses.length
    ? ask.statuses.length === 2 && ask.statuses.includes("Checked In") && ask.statuses.includes("Checked Out")
      ? "Attended appointments"
      : `${ask.statuses.join(" / ")} appointments`
    : label
      ? `${label} appointments`
      : ask.upcoming
        ? "Upcoming appointments"
        : "Appointments";
  const title = ask.statuses.length && label ? `${label} · ${titleBase}` : titleBase;
  const source = "Appointments (each visit's date, type and status)";
  if (appts === null) {
    return { title, lines: ["That section is hidden for your account, so I can't read it."], source: "Hidden for your account", section: "appointments" };
  }

  let rows = apptRows(appts);
  // Decompression / word-matched types only filter when the question is about appointments.
  const typeFilter = typeNamed && typeNamed.length ? new Set(typeNamed) : null;
  if (typeNamed && !typeNamed.length) {
    return {
      title,
      lines: [`No ${label ? `${label.toLowerCase()} ` : ""}appointments on file for this patient.`],
      source,
      section: "appointments",
    };
  }
  if (typeFilter) rows = rows.filter((r) => typeFilter.has(r.type));
  const typesNote = typeFilter ? `Types: ${[...typeFilter].join(", ")}.` : "";
  const lines: string[] = [];
  const blocks: GoatBlock[] = [];
  let flag: string | undefined;
  const wantsLast = /\b(last|latest|most recent|recent|previous)\b/i.test(question);
  const wantsFirst = /\bfirst\b/i.test(question) && !wantsLast;

  if (ask.statuses.length) {
    const statusRows = rows.filter((r) => ask.statuses.includes(r.status));
    const total = statusRows.length;
    const what = ask.statuses.map((s) => STATUS_WORD[s]).join(" or ");
    if (!total) {
      lines.push(`No ${what} ${label ? `${label.toLowerCase()} ` : ""}appointments on file.`);
    } else {
      const sorted = [...statusRows].sort(wantsFirst ? byOldest : byNewest);
      const top = sorted[0];
      const showStatus = { status: ask.statuses.length > 1 };
      if (total === 1) {
        lines.push(`1 ${what} appointment: ${apptLine(top, showStatus)}.`);
      } else {
        const lead = wantsFirst ? "First" : "Most recent";
        lines.push(`${plural(total, `${what} appointment`)}. ${lead}: ${apptLine(top, showStatus)}.`);
      }
      if (ask.statuses.includes("Canceled") && statusRows.some((r) => r.status === "Canceled")) {
        lines.push("Dates are the appointment dates; the schedule doesn't record the day the cancellation was made.");
      }
      if (total > 1 || ask.statuses.length > 1) {
        for (const s of ask.statuses) {
          const these = statusRows.filter((r) => r.status === s).sort(wantsFirst ? byOldest : byNewest);
          if (these.length) blocks.push(block(`${s} (${these.length}) · ${wantsFirst ? "oldest" : "newest"} first`, these, { status: false }));
        }
      }
    }
    const pastUnmarked = rows.filter((r) => r.status === "Scheduled" && r.stamp < today);
    // Past visits nobody marked could be no-shows too.
    if (pastUnmarked.length && ask.statuses.includes("No Show")) {
      flag = `${plural(pastUnmarked.length, "past appointment")} still marked Scheduled (not checked in or out): ${pastUnmarked.sort(byNewest).slice(0, 3).map((r) => apptDay(r.stamp)).join(", ")}${pastUnmarked.length > 3 ? ", …" : ""}.`;
    }
  } else {
    const ahead = rows.filter((r) => isUpcoming(r, today)).sort(byOldest);
    const past = rows.filter((r) => !isUpcoming(r, today)).sort(byNewest);
    const name = label ? `${label.toLowerCase()} appointment` : "appointment";
    if (!rows.length) {
      lines.push(`No ${name}s on file.`);
    } else {
      const counts = STATUS_ORDER.map((s) => [s, rows.filter((r) => r.status === s && !isUpcoming(r, today)).length] as const)
        .filter(([, n]) => n > 0)
        .map(([s, n]) => `${n} ${STATUS_WORD[s]}`);
      if (ahead.length) counts.push(`${ahead.length} upcoming`);
      lines.push(`${plural(rows.length, name)} on file: ${counts.join(", ")}.`);
      const attendedPast = past.filter((r) => r.status === "Checked Out" || r.status === "Checked In");
      if (wantsLast || wantsFirst) {
        const pool = attendedPast.length ? attendedPast : past;
        const pick = wantsFirst ? pool[pool.length - 1] : pool[0];
        if (pick) lines.unshift(`${wantsFirst ? "First" : "Last"}${label ? ` ${label}` : ""}: ${apptLine(pick)}.`);
        else lines.unshift(`No past ${name}s yet.`);
      }
      if (/\bnext\b/i.test(question) || (ask.upcoming && !ahead.length)) {
        lines.push(ahead.length ? `Next: ${apptLine(ahead[0])}.` : `No ${name}s scheduled ahead.`);
      }
      if (ahead.length) blocks.push(block(`Upcoming (${ahead.length}) · soonest first`, ahead));
      if (past.length && !ask.upcoming) blocks.push(block(`Past (${past.length}) · newest first`, past));
      const unmarked = past.filter((r) => r.status === "Scheduled");
      if (unmarked.length) flag = `${plural(unmarked.length, `past ${name}`)} ${unmarked.length === 1 ? "is" : "are"} still marked Scheduled.`;
    }
  }
  if (typesNote) lines.push(typesNote);
  const groups: GoatAnswerGroup[] = blocks.length ? [{ lead: "", blocks }] : [];
  return {
    title,
    lines,
    ...(groups.length ? { groups } : {}),
    source,
    section: "appointments",
    ...(flag ? { flag } : {}),
  };
}

/** Every appointment as plain lines, newest first, for Smart mode's sources. */
export function appointmentLinesForAi(appts: GoatAppointment[] | null): string[] {
  if (!appts) return [];
  return apptRows(appts).sort(byNewest).map((r) => apptLine(r));
}
