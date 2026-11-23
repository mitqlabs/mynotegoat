/**
 * What the demo office is not allowed to do: anything that leaves NoteGoat.
 * Charts, notes, the schedule, billing numbers, files in this office's own
 * storage, and G.O.A.T. answering from this office's data are not on this list.
 */
import { DEMO_NOT_SENT, isDemoPrincipal, isDemoWorkspaceId, type DemoPrincipal } from "@/lib/demo-office";

export type OutboundAction =
  | "sms"
  | "email"
  | "goat-mail"
  | "ai"
  | "share"
  | "device"
  | "invite"
  | "billing"
  | "admin";

export interface OutboundDecision {
  blocked: boolean;
  message: string;
}

const AI_HOSTS = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "openrouter.ai",
  "api.x.ai",
];

const WRITE_TABLES = [
  "reminder_broadcasts",
  "reminder_broadcast_recipients",
  "reminder_devices",
  "reminder_log",
  "reminder_claims",
  "birthday_text_log",
  "goat_mail_connections",
  "patient_form_requests",
];

export function demoOutboundDecision(workspaceId: string | null | undefined, _action: OutboundAction): OutboundDecision {
  if (!isDemoWorkspaceId(workspaceId)) return { blocked: false, message: "" };
  return { blocked: true, message: DEMO_NOT_SENT };
}

export function demoUserBlocked(user: DemoPrincipal | null | undefined): boolean {
  return isDemoPrincipal(user);
}

/** Client and server share this so a bypassed button still cannot send. */
export function isBlockedDemoRequest(url: string, method: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://localhost");
  } catch {
    return false;
  }
  const path = parsed.pathname;
  const verb = method.toUpperCase();
  if (AI_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) return true;
  if (path.startsWith("/api/goat-mail")) return true;
  if (path.startsWith("/api/stripe")) return true;
  if (path.startsWith("/api/team/create-member") || path.startsWith("/api/team/remove-member")) return true;
  if (path.startsWith("/api/forms/send")) return true;
  if (path.startsWith("/api/reminders/")) return true;
  if (path.startsWith("/api/admin")) return true;
  if (verb === "GET" || verb === "HEAD") return false;
  return WRITE_TABLES.some((table) => path.includes(`/rest/v1/${table}`));
}
