/**
 * G.O.A.T. help for Key Dates: what Closed / Covered / Open mean, and what each
 * does to text reminders. Pure and offline; same words as the Handbook
 * (#chapter-schedule → "Days the office is closed"). It never changes anything.
 */
export const KEYDATES_HANDBOOK_ANCHOR = "/handbook";
const KEYDATES_LINK = { label: "Key Dates", href: "/key-dates" };

export interface KeyDatesHelp {
  text: string;
  links: Array<{ label: string; href: string }>;
}

const KEY_DATES = /\bkey\s*dates?\b/i;
const CLOSED_OR_COVERED = /\b(closed|covered|(?:i'?m|i\s+am|we'?re|we\s+are)\s+(?:out|away))\b/i;
const ABOUT_REMINDERS = /\b(reminders?|remind|texts?|texted|texting|messages?)\b/i;
// A command ("text everyone we're closed Thursday") is never answered with help.
const COMMAND = /^\s*(?:please\s+)?(?:text|tell|send|message|msg|remind|broadcast|let|notify|email|call)\b/i;
const QUESTION = /\b(why|what|how|when|still|even though|but|didn'?t|did|does|do|should|mean|means|happen|happens|work|works)\b|\?/i;
// Questions that are really about the schedule or patients, not Key Dates.
const OTHER_TOPIC = /\b(case|note|notes|bill|billing|invoice|claim)\b/i;

/** Returns null when the question isn't about Key Dates. */
export function keyDatesHelp(question: string): KeyDatesHelp | null {
  const raw = question.trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("@")) return null;
  if (COMMAND.test(raw)) return null;
  const about = KEY_DATES.test(raw) || (CLOSED_OR_COVERED.test(raw) && ABOUT_REMINDERS.test(raw) && QUESTION.test(raw));
  if (!about || (!KEY_DATES.test(raw) && OTHER_TOPIC.test(raw))) return null;
  const text = [
    "Key Dates (Key Dates page) tell NoteGoat which days the office is not a normal day. Pick one status:",
    "• Closed: the office is shut. Scheduling is blocked and NO text reminders go out for that day (single date or a range). The reason is only a label, so \"Texas\" or \"Vacation\" is fine.",
    "• Covered: someone covers for the doctor. Visits stay bookable and text reminders STILL go out. If you want patients NOT reminded, use Closed.",
    "• Open: a normal working day, such as a holiday you work.",
    "A Closed day stops appointment reminders only. Message patients texts are never blocked by a Key Date.",
    "Add \"Open from / until\" hours to make a partial day: visits outside those hours get no reminders.",
    "Set it BEFORE the reminder run. Texts already sent can't be recalled; changing a day to Closed afterwards only stops anything not yet sent. Reminders for a day go out the day before.",
    "In the Configured Key Dates table, every row (past or future; Open, Closed or Covered) shows a grey count like \"28 appointments\" or \"18 appointments · 10 canceled\"; \"—\" means none. Click it to see every appointment on that date at the bottom (canceled ones are tagged Canceled), with a \"Showing 10/29/26 only · Show all\" bar. A red \"8 still booked\" is added only on a Closed day that hasn't passed and still has Scheduled or Reschedule visits (Canceled, No Show and seen visits aren't counted); click it to see just those in the Warning List. \"Show past & cleared\" at the bottom of the Warning List holds old and cleared items. You can cancel, reschedule or text those patients (Settings → Text Reminders → Message patients → All active patients).",
  ].join("\n");
  return { text, links: [KEYDATES_LINK, { label: "Handbook", href: KEYDATES_HANDBOOK_ANCHOR }] };
}
