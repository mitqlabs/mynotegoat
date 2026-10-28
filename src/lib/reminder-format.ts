/**
 * Settings → Text Reminders display helpers. Every date on that page is shown
 * as mm/dd/yy, in the office's time zone. Pure; no browser APIs.
 */

const pad = (n: number | string) => String(n).padStart(2, "0");

/** "2026-10-29" → "10/29/26". Anything that isn't a plain ISO date is returned unchanged. */
export function fmtDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : (iso ?? "");
}

/** A timestamp as "10/28/26 9:05 AM" in the office time zone; "never" when empty. */
export function fmtDateTime(ts: string | null | undefined, timeZone = "America/Los_Angeles"): string {
  if (!ts) return "never";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "never";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")}/${get("year").slice(-2)} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

/** A timestamp's calendar day as mm/dd/yy in the office time zone. */
export function fmtDay(ts: string | null | undefined, timeZone = "America/Los_Angeles"): string {
  const t = fmtDateTime(ts, timeZone);
  return t === "never" ? "" : t.split(" ")[0];
}

/** Rewrites every ISO date inside free text: "2026-10-29: 14 sent" → "10/29/26: 14 sent". */
export function fmtRunSummary(summary: string | null | undefined): string {
  return (summary ?? "").replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_all, y: string, m: string, d: string) => `${pad(m)}/${pad(d)}/${y.slice(2)}`);
}

/**
 * The device's "last run" summary for one visit date: the day's running totals
 * (every text logged for that date), not just the batch the phone acked last.
 * The iPhone acks one text at a time, which made this read "1 sent" for 14.
 */
export function runSummary(visitDate: string, counts: { sent: number; failed: number; dryRun: number }): string {
  const parts = [`${counts.sent} sent`];
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.dryRun) parts.push(`${counts.dryRun} dry-run`);
  return `${visitDate}: ${parts.join(", ")}`;
}

/** A later "nothing to send" check must not erase the day's real totals. */
export function summaryAfterEmptyRun(previous: string | null | undefined, visitDate: string): string {
  const prev = previous ?? "";
  return prev.startsWith(`${visitDate}:`) && /\d+ (sent|dry-run)/.test(prev) ? prev : `${visitDate}: nothing to send`;
}

export interface DeviceLike {
  kind: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  last_run_at: string | null;
}

/** True only when an active (not revoked) Mac has actually checked in. */
export function officeMacSeen(devices: DeviceLike[]): boolean {
  return devices.some((d) => d.kind === "mac" && !d.revoked_at && Boolean(d.last_seen_at));
}

/** Setup is "done" once the 8 AM automation box is ticked and an active device has run. */
export function reminderSetupDone(automationConfirmed: boolean, devices: DeviceLike[]): boolean {
  return automationConfirmed && devices.some((d) => !d.revoked_at && Boolean(d.last_run_at));
}

export type ReminderSection = "setup" | "texts" | "messages" | "sends" | "steps" | "devices" | "how" | "optout" | "iphone" | "imac";

/** Open/closed state for a collapsible section. Unset = its default. */
export function sectionOpen(
  sections: Partial<Record<ReminderSection, boolean>> | undefined,
  key: ReminderSection,
  defaultOpen: boolean,
): boolean {
  const v = sections?.[key];
  return typeof v === "boolean" ? v : defaultOpen;
}

/** The line under "Send message". Nothing goes out until the iPhone runs; the iMac is named only when a Mac has really checked in. */
export function queuedStatusText(count: number, testMode: boolean, macConnected: boolean): string {
  if (testMode) return `Ready for ${count} patient(s). Test mode is on, so nothing will be texted. It will only be written in Recent sends.`;
  return `Ready for ${count} patient(s). Now run "Send Reminders Now" on the office iPhone to send it.${
    macConnected ? " The iMac also sends it by itself within about 10 minutes." : ""
  }`;
}

/** The composer's one-line description of where the text goes out from. */
export function sentFromText(macConnected: boolean): string {
  return macConnected ? "your iPhone or iMac" : "your iPhone";
}

