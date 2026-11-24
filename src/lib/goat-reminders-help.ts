/**
 * G.O.A.T. help for text reminders: "reminders didn't send", "how do I set up
 * 8 AM reminders". Pure and offline; answers with the same steps as the
 * Handbook chapter (#chapter-text-reminders) and the checklist on the page.
 */
import { HOWTO_QUESTION } from "@/lib/goat-howto";
import { catchUpClockLabels } from "@/lib/reminder-automation";

export const REMINDERS_HANDBOOK_ANCHOR = "/handbook#chapter-text-reminders";
const SETTINGS_LINK = { label: "Settings → Text Reminders", href: "/settings" };

export interface RemindersHelp {
  text: string;
  links: Array<{ label: string; href: string }>;
}

const hourText = (sendHour?: number) => catchUpClockLabels(typeof sendHour === "number" ? sendHour : 8)[0];

const AUTOMATION_STEPS = (sendHour?: number) => {
  const [atSend, atHalf, atNext] = catchUpClockLabels(typeof sendHour === "number" ? sendHour : 8);
  return [
    "1. On the office device, open NoteGoat, Settings, Text Reminders, and use Add to this Device. Then tap Add Shortcut. The code is already filled in.",
    "2. Open Shortcuts. Tap Automation. Tap +. Tap Time of Day.",
    `3. Set ${atSend}. Tap Every Day. Tap Run Immediately. Turn Notify When Run off. Tap Next. Tap NoteGoat. Tap Done.`,
    `4. Do that again for ${atHalf}, then again for ${atNext}.`,
    "5. Tap +. Tap Message. Tap Message Contains. Type STOP. Tap Done. Tap Run Immediately. Turn Notify When Run off. Tap Next. Tap NoteGoat. Tap Done.",
    "6. Come back to Text Reminders and tap Test. It should say STOP catcher working.",
  ].join("\n");
};

const NOTES = "Running every day is fine. NoteGoat only sends when reminders are due and never texts anyone twice. Keep these three automations and delete any other copy.";

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
        `If reminders didn't go out by themselves, the most common cause is the ${time} run was never created. The NoteGoat shortcut does NOT run by itself; you set it to run by itself. It used to be called Send Reminders.`,
        "",
        "Check this first: on the office iPhone open Shortcuts → Automation. If the list is empty, do this once:",
        AUTOMATION_STEPS(opts.sendHour),
        "",
        NOTES,
        "If they are already there, open each one and make sure it's on, Every Day, Run Immediately (not Ask Before Running), Notify When Run is off, and it runs NoteGoat. There should be three times plus one for messages that contain STOP. Then in Text Reminders check that Send reminders automatically is checked, Test mode is unchecked (while it is checked, nothing is texted), today is one of the Run days, and read Recent sends. Tap Test. A red line at the top means this morning did not finish, or a STOP reply did not match a patient. To send right now, open Shortcuts and tap NoteGoat.",
      ].join("\n"),
      links,
    };
  }
  return {
    text: [
      `Setting up ${time} reminders: Step 2 is required because the shortcut does NOT run by itself.`,
      "On the office device, open Settings → Text Reminders and use Add to this Device, then Add Shortcut. The code is already filled in.",
      `Then set it to run by itself:`,
      AUTOMATION_STEPS(opts.sendHour),
      NOTES,
      "Check Send reminders automatically. Test mode starts checked, so nothing is texted yet. Once Recent sends looks right, uncheck Test mode. Tap Test. It says STOP catcher working when the phone has reported in.",
    ].join("\n"),
    links,
  };
}

const PAGE_TOPIC = /\b(text reminders?|reminders? (?:page|settings|screen)|set\s*up (?:section|card)|recent (?:sends|messages)|last run|last checked|run summary|sending devices?)\b/i;
const PAGE_ASK =
  /\b(collaps\w*|expand\w*|sections?|layout|hide|hidden|where (?:did|is|are|do)|too much|date format|dates?|mm\/dd|last run|last checked|run summary|\d+ sent|count)\b/i;

/**
 * "Where did the setup steps go on Text Reminders", "why does last run say 1 sent",
 * "what format are the dates". Pure and offline; same answer as the Handbook
 * (#chapter-text-reminders, "How the Text Reminders page is laid out").
 */
export function reminderPageHelp(question: string, opts: { canSeeSettings?: boolean } = {}): RemindersHelp | null {
  const raw = question.trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("@")) return null;
  if (!PAGE_TOPIC.test(raw) || !PAGE_ASK.test(raw)) return null;
  const links = [{ label: "Handbook → Text reminders", href: REMINDERS_HANDBOOK_ANCHOR }, ...(opts.canSeeSettings === false ? [] : [SETTINGS_LINK])];
  return {
    text: [
      "Settings → Text Reminders has three sections: Set up, Auto Texts and Broadcast. Tap a heading to open or close it; NoteGoat remembers it for the whole office.",
      "• Set up: five cards, each with a Done / To do / Optional tag and a one-line summary. Tap a card to open it. The cards are the 3-step checklist, Sending devices (+ Add iPhone / + Add Mac, Main sender or Backup sender, last checked, last run), How it works, Opt-out (STOP), iPhone setup and iMac setup. The whole Set up section starts closed once the 8 AM automation box is checked and a device has run. A red \"automation may not be set up\" warning stays at the top even when Set up is closed.",
      "• Auto Texts: a row for Reminders and a row for Birthday, each with an On/Off switch and a menu to pick the message it sends. Test mode, send time and run days are under the rows.",
      "• Saved messages live in Settings → Templates → SMS / Text Templates (add, edit or delete there), then pick one for each Auto Text. Broadcast: send one text to many patients, plus Recent sends.",
      "• Texts: Message patients and Recent sends. It starts open. Recent messages and Recent sends can each be closed too.",
      "Every date on the page is mm/dd/yy. A device's last run shows the day's running total, for example \"10/29/26: 14 sent\" (everything logged for that day, not just the last batch).",
    ].join("\n"),
    links,
  };
}

