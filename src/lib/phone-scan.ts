/**
 * Phone hand-off scanning (Scan window → "Scan with my phone").
 * Pure rules shared by the API routes and tests (no DOM, no Node).
 *
 * Life of one session (one patient/case, one staff member):
 *   waiting  → phone opened the link, nothing sent yet
 *   uploaded → phone sent the PDF; waiting for the desktop to file it
 *   saved    → desktop filed it in Patient Files; temp copy deleted
 *   revoked  → desktop closed / cancelled; temp copy deleted
 * The phone link works once (until a PDF is sent) and only for 10 minutes.
 */

export const PHONE_SCAN_TABLE = "phone_scan_sessions";
export const PHONE_SCAN_BUCKET = "user-files";
/** How long the QR link works on the phone. */
export const PHONE_SCAN_TTL_MS = 10 * 60_000;
/** How long the desktop has to pick up a sent scan before it's thrown away. */
export const PHONE_SCAN_PICKUP_MS = 30 * 60_000;
export const PHONE_SCAN_MAX_BYTES = 40 * 1024 * 1024;
export const PHONE_SCAN_MAX_PAGES = 40;

export type PhoneScanStatus = "waiting" | "uploaded" | "saved" | "revoked";

export interface PhoneScanRow {
  status: PhoneScanStatus;
  expires_at: string;
  uploaded_at?: string | null;
  created_by: string;
  workspace_id: string;
}

/** Temp object for a session. Random id only: no user or patient in the path. */
export function phoneScanPath(sessionId: string): string {
  return `phone-scan/${sessionId}.pdf`;
}

/** May the phone still send pages with this link? */
export function phoneCanUpload(row: PhoneScanRow, now = Date.now()): boolean {
  return row.status === "waiting" && Date.parse(row.expires_at) > now;
}

/** What the phone page is told. Anything not usable looks the same ("inactive"). */
export function phoneView(row: PhoneScanRow | null, now = Date.now()): "ready" | "sent" | "inactive" {
  if (!row) return "inactive";
  if (phoneCanUpload(row, now)) return "ready";
  if ((row.status === "uploaded" || row.status === "saved") && Date.parse(row.expires_at) > now) return "sent";
  return "inactive";
}

/** Only the staff member who made the QR, in that office, can see/collect it. */
export function desktopOwns(row: PhoneScanRow, callerUserId: string, workspaceId: string): boolean {
  return !!callerUserId && row.created_by === callerUserId && row.workspace_id === workspaceId;
}

/** Status the desktop sees, with timeouts applied. */
export function desktopStatus(row: PhoneScanRow, now = Date.now()): PhoneScanStatus | "expired" {
  if (row.status === "waiting" && Date.parse(row.expires_at) <= now) return "expired";
  if (row.status === "uploaded") {
    const at = Date.parse(row.uploaded_at ?? row.expires_at);
    if (now - at > PHONE_SCAN_PICKUP_MS) return "expired";
  }
  return row.status;
}

/** A sent file really is a PDF of a sane size. */
export function looksLikePdf(head: Uint8Array, size: number): boolean {
  if (size < 64 || size > PHONE_SCAN_MAX_BYTES) return false;
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
}

/** Short, name-free label shown on the phone, e.g. "Case 26-0412-SMI". */
export function phoneScanLabel(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[^\w #.\-/]/g, "").trim().slice(0, 60) : "";
}
