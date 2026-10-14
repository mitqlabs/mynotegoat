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
  office?: Pick<OfficeSettings, "officeName" | "doctorName"> & { phone?: string };
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
    "{{DATE}}": ctx.appointment?.date ?? "",
    "{{APPOINTMENT_TYPE}}": ctx.appointment?.type ?? "",
    "{{OFFICE_NAME}}": ctx.office?.officeName ?? "",
    "{{DOCTOR_NAME}}": ctx.office?.doctorName ?? "",
    "{{OFFICE_PHONE}}": ctx.office?.phone ?? "",
  };
  return body.replace(/\{\{[A-Z_]+\}\}/g, (tok) =>
    Object.prototype.hasOwnProperty.call(map, tok) ? map[tok] : tok,
  );
}
