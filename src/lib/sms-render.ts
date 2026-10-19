/**
 * Token rendering for text templates. Pure (no "use client"), so the
 * server-side reminder queue renders exactly what the Settings preview shows.
 */
import type { OfficeSettings } from "@/lib/office-settings";

export interface SmsTokenContext {
  patient?: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
  };
  appointment?: {
    time?: string; // e.g. "10:30 AM"
    date?: string; // e.g. "04/17/2026"
    type?: string;
  };
  /** Today as MM/DD/YYYY; defaults to the current Pacific date. */
  today?: string;
  office?: Pick<OfficeSettings, "officeName" | "doctorName"> & { phone?: string };
}

/** MM/DD/YYYY for a moment in the given time zone. */
export function todayUsDate(now: Date = new Date(), timeZone = "America/Los_Angeles"): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")}/${get("year")}`;
}

export function expandTokens(body: string, ctx: SmsTokenContext): string {
  const first = ctx.patient?.firstName ?? "";
  const last = ctx.patient?.lastName ?? "";
  const full = ctx.patient?.fullName ?? [first, last].filter(Boolean).join(" ");
  const map: Record<string, string> = {
    "{{FIRST_NAME}}": first,
    "{{LAST_NAME}}": last,
    "{{FULL_NAME}}": full,
    "{{TIME}}": ctx.appointment?.time ?? "",
    "{{APPT_DATE}}": ctx.appointment?.date ?? "",
    // Old alias of {{APPT_DATE}}; kept so saved templates don't break.
    "{{DATE}}": ctx.appointment?.date ?? "",
    "{{TODAY}}": ctx.today ?? todayUsDate(),
    // No longer offered in the UI; still renders for old templates.
    "{{APPOINTMENT_TYPE}}": ctx.appointment?.type ?? "",
    "{{OFFICE_NAME}}": ctx.office?.officeName ?? "",
    // Same as {{OFFICE_NAME}} (the practice name from Settings).
    "{{PRACTICE_NAME}}": ctx.office?.officeName ?? "",
    "{{DOCTOR_NAME}}": ctx.office?.doctorName ?? "",
    "{{OFFICE_PHONE}}": ctx.office?.phone ?? "",
  };
  return body.replace(/\{\{[A-Z_]+\}\}/g, (tok) =>
    Object.prototype.hasOwnProperty.call(map, tok) ? map[tok] : tok,
  );
}
