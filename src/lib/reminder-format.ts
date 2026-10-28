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

/** A later "nothing to send" poll must not erase the day's real totals. */
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

export type ReminderSection = "setup" | "texts" | "messages" | "sends";

/** Open/closed state for a collapsible section. Unset = its default. */
export function sectionOpen(
  sections: Partial<Record<ReminderSection, boolean>> | undefined,
  key: ReminderSection,
  defaultOpen: boolean,
): boolean {
  const v = sections?.[key];
  return typeof v === "boolean" ? v : defaultOpen;
}

/** The composer's "Queued…" line. The iMac is named only when a Mac has really checked in. */
export function queuedStatusText(count: number, dryRun: boolean, macConnected: boolean): string {
  if (dryRun) return `Queued for ${count} patient(s). Dry run is on, so devices will only log it.`;
  return `Queued for ${count} patient(s). Run "Send Reminders Now" on your iPhone to send it now.${
    macConnected ? " The iMac also sends it automatically within about 10 minutes." : ""
  }`;
}

/** The composer's one-line description of where the text goes out from. */
export function sentFromText(macConnected: boolean): string {
  return macConnected ? "your iPhone or iMac" : "your iPhone";
}