/** "Last checked 10/28/26 10:41 AM", or "Has not checked in yet" for a device that never has. */
export function lastCheckedText(ts: string | null | undefined, timeZone = "America/Los_Angeles"): string {
  const when = fmtDateTime(ts, timeZone);
  return when === "never" ? "Has not checked in yet" : `Last checked ${when}`;
}

/** A device's last run as "Last run 10/29/26: 14 sent"; "" when it has not run. */
export function lastRunText(summary: string | null | undefined, runAt: string | null | undefined, timeZone = "America/Los_Angeles"): string {
  if (summary && summary.trim()) return `Last run ${fmtRunSummary(summary)}`;
  return runAt ? `Last run ${fmtDateTime(runAt, timeZone)}` : "";
}

/** The Opt-out card's collapsed summary: "On · 0 opted out". */
export function optOutSummary(lineOn: boolean, count: number): string {
  return `${lineOn ? "On" : "Off"} · ${count} opted out`;
}

export type CardStatus = "done" | "todo" | "optional" | "info";

/** Sending devices card: not done until a device is added; the summary names what is connected. */
export function devicesStatus(devices: Array<DeviceLike & { name: string; is_primary: boolean | null }>, timeZone = "America/Los_Angeles"): { status: CardStatus; summary: string } {
  const active = devices.filter((d) => !d.revoked_at);
  if (!active.length) return { status: "todo", summary: "No device yet. Click + Add iPhone to start." };
  const seen = active.map((d) => d.last_seen_at).filter((t): t is string => Boolean(t)).sort().pop();
  const names = active.length === 1 ? active[0].name : `${active.length} devices`;
  return { status: seen ? "done" : "todo", summary: `${names} · ${lastCheckedText(seen, timeZone)}` };
}

/** iPhone setup card: done once an active iPhone has checked in. */
export function iphoneStatus(devices: DeviceLike[]): { status: CardStatus; summary: string } {
  const ok = devices.some((d) => d.kind === "iphone" && !d.revoked_at && Boolean(d.last_seen_at));
  return ok
    ? { status: "done", summary: "Done. Your iPhone is connected." }
    : { status: "todo", summary: "Not done. Add the iPhone above, then follow these steps." };
}

/** iMac setup card: optional, done once a Mac has checked in. */
export function imacStatus(devices: DeviceLike[]): { status: CardStatus; summary: string } {
  return officeMacSeen(devices)
    ? { status: "done", summary: "Done. Your iMac is connected." }
    : { status: "optional", summary: "Optional. Only needed if you want the iMac to send too." };
}

/** "Main sender" / "Backup sender" for a device row. */
export function senderRole(isPrimary: boolean | null | undefined): string {
  return isPrimary ? "Main sender" : "Backup sender";
}

/** What each template word becomes in the text, in plain words. Keyed by the exact word you type. */
export const TEMPLATE_WORDS: { token: string; plain: string }[] = [
  { token: "{{FIRST_NAME}}", plain: "the patient's first name" },
  { token: "{{LAST_NAME}}", plain: "the patient's last name" },
  { token: "{{FULL_NAME}}", plain: "the patient's first and last name" },
  { token: "{{APPT_DATE}}", plain: "the day of the visit, like 10/29/2026" },
  { token: "{{TIME}}", plain: "the time of the visit, like 10:30 AM" },
  { token: "{{TODAY}}", plain: "today's date" },
  { token: "{{OFFICE_NAME}}", plain: "your office name" },
  { token: "{{DOCTOR_NAME}}", plain: "the doctor's name" },
  { token: "{{OFFICE_PHONE}}", plain: "your office phone number" },
];

/** The Result column in Recent sends, in plain words. */
export function plainResult(status: string): string {
  const s = status.toLowerCase();
  if (s === "sent") return "Sent";
  if (s === "failed") return "Did not send";
  if (s === "dry-run" || s === "dry_run") return "Test mode (not texted)";
  if (s === "skipped") return "Skipped";
  if (s === "queued") return "Waiting to send";
  if (s === "canceled" || s === "cancelled") return "Canceled";
  return status;
}