const MAC_TOPIC = /\b(i?mac|macbook|mac setup|setup file|\.command|not opened|open anyway|move to trash|gatekeeper|sequoia)\b/i;
const MAC_ASK = /\b(not opened|open anyway|move to trash|blocked|can'?t open|cannot open|won'?t open|malware|apple|sequoia|set\s*up|setup|install|how)\b/i;

/**
 * "The iMac says Not Opened", "how do I set up the iMac". Pure and offline; same
 * steps as Settings → Text Reminders → iMac setup and the Handbook.
 */
export function macSetupHelp(question: string, opts: { canSeeSettings?: boolean } = {}): RemindersHelp | null {
  const raw = question.trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("@")) return null;
  if (!MAC_TOPIC.test(raw) || !MAC_ASK.test(raw)) return null;
  if (!/\b(remind\w*|texts?|notegoat|setup file|\.command|not opened|open anyway)\b/i.test(raw) && !/\bi?mac\b/i.test(raw)) return null;
  const links = [{ label: "Handbook → Text reminders", href: REMINDERS_HANDBOOK_ANCHOR }, ...(opts.canSeeSettings === false ? [] : [SETTINGS_LINK])];
  return {
    text: [
      "iMac setup is in Settings → Text Reminders → Set up → iMac setup. It is optional; the iPhone can send everything on its own.",
      "1. On the iMac, open Messages and make sure it is signed in to the office Apple ID.",
      "2. In NoteGoat, click + Add Mac and Copy setup code.",
      "3. Click Download iMac setup. In Downloads, right-click NoteGoat-Reminders-Setup.command, choose Open, then Open again.",
      "4. If macOS says \"Not Opened\" (newer macOS, such as Sequoia): click Done (not Move to Trash). Open System Settings → Privacy & Security, scroll down to the message about NoteGoat-Reminders-Setup.command, and click Open Anyway. Type your Mac password if it asks, then click Open Anyway again.",
      "5. Terminal opens. Paste the setup code, then type your Mac password (nothing shows while you type; that is normal). When it says All set, press Return.",
      "6. The first time it sends, macOS asks to let it control Messages. Click OK.",
    ].join("\n"),
    links,
  };
}

const BIRTHDAY_TOPIC = /\bbirthday\s*(?:texts?|messages?|shortcut|reminders?)\b|\b(?:texts?|messages?|wish(?:es)?)\b.{0,40}\bbirthday\b|\bhappy birthday\b/i;
const BIRTHDAY_ASK = /\b(do we|can we|can i|how (?:do|can|does|to)|turn on|turn off|enable|disable|set\s*up|setup|who gets|does|will|is there|automatic\w*|daily|every)\b/i;

/**
 * "Do we text patients happy birthday", "how do I turn on birthday texts".
 * Pure and offline; same answer as the Handbook (#chapter-text-reminders,
 * "Text patients happy birthday"). Never changes a setting and never sends.
 */
export function birthdayTextsHelp(question: string, opts: { canSeeSettings?: boolean; sendHour?: number } = {}): RemindersHelp | null {
  const raw = question.trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("@")) return null;
  // "text john happy birthday" is a request to send, not a question about the feature.
  if (/^(?:please\s+)?(?:text|send|message)\b/i.test(raw)) return null;
  if (!BIRTHDAY_TOPIC.test(raw) || !BIRTHDAY_ASK.test(raw)) return null;
  const links = [{ label: "Handbook → Text reminders", href: REMINDERS_HANDBOOK_ANCHOR }, ...(opts.canSeeSettings === false ? [] : [SETTINGS_LINK])];
  return {
    text: [
      "Yes. Birthday texts are one of the Auto Texts, and they text patients happy birthday on their birthday. It starts off. To turn it on: Settings → Text Reminders → Auto Texts → Birthday, turn the switch on, and pick the message it sends in the menu. You write and edit messages in Settings → Templates → SMS / Text Templates (use {first name} where the patient's first name goes). If you pick none, it sends \"Happy birthday, {first name}! From all of us at Prime Spine.\"",
      `It goes out with the daily ${hourText(opts.sendHour)} reminders from the same iPhone shortcut, so there is nothing new to set up on the phone.`,
      "Every patient with a date of birth and a phone number gets one, whatever their case status, on the day of their birthday (Feb 29 birthdays on Feb 28 in years with no Feb 29). Never patients marked \"no text reminders\" or who replied STOP, and each patient gets at most one a year. Test mode applies. If the phone fetches it and does not send it, the same day is tried again. A birthday is not sent late.",
    ].join("\n"),
    links,
  };
}
