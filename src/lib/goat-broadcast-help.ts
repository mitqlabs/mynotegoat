/**
 * G.O.A.T. help for "Message patients" (broadcast texts): who a broadcast goes
 * to, how to send one. Pure and offline; answers with the same words as the
 * Handbook chapter (#chapter-message-patients). It never sends anything.
 */
import { BROADCAST_AUDIENCES } from "@/lib/reminder-automation";

export const BROADCAST_HANDBOOK_ANCHOR = "/handbook#chapter-message-patients";
const SETTINGS_LINK = { label: "Settings → Text Reminders → Message patients", href: "/settings" };

export interface BroadcastHelp {
  text: string;
  links: Array<{ label: string; href: string }>;
}

const BROADCAST_WORD =
  /\b(broadcasts?|mass\s+(?:text|message)s?|message\s+patients|text\s+blasts?|(?:text|message|msg)\s+(?:all|every(?:one|body)|all\s+(?:of\s+)?(?:my|our|the))\s+(?:active\s+|current\s+)?patients?|text\s+everyone)\b/i;

/** Returns null when the question isn't about broadcast texts. */
export function broadcastHelp(question: string, opts: { canSeeSettings?: boolean } = {}): BroadcastHelp | null {
  const raw = question.trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("@")) return null;
  if (!BROADCAST_WORD.test(raw)) return null;
  const links = [{ label: "Handbook → Message patients", href: BROADCAST_HANDBOOK_ANCHOR }, ...(opts.canSeeSettings === false ? [] : [SETTINGS_LINK])];
  const audiences = BROADCAST_AUDIENCES.map((a) => `• ${a.label}: ${a.summary}`).join("\n");
  const who = /\b(who|whom|which patients|audience|send to|sends to|goes to|go to|everyone|all patients|active)\b/i.test(raw);
  const steps = [
    "To send one: Settings → Text Reminders → Message patients. Type the message, pick Send to, check the count (tap it to see the names), then Queue message and confirm \"Text N patient(s)?\".",
    "It goes out through your office device (iPhone Shortcut or iMac). On the iPhone, tap Send now from this device to send it right away.",
  ].join("\n");
  const rules =
    "Always left out: patients with no valid phone number, patients marked \"no text reminders\" or who replied STOP, and repeat phone numbers (one text per phone). \"Active\" means the Patients list status Active (Discharged, Ready to Submit, Submitted, Dropped and Paid are not). Quiet hours still apply, so nothing sends overnight. More choices (All patients, Patients seen in a time period) are planned.";
  return {
    text: who
      ? `A broadcast goes to the group you pick under Send to:\n${audiences}\n\n${rules}\n\n${steps}`
      : `${steps}\n\nSend to choices:\n${audiences}\n\n${rules}`,
    links,
  };
}
