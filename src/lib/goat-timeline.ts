/**
 * One patient timeline from everything G.O.A.T. knows: file facts, appointments,
 * encounters, the Specialist and imaging boxes and the case dates. Compact text
 * of it goes to + mode (instead of raw report excerpts).
 */
import { dayStamp, type GoatContext } from "@/lib/goat";
import type { FileFacts } from "@/lib/goat-facts";
import { toMDY } from "@/lib/goat-referrals";

export interface TimelineEvent {
  day: number;
  date: string; // MM/DD/YYYY
  what: string;
  source: string;
  fileId?: string;
}

const norm = (d: string) => {
  const s = (d ?? "").trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const mdy = iso ? `${iso[2]}/${iso[3]}/${iso[1]}` : toMDY(s);
  const day = dayStamp(mdy);
  return day === null ? null : { day, date: mdy };
};

const LABEL_TEXT: Record<string, string> = {
  referral: "referred", visit: "seen", exam: "exam / study", injury: "injury", report: "report dated", scheduled: "scheduled", "follow-up": "follow-up", other: "date",
};

export function buildTimeline(ctx: GoatContext, facts: FileFacts[]): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const add = (d: string, what: string, source: string, fileId?: string) => {
    const n = norm(d);
    if (n && !ev.some((e) => e.day === n.day && e.what === what)) ev.push({ ...n, what, source, fileId });
  };
  add(ctx.doi, "Injury / accident (DOI)", "Case");
  add(ctx.initialExam, "Initial exam", "Case");
  for (const a of ctx.appointments ?? []) add(a.date, `Appointment: ${a.type} (${a.status})`, "Appointments");
  for (const e of ctx.encounters ?? []) add(e.date, `Encounter note: ${e.type}${e.signed ? "" : " (unsigned)"}`, "Encounters");
  for (const im of ctx.imaging) {
    const what = `${im.modality}${im.regions.length ? ` ${im.regions.join("/")}` : ""}${im.center ? ` at ${im.center}` : ""}`;
    add(im.sentDate, `${what}: sent`, "Imaging box");
    add(im.scheduledDate, `${what}: scheduled`, "Imaging box");
    add(im.doneDate, `${what}: done${im.findings ? ` — ${im.findings.slice(0, 160)}` : ""}`, "Imaging box");
    add(im.reportReceivedDate, `${what}: report received`, "Imaging box");
  }
  for (const s of ctx.specialists) {
    add(s.sentDate, `Referred to ${s.name}`, "Specialist box");
    add(s.scheduledDate, `${s.name}: scheduled`, "Specialist box");
    add(s.completedDate, `${s.name}: seen`, "Specialist box");
    add(s.reportReceivedDate, `${s.name}: report received`, "Specialist box");
  }
  for (const f of facts) {
    const who = [f.doctor, f.specialty].filter(Boolean).join(", ");
    for (const d of f.dates) add(d.date, `${f.docType}${who ? ` (${who})` : ""}: ${LABEL_TEXT[d.label] ?? d.label}`, f.fileName, f.fileId);
    if (!f.dates.length && f.mainDate) add(f.mainDate, `${f.docType}${who ? ` (${who})` : ""}`, f.fileName, f.fileId);
  }
  return ev.sort((a, b) => a.day - b.day);
}

/** Short text for the prompt: most recent events win when it's long. */
export function compactTimeline(events: TimelineEvent[], max = 40): string {
  // Collapse runs of routine chiro appointments into a count.
  const rows: string[] = [];
  let run: TimelineEvent[] = [];
  const flush = () => {
    if (run.length > 3) rows.push(`${run[0].date}–${run[run.length - 1].date}: ${run.length} appointments (${[...new Set(run.map((r) => r.what.replace(/^Appointment: /, "")))].slice(0, 3).join("; ")})`);
    else run.forEach((r) => rows.push(`${r.date}: ${r.what}`));
    run = [];
  };
  for (const e of events) {
    if (e.source === "Appointments" && /Check Out|Completed|Attended/i.test(e.what)) run.push(e);
    else {
      flush();
      rows.push(`${e.date}: ${e.what}${e.source.endsWith(".pdf") || e.fileId ? ` [${e.source}]` : ""}`);
    }
  }
  flush();
  return rows.slice(-max).join("\n");
}
