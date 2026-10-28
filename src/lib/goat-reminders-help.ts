/**
 * G.O.A.T. help for text reminders: "reminders didn't send", "how do I set up
 * 8 AM reminders". Pure and offline; answers with the same steps as the
 * Handbook chapter (#chapter-text-reminders) and the checklist on the page.
 */
import { HOWTO_QUESTION } from "@/lib/goat-howto";

export const REMINDERS_HANDBOOK_ANCHOR = "/handbook#chapter-text-reminders";
const SETTINGS_LINK = { label: "Settings → Text Reminders", href: "/settings" };

export interface RemindersHelp {
  text: string;
  links: Array<{ label: string; href: string }>;
}

const hourText = (sendHour?: number) => {
  const h = typeof sendHour === "number" ? sendHour : 8;
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`;
};

const AUTOMATION_STEPS = (time: string) =>
  [
    "1. On the office iPhone, open Shortcuts and tap the back arrow out of \"All Shortcuts\" to the main screen.",
    "2. Open Automation and tap +, then choose Time of Day.",
    `3. Set ${time}, Repeat: Every Day. Turn Automation (Run Immediately) ON and Notify When Run OFF.`,
    "4. In the search bar at the bottom type Run Shortcut and tap it. Tap the blue Shortcut word and pick Send-Reminders. Leave Input empty.",
    `5. Rename it (for example "${time.replace(":00", "")} Reminders") and save.`,
    "6. If iOS asks the first time it texts, tap Always Allow.",
  ].join("\n");

const NOTES = "Running every day is fine. NoteGoat only sends when reminders are due and never texts anyone twice. Keep just one automation.";

const SETUP =
  /\b(set\s*up|setup|schedule|automat\w*|turn on|create|make|install|configure|8\s*(?:am|a\.m\.)|eight|morning)\b/i;
const REMINDER_WORD = /\b(reminders?|remind|texts?|shortcuts?|automations?)\b/i;
const TROUBLE =
  /\b(didn'?t|did not|don'?t|do not|doesn'?t|does not|not|never|won'?t|stopped|isn'?t|aren'?t|haven'?t|hasn'?t|no)\b.{0,40}\b(send|sent|sending|go out|went out|text(?:ed)?|run|running|work(?:ing)?|fire|firing|auto)\b|\b(not|never)\s+(?:auto\w*\s+)?(sending|sent|texting|running|working)\b|\bwhy\b.{0,30}\b(reminders?|texts?)\b.{0,30}\b(not|didn'?t|never)\b/i;
const MENTIONS_IPHONE_PIECE = /\b(reminders?|remind|texts?|shortcut|automation|8\s*am|8:00)\b/i;

/** Returns null when the question isn't about setting up or troubleshooting automatic reminders. */
export function remindersHelp(question: string, opts: { sendHour?: number; canSeeSettings?: boolean } = {}): RemindersHelp | null {
  const raw = question.trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("@")) return null;
  if (!MENTIONS_IPHONE_PIECE.test(raw) || !REMINDER_WORD.test(raw)) return null;
  const time = hourText(opts.sendHour);
  const links = [{ label: "Handbook → Text reminders", href: REMINDERS_HANDBOOK_ANCHOR }, ...(opts.canSeeSettings === false ? [] : [SETTINGS_LINK])];

  const trouble = TROUBLE.test(raw);
  const isSetup = SETUP.test(raw) && (HOWTO_QUESTION.test(raw) || /\b(8\s*(?:am|a\.m\.)|automation|schedule|set\s*up|setup)\b/i.test(raw));
  const aboutAutomation = /\b(automat\w*|auto|8\s*(?:am|a\.m\.)|shortcut|iphone)\b/i.test(raw) || /\breminders?\b/i.test(raw);
  if (!trouble && !isSetup) return null;
  if (!aboutAutomation) return null;
  // Don't hijack "how do I text a patient" or opt-out questions.
  if (/\b(opt(?:ed)?[\s-]*out|stop texting|unsubscribe|template|wording|message patients)\b/i.test(raw) && !trouble) return null;

  if (trouble) {
    return {
      text: [
        `If reminders didn't go out by themselves, the most common cause is the ${time} automation was never created. The Send-Reminders shortcut does NOT run by itself; iOS can't put a schedule inside a shortcut.`,
        "",
        "Check this first: on the office iPhone open Shortcuts → Automation. If the list is empty, do this once:",
        AUTOMATION_STEPS(time),
        "",
        NOTES,
        "If the automation is already there, open it and make sure it's on, Every Day, Run Immediately, and runs Send-Reminders. Then in Text Reminders check that Send reminders automatically is on, Dry run is off, today is a run day, and read Recent sends for skipped patients (opted out, no phone, or not on a Scheduled visit). To send right now, use Send Reminders Now.",
      ].join("\n"),
      links,
    };
  }
  return {
    text: [
      `Setting up ${time} reminders is 3 steps. Step 2 is required because the shortcut does NOT run by itself.`,
      "Step 1 (one time): Settings → Templates → Text Reminders → + Add iPhone, copy the code, and add the Send-Reminders shortcut.",
      `Step 2 (required): create the ${time} automation on the iPhone:`,
      AUTOMATION_STEPS(time),
      NOTES,
      "Step 3: tick Send reminders automatically (and untick Dry run once Recent sends looks right). Then tick \"I created the " + time + " automation\" on the page.",
    ].join("\n"),
    links,
  };
}
