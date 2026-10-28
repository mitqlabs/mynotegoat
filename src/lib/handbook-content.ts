/**
 * The staff handbook — "How do I…?" for My Note Goat.
 *
 * Content lives here as data rather than JSX so it can be filtered by who
 * is reading. A chapter marked admin-only is not rendered for a manager or
 * staff member: the gate is the same roleTier the rest of the app uses, so
 * the handbook can never describe a door someone can't open. Chapters can
 * also name a `feature`, which hides them from anyone whose role has no
 * access to that page (a staff member with no Billing access is not told
 * how to use Billing).
 *
 * Writing rules for anyone editing this file:
 *   * steps are what the user clicks, in order, with the real button names;
 *   * `why` explains the rule behind the screen — the thing people get
 *     wrong when nobody tells them;
 *   * say what something does NOT do when that's the confusing part.
 */

import type { PortalFeature } from "@/lib/plan-access";
import { goatHandbookChapter } from "@/lib/handbook-goat";

/** Who a chapter is for. "all" = anyone who can sign in. */
export type HandbookAudience = "all" | "manager" | "admin";

export interface HandbookTask {
  heading: string;
  /** Numbered steps, in order. */
  steps?: string[];
  /** The rule behind it — why it behaves the way it does. */
  why?: string;
  /** A mistake worth heading off. */
  watchOut?: string;
}

export interface HandbookChapter {
  id: string;
  title: string;
  summary: string;
  audience: HandbookAudience;
  /** Also require access to this page before showing the chapter. */
  feature?: PortalFeature;
  tasks: HandbookTask[];
}

export const handbookChapters: HandbookChapter[] = [
  {
    id: "start-here",
    title: "Start here",
    summary: "What this app is, how to get around, and what to do when something looks wrong.",
    audience: "all",
    tasks: [
      {
        heading: "Signing in and what you'll see",
        steps: [
          "Go to mynotegoat.com and sign in with the email and password the office gave you.",
          "The dark sidebar on the left is every page you're allowed to open. If a page isn't listed, your role doesn't include it — that's deliberate, not a fault.",
          "The last item is Handbook — this page. It's always there.",
        ],
        why: "Your role decides what you see. An admin sets roles in Settings, and both the sidebar and this handbook follow them, so you're never shown steps for a page you can't reach.",
      },
      {
        heading: "If the app says \"Cloud sync failed — app is locked\"",
        steps: [
          "Press Retry first. Most of the time it opens normally.",
          "If it locks again, press Copy error details and send that text to the office manager.",
          "Then press Sign out and sign back in.",
        ],
        watchOut:
          "Don't press \"Open Anyway (Offline Mode)\" unless someone tells you to. It opens the app without confirming it has the latest data, and an amber banner will stay on screen until you reload. Tell someone rather than working through it.",
        why: "The app refuses to open when it can't confirm it has the current records, so an out-of-date copy on your screen can never overwrite good data in the cloud.",
      },
      {
        heading: "If something you typed seems to have vanished",
        steps: [
          "Reload the page once before anything else — most often the work is saved and the screen is stale.",
          "Check the patient's own page rather than a list; lists can lag a moment behind.",
          "If it's still missing, tell an admin the patient name and roughly when you typed it. Admins can look it up in the Activity Log.",
        ],
        watchOut: "Don't retype a whole note until someone has checked. Two copies of a note is a worse problem than a missing one.",
      },
    ],
  },
  {
    id: "patient-list",
    title: "Patient List",
    summary: "Finding patients, the filters, and taking in a new one.",
    audience: "all",
    feature: "patients",
    tasks: [
      {
        heading: "Find a patient",
        steps: [
          "Open Patient List.",
          "Type the name in Search. First or last name, in either order.",
          "Click the patient's name to open their page.",
        ],
        why: "The list opens on the current year so it isn't your whole history every time. Search ignores that — it looks across every year — so an old patient is always one search away. While you're searching the summary line says \"all years\".",
      },
      {
        heading: "Narrow the list",
        steps: [
          "Year and month: the stretch of time the list covers, by initial exam (or date of injury if there's no exam yet).",
          "Attorney, Case Status and Review: narrow to one of each.",
          "The line above the table always says how many patients match and which filters are on.",
        ],
        watchOut:
          "A patient who isn't showing is usually a filter, not a missing record. Set Year to \"All years\" before concluding anything is gone.",
      },
      {
        heading: "Take in a new patient",
        steps: [
          "Got a text with just a name and number? Patient List → New Patient. Only Last Name, First Name and Phone are required; DOB, Sex, Marital Status and the address are optional.",
          "Know the case details already? Tap + Case in the same popup: Attorney, Attorney Phone, Date of Injury (the Case # builds itself from it). Otherwise skip it.",
          "Already set their first visit? Fill Appt Date and Time in + Case. Saving books a New Patient visit on the Schedule (office hours and open times are checked first, and you'll see a message if the time doesn't work). Leave Appt Date blank and nothing is booked. While the patient's Initial Exam box is blank, it shows that visit's date everywhere (patient page, notes, reports, heads-ups, G.O.A.T.) and follows the visit if it's moved or canceled, so you don't type it twice. A date you type in the box always wins. On the patient's page, + Case has no Appt boxes; book later visits from the Schedule.",
          "Create Patient. Their page shows a gentle \"Case info missing\" note with a + Case button until there's an attorney or Date of Injury. It never blocks anything.",
          "Book the first visit from the Schedule: New Appointment → Existing (pick them) or New patient (Last, First and Phone required, DOB optional). With one provider and one location, those are filled in for you. While their Initial Exam box is blank it shows the first New Patient visit's date (in blue) and follows that visit if it's moved or canceled. Type a date in the box (e.g. 06/26/2026) and yours sticks: moving, rescheduling or canceling visits never changes it, and changing the box never moves or deletes a visit.",
          "Non-PI (cash) patients: tick Non-PI in the popup. They have no case info and never appear in Case Flow.",
        ],
        why: "A new case always starts the same way, so the app sets it for you: Case Status Active, Lien/LOP Pending, and a \"Schedule Initial Visit\" item on their Case Flow. You change those on the patient's page as things move.",
        watchOut:
          "Tick Non-PI Patient only for cash/self-pay patients. It removes the attorney, injury date and case-number workflow, and those patients never appear in Case Flow.",
      },
      {
        heading: "Compliance column — turn it on and use it",
        steps: [
          "Settings → Office tab → Case Status Categories → tick Compliance column. It is off by default.",
          "Patient List now has a Compliance column right after Status, and a Compliance filter next to the Case Status filter.",
          "Click a patient's Compliance pill to pick a value from the menu — it works like the Case Status pill and saves right away. The choices start as New Patient, Yes, No, DNS ATM and Non-Compliant.",
          "Inside a patient's page, Compliance is a field next to Case Status, and shows as a Compliance pill in the top card once it is set.",
          "A patient with nothing chosen shows a grey Not set pill, never a blank cell. To list those patients, pick Not set in the Compliance filter.",
        ],
        why: "Compliance tracks how well a patient is following the care plan, separate from Case Status. Turning the column off only hides it — nothing already entered is lost. Who can change a value follows the same rule as editing patients.",
        watchOut:
          "No Compliance column? It has not been switched on yet. An admin turns it on in Settings → Office → Case Status Categories. To rename the choices, change their colors or add your own, see Compliance Categories in Where things live in Settings.",
      },
      {
        heading: "The office pill (offices with more than one location)",
        steps: [
          "Only offices with more than one location show it: a small grey pill beside the patient's name in Patient List.",
          "Click the pill, pick the office — or No office set to clear it. It saves right away and shows Saving…, then Saved (or Failed if it did not go through).",
          "The name area and the pill have fixed widths, so the pills line up in a column. A long name is cut off with … — hover it, or open the patient, to see the whole name.",
        ],
        why: "The pill is the patient's office. The office list at the top of Patient List filters by it, and a team member's Main location (Settings → Office → Team Members) decides which office they land on at sign-in.",
        watchOut: "Someone with view-only access to Patient List sees the pill but cannot click it to change it.",
      },
      {
        heading: "Case numbers and their format",
        steps: [
          "A new patient's Case # builds itself. By default it is the injury date + the first 2 letters of the last name + the first 2 of the first name — John Smith, injured 07/18/2026 → 071826SMJO.",
          "An admin can change the pattern: Settings → Office tab → Office Settings → Office Information → Case number format. Type a pattern or tap tokens such as {MMDDYY}, {LAST2}, {FIRST2}, {YYYY} or the counter {N3}.",
          "The line under the box shows an example (John Smith, injury 07/18/2026) as you type. Reset to default puts the original pattern back.",
        ],
        why: "The pattern in force is stamped on each patient when they are created, so changing the format only affects NEW patients. An existing case number, its files and its folder never change.",
        watchOut:
          "Only letters, numbers and - _ . # are allowed between tokens, because case numbers become file and folder names. While the pattern is invalid the box shows what is wrong and the last good pattern stays in use.",
      },
      {
        heading: "Attorney's phone fills itself",
        steps: [
          "Start typing the attorney's name — matching contacts appear.",
          "Pick one and their phone fills in automatically.",
          "If they're new, type the name and phone; the app adds them to Contacts for you.",
        ],
      },
    ],
  },
  {
    id: "case-flow",
    title: "Case Flow — what the office owes each patient",
    summary: "The queue of things not yet done, and exactly what makes each one go away.",
    audience: "all",
    feature: "patients",
    tasks: [
      {
        heading: "Reading the list",
        steps: [
          "Patient List → Case Flow.",
          "Each row is one outstanding thing for one patient. Age tells you how long it's been waiting.",
          "The chips above the table hide a whole category while you work through another.",
        ],
        why: "Rows aren't typed in by anyone — they appear from the state of the chart, and they disappear the moment the chart says the job is done. Nothing to tick off.",
      },
      {
        heading: "What clears each row",
        steps: [
          "Schedule Initial Visit — checked off once Patient Info has an Initial Exam date: the date typed in the box, or else the earliest New Patient appointment in any status (booked, checked in or out), or a New Patient note. A canceled or no-showed one doesn't count.",
          "Lien / LOP — clears when the lien status moves on from the one the office marks as outstanding.",
          "X-Ray — Needs Referral clears when a referral is added; the follow-up clears when the report is received.",
          "MRI / CT and Specialist — Needs Referral → Appt Not Scheduled → Report Not Received, each clearing when that date is filled in.",
        ],
        watchOut:
          "Marking a referral \"Patient Refused\" also clears it — that's the honest way to close something that's never coming, instead of leaving it to nag forever.",
      },
      {
        heading: "Clear task (ignore) — not the same as Done",
        steps: [
          "A row that will never clear on its own (e.g. a Lien task that stays \"needed\"): click Clear task on the row, then OK.",
          "It stops showing in Case Flow, the Case Flow counts, To-Do, Morning Rundown and /view todo, and it is not created again for that case.",
          "Nothing is deleted. Show cleared (N) lists every cleared item with who cleared it and when — Restore puts it back.",
          "To-Do has the same Clear task button for open to-dos.",
        ],
        why: "Done means the work happened. Clear means \"stop reminding us\". Clears are saved to the workspace, so every computer sees them.",
      },
    ],
  },
];

export const handbookChaptersOffice: HandbookChapter[] = [
  goatHandbookChapter,
  {
    id: "contacts",
    title: "Contacts",
    summary: "Attorneys, imaging centres and specialists — and cleaning up duplicate firm names.",
    audience: "all",
    feature: "contacts",
    tasks: [
      {
        heading: "Add a contact",
        steps: [
          "Contacts → Add Contact.",
          "Contact Name, then Category (Attorney, Imaging Center, Specialist, Acute Care…).",
          "Sub-Category: for a Specialist this is what they do — Pain Management, Orthopedic, Neurologist. Type it or pick a suggestion.",
          "Phone, fax, any email rows, address → Save Contact.",
        ],
        why: "For an Insurance Agent the sub-category is their company — State Farm, Allstate, Farmers — so the field is labelled Insurance Company. Sub-category is how people get found later. The search box covers it, and the referral pickers on the patient page and in SOAP macros group specialists under it. A specialist with no sub-category lands under \u201cOther\u201d.",
      },
      {
        heading: "Find someone by what they do",
        steps: [
          "Type into Search — it covers name, category, sub-category, phone, fax, email and address.",
          "So \u201cpain management\u201d finds the pain-management specialists without knowing a name.",
          "Or pick a Category first; a Specialty dropdown then appears beside it.",
        ],
      },
      {
        heading: "Edit or delete",
        steps: [
          "Edit turns the card into a form. Save or Cancel.",
          "Delete asks to confirm, and may ask for the delete password.",
        ],
        watchOut:
          "Who can add, edit and delete contacts is set per role in Settings → Office tab → Roles & Permissions. By default everyone can add, Managers and Admins can also edit, and Delete follows the Deleting rules. Add Contact, Consolidate Attorneys, and opening a card by its name only show when your role allows them — missing buttons are your role, not a fault.",
      },
      {
        heading: "Read the contact cards (the compact layout)",
        steps: [
          "Contacts shows one small card per contact, several across the page (more on a wide screen, one on a phone).",
          "Top of each card: the avatar with initials, the name, a coloured Category pill, and the Sub-Category underneath.",
          "Below that, only the lines the contact actually has: phone, fax, address, then each email. Empty lines and blank emails are skipped, so cards stay short.",
          "The first email carries a Main tag when there are several (that one is used on referral requests); extra emails show their name and label.",
          "Sort (Name or Category) and the Search box are above the cards, with a count such as \u201c24 contacts\u201d. Sorted by Category, the cards sit under a heading for each category with its count.",
        ],
        why: "The older table with Name / Category / Phone / Email columns was replaced by cards so more contacts fit on screen. Everything is still there — nothing was removed from a contact. Click the name to open and edit (when your role allows).",
      },
      {
        heading: "Consolidate Attorneys (tidy duplicate firm names)",
        steps: [
          "Contacts → Consolidate Attorneys.",
          "Each group is one firm typed several ways — \u201cJohn Smith\u201d, \u201cJohn Smith Law\u201d, \u201cJohn Smith Attorneys at Law\u201d.",
          "Type the spelling you want to keep at the top of the group.",
          "Tick the patients to move onto it — or Select all.",
          "If a spelling is genuinely a different firm, press Not the same and it's never suggested again.",
          "Apply Consolidation.",
        ],
        watchOut:
          "This rewrites the attorney name on patient records. It does not merge or delete contact cards — delete leftover duplicate cards yourself.",
      },
    ],
  },
  {
    id: "message-patients",
    title: "Message patients (broadcast texts)",
    summary: "Text a group of patients at once, such as \"we're closed Thursday\". Choose who gets it under Send to.",
    audience: "admin",
    tasks: [
      {
        heading: "Send a broadcast text",
        steps: [
          "Settings → Text Reminders → Message patients.",
          "Type the message (up to 640 characters).",
          "Pick Send to: All active patients (the default) or Booked on a day. For Booked on a day, also pick Today, Tomorrow or a date.",
          "Check the count under the message. Tap it to see exactly who will get the text.",
          "Tap Queue message, then confirm \"Text N patient(s)?\".",
          "Your office iPhone sends it: tap Send now from this device (or run Send Reminders Now). If an iMac is connected, it also sends it within about 10 minutes. The \"Queued\" line only mentions the iMac when one has actually checked in.",
        ],
        why: "Everything is saved in your workspace, so every computer and team member sees the same list and Recent messages.",
        watchOut: "Confirm shows the number of patients. If it's higher than you expected, open the list before you queue it.",
      },
      {
        heading: "Who gets it: the Send to choices",
        steps: [
          "All active patients: every patient whose case status on the Patients list is Active. Discharged, Ready to Submit, Submitted, Dropped, Paid and any other status are NOT included.",
          "Booked on a day: only patients with a visit on that day. You can limit it to a time window, and Skip canceled visits is on by default. Use this for \"we're closing early today\".",
          "Coming later: All patients, and Patients seen in a time period.",
        ],
        why: "Closed Thursday with nobody booked? Use All active patients. Booked on a day would text no one, because nobody is on Thursday's schedule.",
        watchOut: "A patient with no case status counts as Active, the same as a brand-new case.",
      },
      {
        heading: "Who is always left out",
        steps: [
          "Patients with no valid phone number.",
          "Patients marked \"no text reminders\", or who replied STOP. A reply of START turns it back on.",
          "Repeat phone numbers: if two patients share one phone (a parent and child), that phone gets one text.",
          "Quiet hours still apply. If you queue it at night, it goes out after quiet hours end (8:00 AM by default).",
        ],
        why: "One text per patient and per phone, and never to anyone who asked to stop.",
      },
      {
        heading: "Ask G.O.A.T.",
        steps: [
          "Ask \"who does broadcast send to\" or \"how do I text all active patients\". G.O.A.T. answers from this chapter and links here. It never sends a text itself.",
        ],
      },
    ],
  },
  {
    id: "messages",
    title: "Messages",
    summary: "The team feed: mentions, tagging a case, To-Dos and Eyes Only.",
    audience: "all",
    feature: "messages",
    tasks: [
      {
        heading: "Post a message",
        steps: [
          "Messages → type in the box.",
          "To mention someone, type @ and pick them from the dropdown.",
          "Tag a case (optional): type the case number or patient name and pick from the list.",
          "Send, or ⌘/Ctrl + Enter.",
        ],
        watchOut:
          "Typing @Jane by hand does not mention Jane. Only picking her from the dropdown notifies her — and only that counts for Eyes Only.",
      },
      {
        heading: "Turn a message into a To-Do",
        steps: [
          "Tick Add to To Do under the message box.",
          "Choose who it's for under Assign to…, and a priority.",
          "Send. The message becomes the task, linked to the case you tagged.",
        ],
      },
      {
        heading: "Eyes Only",
        steps: [
          "Tick 🔒 Eyes Only.",
          "@mention every person who should see it — the Send button stays disabled until you do.",
          "Replies inside that thread stay private to the same people.",
        ],
        why: "Eyes Only hides the message from everyone not named — including the owner and admins. It is not \u201cadmins can still read it\u201d. Use it for anything genuinely private.",
      },
      {
        heading: "Deleting",
        steps: [
          "✕ on a message deletes that one message.",
          "Delete thread appears on the first message of a thread that has replies — it removes the whole conversation.",
        ],
        watchOut:
          "Deletions are recorded in the Activity Log with a copy of the text, so an admin can see what was removed. (For an Eyes Only message the log records that it happened, but not the words.)",
      },
      {
        heading: "If a message posts to the wrong place",
        why: "Typing a patient's name in the case box without picking from the list posts to the General feed. A reply always lands in the thread it answers, whatever the case box says.",
      },
    ],
  },
  {
    id: "text-reminders",
    title: "Text reminders (8 AM automation)",
    summary: "Set up automatic appointment texts from the office iPhone, and what to do when they didn't send.",
    audience: "admin",
    tasks: [
      {
        heading: "How the Text Reminders page is laid out",
        steps: [
          "Settings → Text Reminders has two sections. Tap a heading to open or close it. NoteGoat remembers what you opened or closed for the whole office, on every computer.",
          "Set up is made of cards. Each card has a title, a tag (Done, To do or Optional) and one line that says where things stand. Tap a card to open it: Automatic reminders (3 steps), Sending devices, How it works, Opt-out (reply STOP), iPhone setup, iMac setup. The whole Set up section starts closed once the 8 AM automation box is ticked and a device has run, and open until then.",
          "Sending devices: one row per device with its name, iPhone or iMac, Primary, \u201cLast checked 10/28/26 10:41 AM\u201d and its last run. + Add iPhone and + Add Mac are at the top of the card. Make primary, New code and Revoke are on the right of each row.",
          "A new device's code (starts with ngr_) shows once, right after you add it or click New code. Click Copy code, paste it where the setup asks, then click Hide code. Do not share it: anyone who has it can send texts as your office.",
          "Texts (open by default): send settings (automatic sending, dry run, send time, run days, template), Message patients, and Recent sends.",
          "Recent messages (under Message patients) and Recent sends can each be closed on their own.",
          "The red warning \u201cYour 8 AM automation may not be set up\u201d always stays at the top, even when Set up is closed.",
          "Every date on the page is mm/dd/yy, for example 10/29/26.",
        ],
        why: "A device's last run shows the day's running total, for example \u201c10/29/26: 14 sent\u201d. It counts everything logged for that day, so it matches Recent sends. A later check with nothing left to send doesn't erase it.",
      },
      {
        heading: "Set up the iMac to send reminders (optional)",
        steps: [
          "The iPhone can send everything alone. The iMac is only a backup that sends within about 10 minutes. Skip this if you don't want it.",
          "On the iMac, open Messages and sign in to the office Apple ID.",
          "In NoteGoat: Settings → Text Reminders → Set up → Sending devices → + Add Mac. Click Copy code.",
          "Open the iMac setup card. Click Download iMac setup. In Downloads, right-click NoteGoat-Reminders-Setup.command, choose Open, then click Open.",
          "If macOS says \u201cNot Opened\u201d (newer macOS, such as Sequoia): click Done. Do NOT click Move to Trash. Open System Settings → Privacy & Security, scroll down to the message about NoteGoat-Reminders-Setup.command, and click Open Anyway. Type your Mac password if asked, then click Open Anyway again.",
          "Terminal opens. Paste the code, then type your Mac password (nothing shows as you type; that is normal). When it says All set, press Return.",
          "The first time it sends, macOS asks to let it control Messages. Click OK. The Sending devices card then shows the iMac with a Last checked time.",
        ],
        why: "The setup file isn't from the App Store, so newer macOS blocks it the first time. Open Anyway tells your Mac you trust it. You only do this once. The card's Advanced section has the same setup typed by hand in Terminal.",
      },
      {
        heading: "Set up automatic reminders on the iPhone (3 steps)",
        steps: [
          "Step 1 (one time): Settings → Templates → Text Reminders → + Add iPhone, copy the code, then add the Send-Reminders shortcut as shown under iPhone setup (Shortcuts app).",
          "Step 2 (REQUIRED): create the 8 AM automation. The shortcut does NOT run by itself. iOS can't put a schedule inside a shortcut, so you set the timer once, by hand. Steps are below.",
          "Step 3: tick Send reminders automatically in Text Reminders and, once Recent sends looks right in dry run, untick Dry run. Tomorrow morning check Recent sends to see it ran.",
          "On the Text Reminders page, tick \u201cI created the 8 AM automation\u201d when Step 2 is done. The card turns green.",
        ],
        why: "Installing the shortcut only gives the phone something to run. Nothing tells it when. The automation is the alarm clock, and only you can create it on the phone.",
      },
      {
        heading: "Step 2: create the 8 AM automation (about 30 seconds)",
        steps: [
          "On the office iPhone, open Shortcuts. If you're inside All Shortcuts or a folder, tap the back arrow until you reach the main screen.",
          "Open Automation and tap +.",
          "Choose Time of Day. Set 8:00 AM and Repeat: Every Day. Turn Automation (Run Immediately) ON and Notify When Run OFF.",
          "In the search bar at the bottom, type Run Shortcut and tap it. Tap the blue Shortcut word and pick Send-Reminders. Leave Input empty.",
          "Rename it at the top, for example 8 AM Reminders, then save.",
          "The first time it texts, iOS may ask permission. Tap Always Allow.",
        ],
        why: "Running every day is fine. NoteGoat only sends when reminders are due and never texts anyone twice.",
        watchOut: "Keep only one automation for this. If your office changed the send hour in Text Reminders, make the automation match that time.",
      },
      {
        heading: "Reminders didn't send",
        steps: [
          "Open the iPhone's Shortcuts → Automation tab. If it's empty, Step 2 was never done. Do it now.",
          "If the automation is there, tap it and check it's Every Day, Run Immediately is on, and it runs Send-Reminders.",
          "In NoteGoat, open Text Reminders and read Recent sends. Reminders are skipped for patients who opted out, have no phone number, or aren't on a Scheduled visit.",
          "Check that Send reminders automatically is on, Dry run is off, and today is one of the Run days.",
          "Need them out right now? Use Send Reminders Now in Text Reminders, or run the Send-Reminders shortcut by hand.",
        ],
        why: "If the phone hasn't sent by itself for two expected days, Text Reminders shows a red warning: \u201cYour 8 AM automation may not be set up — see Step 2\u201d.",
      },
    ],
  },
  {
    id: "reviews",
    title: "Reviews",
    summary: "Who to ask for a Google review, and what the four statuses mean.",
    audience: "all",
    feature: "patients",
    tasks: [
      {
        heading: "The four statuses",
        steps: [
          "Request — ready to ask. Nobody has asked this patient yet.",
          "Requested — we asked; waiting on the review.",
          "Received — it came in.",
          "Refrain — don't ask this patient.",
        ],
        watchOut:
          "Request and Requested are one letter apart and mean opposite things. Request = still to ask. If you asked someone, set them to Requested.",
      },
      {
        heading: "Work through who to ask",
        steps: [
          "Patient List → set the Review filter to Request.",
          "The count line tells you how many, and a Review column appears while the filter is on.",
          "Ask the patient, then change their pill to Requested right there — it saves immediately.",
        ],
        why: "Request only counts cases that aren't Active or Dropped — you shouldn't be asking someone mid-treatment or someone who walked away. Cash patients are left out of the Review tiles entirely.",
      },
      {
        heading: "Change one patient's review status",
        steps: [
          "Open the patient page.",
          "Top row, next to Case Status, is the Review pill.",
          "Pick a status — it saves as soon as you choose.",
        ],
      },
    ],
  },
  {
    id: "timers-marketing",
    title: "Timers and Marketing",
    summary: "Treatment-room countdowns, and the attorney outreach log.",
    audience: "all",
    tasks: [
      {
        heading: "Room timers",
        steps: [
          "Timers → find the room's card.",
          "Click a preset (e.g. 15 min) to start a countdown.",
          "Type into the Min box to add a new preset; hover a preset and press × to remove it.",
        ],
        why: "Timers live in the cloud, so one started at the front desk shows on the back-room iPad within a couple of seconds.",
        watchOut: "Rooms themselves aren't created here — an admin adds them in Settings → Office Settings → Schedule.",
      },
      {
        heading: "Log a marketing visit",
        steps: [
          "Marketing → pick Everyone, Attorneys or Insurance agents at the top.",
          "Find the firm or agent.",
          "Pick the date and the type — Visit, Lunch Drop-off, Call, Email, Gift, Meeting, Event, Other.",
          "Add notes and save.",
        ],
        watchOut:
          "Only Attorney and Insurance Agent contacts appear here. Case counts match on the attorney name written on each patient, so insurance agents show none — that's expected, not a gap. A firm spelled two ways shows split numbers; that's what Consolidate Attorneys fixes.",
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    summary: "The weekly picture, review follow-up, and who did what.",
    audience: "manager",
    feature: "statistics",
    tasks: [
      {
        heading: "Weekly Summary",
        steps: [
          "Dashboard → Weekly Summary.",
          "‹ and › step through weeks; Back to this week resets.",
          "Visits: checked out, checked in (note still open), canceled, no show, still scheduled.",
        ],
        watchOut:
          "\u201cVisits waiting on notes\u201d is all-time, not this week — it's every past visit still sitting at Checked In.",
      },
      {
        heading: "Activity Log — who did what",
        steps: [
          "Dashboard → Activity Log.",
          "Category pills narrow it (Billing only, Notes only…). Period defaults to the last 7 days.",
          "Person and the search box narrow it further; the search matches a patient name or the action text.",
          "Person lists your whole team — including someone with no activity yet — plus anyone who appears in the log. Pick one to see what they did AND what was done to them (for example \u201cchanged main location\u201d on their own login).",
        ],
        why: "Only milestones are recorded — created, closed, reopened, deleted — never keystrokes. Deletions carry a copy of what was removed, which is often the fastest way to put something back.",
        watchOut:
          "Managers see the log without anything an owner or admin did, and can't clear it or change how long it's kept. Deleting a contact is filed under Patients, not Contacts.",
      },
      {
        heading: "See which patients went to a referral place",
        steps: [
          "Dashboard → Statistics → Referral Totals.",
          "Click the facility or specialist name — the row looks like plain text, but it opens.",
          "You get every patient sent there: name (click to open them), date sent, XR and MR counts, case status.",
          "Tick a patient off as you work the list — the row turns green.",
        ],
        watchOut:
          "Those ticks live in your browser only. Nobody else sees them, and clearing browser data loses them. The list follows the filters at the top of Statistics.",
      },
    ],
  },
  {
    id: "roles",
    title: "Roles and access",
    summary: "Who can reach what, how to add someone, and the delete password.",
    audience: "admin",
    tasks: [
      {
        heading: "The four roles",
        steps: [
          "Owner — the account the office was created under. Same as Admin, plus the only one who can make or unmake Admins.",
          "Admin — everything: every page, Settings, Team, all deletes.",
          "Manager — runs the office. Pages, actions and deletes come from Settings → Roles & Permissions.",
          "Staff — the day-to-day pages; no deletes by default.",
        ],
      },
      {
        heading: "Add a team member",
        steps: [
          "Settings → Office tab → Team Members → + Team Member.",
          "Email, a temporary password (6+ characters), first and last name, their job title.",
          "Access role: Admin, Manager or Staff.",
          "Create Member.",
        ],
        watchOut:
          "Turning someone's Active toggle off blocks their login and shows \u201cOFF · no login\u201d — use that when someone leaves, rather than deleting them, so the Activity Log still makes sense.",
      },
      {
        heading: "Set a team member's main location",
        steps: [
          "Settings → Office tab → Team Members.",
          "Find the person's card. In Main location, pick the office they should open on at sign-in — or All locations.",
          "It saves as soon as you pick it. Owners and Admins can set it for any member, including other Admins.",
        ],
        why: "Main location is only their starting view; they can still switch offices from Patient List. The setting only appears for offices with more than one location. The change is recorded in the Activity Log (\u201cchanged main location\u201d).",
      },
      {
        heading: "Change what Managers and Staff can reach",
        steps: [
          "Settings → Office tab → Roles & Permissions (or search \u201croles\u201d or \u201cpermissions\u201d).",
          "One grid: rows are things people do, columns are Staff, Manager and Admin.",
          "Pages: per role, No access / View only / Full.",
          "Actions inside a page: for example Contacts → add contacts, edit contacts (Managers can edit contacts by default; Staff can add but not edit).",
          "Deleting: per role and per kind — Not allowed / With password / Allowed.",
          "Dashboard sections a Manager sees.",
          "Each person follows their role. If someone has been given something different on their own card in Team Members, they show a \u201cCustom access\u201d tag and a Reset to role defaults button.",
        ],
        why: "Only the owner can change the grid, unless the owner switches on \u201cLet Admins change roles\u201d. Statistics is admin-only and can't be switched on for a manager — that's the business end of the office. Settings is admins only, always.",
      },
      {
        heading: "Who can change Roles & Permissions, and what \u201cNot saved\u201d means",
        steps: [
          "The office owner can always change the grid.",
          "Admins can change it only if the owner has switched on \u201cLet Admins change roles\u201d (off by default). Only the owner can flip that switch.",
          "Managers and Staff see the grid read-only, and Admins do too while the switch is off — the page says \u201cView only\u201d.",
          "Reset to defaults puts every role back to the standard grid; it leaves the delete password and the Admins switch alone.",
        ],
        why: "The grid is saved in the cloud and read back. If the database refuses a save (someone who isn't allowed tried), the page says \u201cNot saved\u201d instead of looking saved. Other people's open sessions pick up a change when they reload.",
        watchOut:
          "Defaults: Staff can add contacts but not edit them; Managers can add and edit contacts. The grid controls what the app shows and allows; it is not a database lock on patient data, so it stops mistakes rather than a determined technical user.",
      },
      {
        heading: "Set or change the delete password (one password, two places to set it)",
        steps: [
          "Settings → Office tab → Roles & Permissions → Delete password. Or Settings → Office tab → Office Settings → Patient-Delete Password. Both show the same single password.",
          "First time: type it in Choose password and Repeat it, then Save password. To change it, also type the Current delete password.",
          "Anything set to \u201cWith password\u201d now asks for it before deleting — including the Delete window on a patient's page.",
          "\u201cAsk Admins for it too\u201d (Roles & Permissions) makes admins type it as well.",
        ],
        why: "The password is stored in the cloud (as a salted hash, never the plain text), so it is the same on every computer and for every team member. \u201cSaved\u201d only appears after the cloud copy has been read back and matches.",
        watchOut:
          "If something is set to \u201cWith password\u201d and no password exists, that delete is blocked outright — and the patient Delete window tells you to set one under Settings → Office. Only Owners and Admins see the password box.",
      },
      {
        heading: "What these checks are and aren't",
        why: "Role checks run in the browser. They stop mistakes and casual snooping — not someone technical who really wants in. Two rules are enforced in the database: managers can't read admin activity in the log, and only the owner (or Admins, if the owner allowed it) can change the role grid itself. If you need true separation, say so and it can be pushed down to the database.",
      },
    ],
  },
  {
    id: "settings-map",
    title: "Where things live in Settings",
    summary: "A map, because several things are not where people look first.",
    audience: "admin",
    tasks: [
      {
        heading: "Use the search box",
        steps: [
          "Settings → the 🔎 box at the top.",
          "Type what you want — \u201clogo\u201d, \u201clien\u201d, \u201cbilling macros\u201d, \u201cbackup\u201d.",
          "Matching sections open themselves and everything else hides.",
        ],
        why: "Every section starts collapsed, so searching beats scrolling.",
      },
      {
        heading: "The map",
        steps: [
          "Office Settings (Office tab) — office details and logo, the Case number format, the Patient-Delete Password, office hours, rooms, appointment statuses, case statuses and Lien/LOP wording, the Compliance column and Compliance Categories, Case Flow rules, which patient-page sections start open.",
          "Macros — SOAP macros, billing macros (treatments, diagnosis codes, bundles), package builder.",
          "Templates — Contact Categories, document/letter templates, report templates, SMS and email wording, and Forms (patient questionnaires).",
          "Features — switch off anything the office doesn't use; it disappears from the menu everywhere.",
          "Team Members (Office tab) — logins, roles, doctor flag, Main location, per-person patient-page sections.",
          "Roles & Permissions (Office tab, right after Team Members) — what Staff, Managers and Admins can open, add, edit and delete, which Dashboard sections Managers see, the delete password.",
          "Marketing — the visit types and which case statuses count as active.",
          "Admin — Diagnostics, Backup & Restore, Data Recovery, Security Baseline, Subscription.",
        ],
        watchOut:
          "Two that catch everyone: Contact Categories is under Templates (not Contacts), and the section for switching features off is called Features on screen. \u201cRoles & Permissions\u201d and the \u201cAdmin\u201d group are different things.",
      },
      {
        heading: "Compliance Categories — rename, recolor, add",
        steps: [
          "Settings → Office tab → Case Status Categories → Compliance Categories (below the Case Status list). The Compliance column switch is just above, in the same section.",
          "Add: type the name in New Compliance Option, pick a Color, press Add Option.",
          "Rename: click the name, type, press Enter (Esc backs out). Color: use the color box on its row.",
          "Show: untick it to stop offering that option in the pill menu and the filter. Remove: asks first, and says how many patients have it.",
          "Reset Compliance Defaults puts back New Patient, Yes, No, DNS ATM and Non-Compliant and removes the ones you added.",
        ],
        why: "Each option keeps a hidden id, so renaming never orphans what is already saved on patients. A hidden option still displays on patients that already have it. Removing an option makes those patients show Not set — which is why it asks first.",
        watchOut: "These are the choices on the Compliance pill. They have nothing to do with Case Status Categories above them, which are a separate list.",
      },
      {
        heading: "Save to Cloud",
        steps: [
          "Most settings save as you change them.",
          "Save to Cloud at the top sends any change that hasn't reached the cloud yet. The button shows Saving… and then a green Saved ✓.",
          "If another computer changed the same setting more recently, the newer one is kept and the button tells you so. It never overwrites newer cloud data.",
        ],
        watchOut: "If the button turns red and says Retry, your change is only on that computer. Press it again before walking away.",
      },
    ],
  },
];

export const handbookChaptersClinical: HandbookChapter[] = [
  {
    id: "patient-page",
    title: "The patient page",
    summary: "One case file: demographics, referrals, appointments, plan, billing tail.",
    audience: "all",
    feature: "patients",
    tasks: [
      {
        heading: "What the panels are",
        steps: [
          "Top card: names, DOB, phone, attorney, DOI, and the Lien / Prior Care / Case Status / Review row.",
          "Quick Glance: a read-only summary — DOI, initial exam, billed, imaging dates, and appointment counts.",
          "X-Ray / MRI / Specialist: referrals out and the dates back.",
          "Appointments / Encounters: their visits, and where notes get started.",
          "Treatment Plan, Diagnosis Codes, Letters, Reports, Patient Files, Additional Details.",
        ],
        why: "Which panels start open, and which are hidden from a given person, is set by an admin in Settings — so two people can see the same patient differently.",
      },
      {
        heading: "Book an appointment for this patient",
        steps: [
          "Open Appointments / Encounters.",
          "Click the blue Appt. button.",
          "The New Appointment box opens with this patient already filled in.",
        ],
        watchOut:
          "Book treatment plans from HERE, not from the Schedule page. This is the version with multi-week series, different times per day, the live visit count, and the offer to skip closed days. The Schedule page version is the plain one.",
      },
      {
        heading: "Start a note for a visit",
        steps: [
          "Find the visit in the Scheduled Appointments table.",
          "Set its Status to Checked In.",
          "+ Encounter appears in the Encounter column — click it. Afterwards the button reads Open Encounter.",
        ],
        watchOut:
          "+ Encounter only appears once the patient is Checked In. Other statuses show a dash — that is the single most common 'the button is missing' call.",
      },
      {
        heading: "Add a note to a patient (the Notes panel)",
        steps: [
          "Open the patient's page → Notes.",
          "Type the note and press Enter (Shift+Enter starts a new line), or press Add note.",
          "Each note is saved as its own line, stamped with today's date and your name. Newest first.",
          "Notes added through G.O.A.T. (/note or \u201cadd a note for…\u201d) land in this same list.",
        ],
        why: "Notes are saved to the cloud, so every computer sees the same list, and two people adding notes at the same time never overwrite each other. If the connection is down you will see \u201cSaved on this device\u201d and it syncs as soon as it is back.",
        watchOut: "This panel is the patient's running Notes. SOAP notes for a visit are written in Encounters, not here.",
      },
      {
        heading: "Edit a note, change its date, and Earlier notes",
        steps: [
          "Patient's page → Notes → Edit on that note's line (Delete asks Delete note? first). The person who wrote it, the Owner and Admins can edit or delete it.",
          "To change a note's date: Edit → Date, then Save. Only the Owner and Admins see the Date box.",
          "Notes typed before this change appear below the list as Earlier notes — one text box, still editable and never deleted.",
        ],
        why: "The date on a note is the day it was written unless an Owner or Admin changes it, so staff can't back-date their own entries. An edited note shows \u201cedited by\u201d with the person's name.",
      },
      {
        heading: "% Paid, % Disc. and the Ask calculator",
        steps: [
          "Open the patient's page → Additional Details. The summary shows % Paid (paid ÷ billed) and, beside it, % Disc. (how much of the bill was reduced).",
          "Both fill in once there is a billed amount and a $ Paid Amount.",
          "Next to them is the Ask calculator, for working out what to ask a firm for. Choose % or $, then type a number. In % mode it shows the dollar amount to Ask for; in $ mode it shows what % of billed that is. Discount shows the matching % and dollars off.",
        ],
        why: "The Ask calculator is a scratch pad — nothing you type in it is saved or changes the bill. % Disc. is read from what was actually paid.",
        watchOut: "With no billed amount, the calculator shows a dash. Enter the billed amount first.",
      },
      {
        heading: "Set a patient's Compliance",
        steps: [
          "Open the patient's page. In the top card, next to Case Status, pick a value in Compliance.",
          "Once a value is set it also shows as a Compliance pill in the header.",
        ],
        why: "Only there while the office has switched on the Compliance column (Settings → Office → Case Status Categories). It is the same value as the pill in Patient List.",
      },
      {
        heading: "Add an imaging or specialist referral",
        steps: [
          "Open the X-Ray, MRI or Specialist panel.",
          "Fill the Sent Date and the imaging centre (or pick the specialist).",
          "For imaging, click Select / Update under Regions and pick the body regions.",
          "Press Add X-Ray Sent / Add MRI / CT Sent / Add Specialist.",
          "Later, fill the Completed, Received and Reviewed dates on the saved entry.",
        ],
        why: "Those dates are what clear the Case Flow rows. Each panel also has Patient Refused / Completed Prior Care / No X-Ray boxes — use them to close something honestly instead of leaving it nagging forever.",
      },
      {
        heading: "What the row colours mean",
        steps: [
          "Faint red — Canceled.",
          "Faint purple — No Show.",
          "Green — Checked Out, the visit is finished.",
          "Blue — Checked In, the patient is here and the note is open.",
          "No colour — Scheduled.",
        ],
      },
      {
        heading: "Two bars that turn red on purpose",
        why: "Diagnosis Codes goes red and says None added when a patient has no codes — claims and narratives break without them. Additional Details goes red for Needs billing and amber for Awaiting payment. They are prompts, not faults.",
      },
      {
        heading: "The appointments panel is locked",
        steps: [
          "A closed case locks booking — the header shows Locked (case closed).",
          "Press Unlock to book anyway; press Lock to put it back.",
        ],
      },
    ],
  },
  {
    id: "scheduling",
    title: "Scheduling",
    summary: "Booking visits, a whole plan of care at once, and what the warnings mean.",
    audience: "all",
    feature: "appointments",
    tasks: [
      {
        heading: "Book a single visit",
        steps: [
          "Schedule → New Appointment (or the Appt. button on a patient page).",
          "Pick the patient, the appointment type (this fills the duration), the date and the start time.",
          "Save Appointment. It is created as Scheduled.",
        ],
      },
      {
        heading: "Book a plan of care that changes rhythm",
        steps: [
          "Open the patient page → Appointments / Encounters → Appt.",
          "Switch to Recurring Series.",
          "Tap the weekday circles, set the time, then Ends By — an end date or a number of visits.",
          "Press + Add series for the next stretch. It starts the day after the last one ends.",
          "Change the days for that stretch (e.g. drop Thursday), set its end, and repeat. A stretch can also book a different Appointment Type (e.g. Lumbar instead of Cervical decompression) — it follows Series 1's type until you pick another.",
          "Check the total — 'N visits in total · last on …' — then Save Appointment.",
        ],
        why: "Each stretch books as its own series, so cancelling one later leaves the others alone. If two stretches both want the same day, it books once.",
        watchOut:
          "Only office-open days can be picked. If two visits a week need different times, tick Different time per day inside that stretch.",
      },
      {
        heading: "Check a patient in and out",
        steps: [
          "Schedule → click the appointment card.",
          "Check In (you can assign a room), or Check In + Encounter to start the note at the same time.",
          "When the note is finished, Check Out — or let Close + Check Out in the encounter do it.",
        ],
      },
      {
        heading: "Canceled vs No Show",
        steps: [
          "Canceled — they told us. Faint red.",
          "No Show — they did not come and did not call. Purple.",
        ],
        why: "They are counted separately everywhere — the weekly summary, the patient page chips, Quick Glance. Neither counts as a booked visit, so cancelling the only visit before the Initial Exam turns 'Initial Exam Pending' back into 'Schedule Initial Visit' on Case Flow.",
      },
      {
        heading: "The warnings when you save",
        steps: [
          "Time slot full — that slot is at capacity.",
          "Closed key date — offers to skip those dates and book the rest. OK skips, Cancel abandons everything.",
          "Already has an appointment that day — same offer.",
          "Outside office hours — the time is outside the day's hours.",
        ],
        watchOut:
          "Override office hours for this booking is a master switch: it also lets you past a full time slot. Treat it as 'let me through all the schedule limits', not just hours.",
      },
      {
        heading: "Days the office is closed",
        steps: [
          "Key Dates → fill the date, pick Closed, Covered, or Open (a day the office works even though it would normally be off, e.g. a holiday), give a reason, Add Key Date.",
          "Closed = the office is shut: no scheduling and NO text reminders for that day (one date or a range). Covered = someone covers, visits stay bookable and reminders STILL go out. Open = a normal working day. The Reason is only a label (\"Texas\", \"Vacation\"), it never changes what the status does.",
          "A Closed day stops APPOINTMENT reminders only. Message patients texts (for example \"we are closed Thursday\") are never blocked by a Key Date, so you can still tell patients you are closed.",
          "Add Open from / until times for a partial day: visits outside those hours are flagged and get no reminders.",
          "In Configured Key Dates, the Appointments column shows how many visits are really booked on that day or range. A red notice at the top lists Closed days that still have patients booked.",
          "The list underneath shows appointments already booked on those days.",
          "Use Cancel Appointment there, or Clear to dismiss a row you have dealt with. Clear only hides the row; the visit stays booked and still counts in the Appointments column.",
        ],
        why: "Reminders go out the day before, so set the day to Closed before then. A text that has already been sent can't be recalled; changing the day afterwards only stops texts not yet sent. If you meant to tell patients you are closed, use Settings → Text Reminders → Message patients → All active patients.",
        watchOut:
          "Delete and Cancel need two clicks — the button turns into Confirm Delete / Confirm Cancel. Nothing happens on the first click; that is deliberate, because some browsers swallow pop-up confirmations.",
      },
    ],
  },
  {
    id: "encounters",
    title: "Encounters and SOAP notes",
    summary: "Writing the note, running macros, and closing the visit out.",
    audience: "all",
    feature: "encounters",
    tasks: [
      {
        heading: "Open a note",
        steps: [
          "Encounters → type the patient name and press Enter or click them in the list. Nothing loads until you pick.",
          "Find the visit in the table and click + Enc. (or Open / View).",
          "Or start it from the patient page, or from the Schedule card with Check In + Encounter.",
        ],
        watchOut: "Check the patient in first. A note started on a visit that is still Scheduled cannot check anyone out later.",
      },
      {
        heading: "Write the note",
        steps: [
          "The Subjective / Objective / Assessment / Plan tabs sit BELOW the macro buttons, above the note box.",
          "Type straight into the box, use macros, or mix both.",
          "In Plan, one-paragraph macros run together: tap Begin Decompression, then a second-region macro, and the second text follows on the same paragraph after one space.",
          "Copy From pulls a previous visit's section across when today is much the same.",
        ],
      },
      {
        heading: "Read the last visit while you write",
        steps: [
          "Pick a previous visit in Copy From.",
          "The whole of that note appears underneath in four columns — Subjective, Objective, Assessment, Plan — with the one you're typing outlined.",
          "Drag the grey divider between the two to give whichever half you need the room.",
        ],
        why: "Where you leave the divider is remembered on that computer, so it opens the way you left it. Each half scrolls on its own rather than pushing the page down.",
      },
      {
        heading: "Run a macro",
        steps: [
          "Pick the section tab first — the macro buttons follow it.",
          "Row one is the question macros; row two is the body regions.",
          "Click the macro. Answer the questions, then Insert Into SOAP.",
        ],
        why: "Answers go into the note as pills you can click to change later. Some answers also add the charges for that treatment automatically.",
        watchOut:
          "The Other / edit box replaces the answer you picked rather than adding to it. And a macro named after a body part always lands on row two — that is by name, not a setting.",
      },
      {
        heading: "Fix an answer you got wrong",
        steps: [
          "Click the answer pill inside the note — it reopens just that question.",
          "Or open Inserted Macro Inputs and click the macro to redo all of its answers.",
          "The × on a macro chip removes that macro's text and any charges it added.",
        ],
        watchOut:
          "If a decompression prompt asks '…for the rest of this plan?', saying Yes changes the treatment plan for visits not charted yet, and also updates the Plan of later OPEN notes that still read exactly what the plan filled in (the prompt names them, e.g. 'Also updates 2 open notes (10/15, 10/22).'). A note you edited by hand is named too and left alone, and closed notes and checked-out visits are never changed. Say No for a one-day change.",
      },
      {
        heading: "Finish the visit",
        steps: [
          "Press Close + Check Out.",
          "It signs the note, checks the patient out, and locks the note read-only.",
          "If there are no charges it asks first — that is worth reading rather than clicking past.",
        ],
        why: "Close IS the signature; there is no separate sign step. Reopen unlocks the note and puts the patient back to Checked In.",
        watchOut:
          "If it says 'no linked appointment found to check out', the note's Type does not match the appointment's Type for that day. Make them match.",
      },
    ],
  },
  {
    id: "fill-treatment-plan",
    title: "Fill Treatment Plan",
    summary: "Writing a stretch of routine visits from one finished note.",
    audience: "all",
    feature: "encounters",
    tasks: [
      {
        heading: "What it does",
        steps: [
          "Write one good note for a routine visit.",
          "Press Fill Treatment Plan in the encounter header.",
          "It asks once, listing the exact visits it will fill (e.g. 'Fill 5 visits from the treatment plan? 10/02, 10/06, 10/09, 10/13, 10/16') — press Fill, or Cancel to change nothing.",
          "Every Checked In visit after this note, dated today or later, inside the plan that has no note yet is written, closed and checked out.",
          "If a PAST visit was checked in but never got a note (rare — usually a mistake), the same prompt lists it on its own line ('Past, checked in with no note: …'). Fill does those too; Cancel changes nothing.",
        ],
        why: "Subjective, Objective and Assessment are copied from the note you are on. The Plan and the charges come from the treatment plan for each visit's weekday — never copied — so each day bills what it should.",
      },
      {
        heading: "What it skips, and why nothing happened",
        steps: [
          "Canceled and No Show visits.",
          "Visits already Checked Out, and closed notes — that day is done, it is never changed.",
          "Past visits that already have a note (open or closed).",
          "Visits still marked Scheduled — it only fills Checked In ones.",
          "Exam and re-exam visits, deliberately.",
          "Weekdays with nothing set up in the treatment plan.",
        ],
        watchOut:
          "Check the patients in first. 'It did nothing' is almost always a row still sitting at Scheduled. The summary afterwards names what it skipped and why — read it.",
      },
      {
        heading: "After a re-exam, bring the rest of the plan up to date",
        steps: [
          "Write the re-exam note with the new findings.",
          "Press Fill Treatment Plan on it.",
          "It asks whether to replace the Subjective, Objective and Assessment on upcoming visits that already have an OPEN note. Say yes.",
        ],
        why: "A long plan is usually filled once from the first visit. When the findings change at a re-exam, those later visits already have notes, so they'd otherwise keep reading like the old ones. Their Plan and charges are left alone — only S, O and A are replaced.",
        watchOut:
          "Closed notes, checked-out visits and past days are never replaced. Anything typed by hand into S, O or A on an open upcoming note is replaced — fix that one afterwards.",
      },
      {
        heading: "Before you press it",
        steps: [
          "It asks once with a short summary, then runs — there is no row-by-row preview.",
          "It only fills forward, never the note you are on or anything before it.",
          "It bills real charges across several dates at once, so check the plan's weekday setup first.",
          "To change one of the filled notes, open it and press Reopen.",
        ],
        watchOut:
          "If some notes are left open with 'no plan charges', that weekday's treatments are not linked to any charge in the billing library — an admin fixes that in Settings.",
      },
    ],
  },
  {
    id: "treatment-plan",
    title: "Treatment plans",
    summary: "Setting out what each weekday's visit contains, including decompression.",
    audience: "all",
    feature: "patients",
    tasks: [
      {
        heading: "Create a plan",
        steps: [
          "Patient page → Treatment Plan → + Treatment Plan.",
          "Set the start and end dates — the '…or pick a visit date' dropdown lists their real visits.",
          "Create Plan.",
        ],
      },
      {
        heading: "Set up a weekday",
        steps: [
          "Click the weekday button (only office-open days appear; a green dot marks days already set).",
          "Tick the regions treated that day.",
          "Click the treatment chips under each region.",
          "Use 'Copy <Day> to…' to reuse the same setup on another day.",
        ],
        watchOut:
          "A greyed-out weekday has no appointments booked inside the plan's dates. Configuring a day with no visits does nothing — book the visits first, or move the treatments to a day that has them.",
      },
      {
        heading: "Both sides, same treatment",
        steps: [
          "Tick the region and its treatments as normal.",
          "Leave the LEFT/RIGHT question unpicked.",
        ],
        why: "Unpicked means both. The note writes the region in the plural — Knee becomes Knees, Ankle/Foot becomes Ankles/Feet — so it reads as one bilateral line instead of the same sentence twice.",
        watchOut:
          "Only the region word changes. A macro that says 'the knee was treated' becomes 'the knees was treated', so write those templates in the singular or around the verb.",
      },
      {
        heading: "Different treatments for the left and the right",
        steps: [
          "Tick the region, then press the 'Left / right separately' pill under it.",
          "The chips split into Left and Right. Whatever you had ticked is copied to both sides, so nothing is lost.",
          "Tick what each side gets — e.g. EMS and LLLT on both, shockwave on the right only.",
          "'One list for the region' puts it back to a single list.",
        ],
        why: "Tick the SAME treatments on both sides and the note writes one bilateral line. Tick them differently and it writes a line per side — 'left knee: EMS, LLLT' and 'right knee: EMS, LLLT, shockwave'. Nothing to switch on: the shape of the day decides the shape of the note. Billing is unaffected — a treatment is charged once per visit however many regions or sides it covers.",
        watchOut:
          "While a region is in per-side mode its own Left/Right question disappears — the side comes from which row you ticked, so the two can never disagree.",
      },
      {
        heading: "Decompression",
        steps: [
          "Open the decompression card at the bottom of the plan.",
          "Pick the segments and the program.",
          "Set Start weight, Increase, Max and Cycles — the preview shows the progression.",
        ],
        why: "Decompression is set once for the whole plan, not per weekday. The weight steps up per visit and pre-fills the macro at charting time, still editable that day.",
      },
      {
        heading: "Use the plan in a note",
        steps: [
          "Open the encounter. If its Plan section is empty and a plan covers that date, the Plan and its charges fill in from that weekday's plan automatically.",
          "To fill many visits at once, use Fill Treatment Plan.",
        ],
        watchOut: "A Plan that already has text is never replaced automatically. Edit it in the note, or change the plan and say Yes to '…for the rest of this plan?' to update open notes you haven't edited.",
      },
    ],
  },
  {
    id: "charges",
    title: "Charges and diagnosis codes",
    summary: "How a visit gets billed, and why the Diagnosis bar goes red.",
    audience: "all",
    feature: "encounters",
    tasks: [
      {
        heading: "How charges land on a note",
        steps: [
          "Usually automatically: picking certain macro answers adds the matching charge, and un-picking removes it.",
          "From the treatment plan, when a note opens with an empty Plan or you use Fill Treatment Plan.",
          "By hand: Encounter Charges → Open Charges → search by name or CPT → click the treatment.",
          "From the last visit: Copy Charges From Prior.",
        ],
        watchOut:
          "Deleting a charge that came from a macro also un-picks that answer in the note — otherwise it would come straight back. Editing price or units changes this visit only, never the library.",
      },
      {
        heading: "Add diagnosis codes",
        steps: [
          "Patient page → Diagnosis Codes.",
          "+ Dx Code for one, Add Diagnosis Macro to search the library, or Add Diagnosis Bundle for a preset group.",
          "G.O.A.T. suggests codes from the MRI and, in a second box, from the X-ray (the Imaging panel X-ray text and uploaded X-ray reports). Each shows the X-ray line it came from and a Why? link. Click Add to add one; it then drops off the list. Click Ignore to hide a suggestion for this patient (saved to the cloud, so it stays hidden on every computer); Show ignored brings it back.",
          "X-ray suggestions cover loss of lordosis, disc degeneration / disc-space narrowing, spondylosis, scoliosis, spondylolisthesis, and shoulder/knee arthritis or effusion. Shoulder and knee codes need the side in the report. A fracture is never coded for you; it's listed under Not suggested so you can code it by hand.",
        ],
        why: "The bar is red and says None added until a patient has codes, because claims and narrative reports both fall apart without them. Codes are per patient, not per visit.",
      },
    ],
  },
  {
    id: "reports-letters",
    title: "Reports and letters",
    summary: "Narratives, work/school notes, and what fills itself in.",
    audience: "all",
    feature: "patients",
    tasks: [
      {
        heading: "Generate a narrative report",
        steps: [
          "Patient page → Reports → pick a Narrative Template → Generate Narrative.",
          "Answer the Narrative Inputs if the template asks for any, then Continue.",
          "The preview is editable — click into it and fix anything before printing.",
          "Optionally attach encounters and a billing statement.",
          "Print / Save PDF, then choose Save as PDF in the browser dialog.",
        ],
        why: "Most of the report fills itself from the chart — demographics, visits, diagnoses, imaging, specialists, charges. Narrative Inputs only ask for what the chart cannot know, like a prognosis.",
      },
      {
        heading: "The decompression paragraph",
        why: "The report can write the decompression summary for you: how many treatments, which segments, and the weight from first to last. It counts only CLOSED notes whose appointment type says decompression.",
        watchOut:
          "If it prints as a dash or misses the weights, it is nearly always one of three things: the visits are not closed, the appointment type does not say decompression, or the macro's prompts are not named Targeted Segment and Weight.",
      },
      {
        heading: "Letters (work, school, gym)",
        steps: [
          "Patient page → Letters → pick a template → Generate PDF.",
          "Fill any prompts, then use Save as PDF in the print dialog.",
        ],
        watchOut:
          "Generate PDF opens the print dialog — it does not save a file into the chart. If the letter belongs in the file, save it and upload it back under Patient Files.",
      },
    ],
  },
  {
    id: "patient-forms",
    title: "Patient forms (questionnaires)",
    summary: "Build your own questionnaires, text or email one to a patient, and drop their answers into Objective exactly as if you clicked the macros.",
    audience: "all",
    feature: "patients",
    tasks: [
      {
        heading: "Send a form",
        steps: [
          "Open the patient → Send form (next to + To Do).",
          "Pick one of your forms (only forms that are turned On show here). Tick Spinal decompression case if it applies — it's already ticked when the schedule has a decompression visit.",
          "Create secure link, then Copy link, Text it (opens Messages) or Email it (opens your mail app). Nothing is sent until you press send there.",
        ],
        why: "The link is long and random, works for one patient only, needs no login, and stops working after the days you chose (14 by default) or when you Revoke it from the same window. The patient's answers save to the cloud as they go, so they can stop and finish later from the same link.",
        watchOut: "The link opens that patient's answers to whoever has it. Send it only to the patient's own phone or email.",
      },
      {
        heading: "When it comes back",
        steps: [
          "The patient file shows a green \"Questionnaire received\" card with every answer; G.O.A.T.'s Morning Rundown lists it too.",
          "Pick the visit and click Insert into Objective — or open the patient's note: the same card waits above the SOAP macros.",
          "Each macro section fills its own Objective macro through the same path as clicking it, so the wording, the clickable answers and any linked charges are identical. Your own questions go in underneath as plain \"Question: answer\" lines.",
          "Dismiss if you don't want it in a note. The answers stay saved; Show past questionnaires → Review again brings it back.",
        ],
        why: "Insert only ever ADDS to Objective. If Objective already has text (or that macro was already run), it asks first and still changes nothing that's there. Who inserted or dismissed it, and when, is saved with the questionnaire and in the Activity Log.",
      },
      {
        heading: "Build a form (Settings → Templates → Forms)",
        steps: [
          "No form comes pre-made: every office starts with \"No forms yet\". Click + New form and give it a name.",
          "+ Objective macros → tick the macros (buttons) you want to ask about → Add. The patient picks from the same options you click in the note.",
          "+ Your own questions → type the question and pick its type: Short answer, Long answer, Yes / No, Pick one, Pick any, or Number. For Pick one / Pick any, put one choice per line.",
          "Rename any section heading, move sections and questions up or down, and switch a section or question off without deleting it. Choose when a section is asked: Always, Decompression only, or Not decompression.",
          "On a macro section, Questions → untick any the patient shouldn't see and, if you like, reword a question or option the way a patient would say it (Spanish optional).",
          "Connect answer to (under every question): None puts it in Objective as a plain \"Question: answer\" line. Objective or Subjective → pick one of your macros → the field it fills, and optionally \"Picks: <option>\" so a Yes (or any answer) ticks exactly that option and a No leaves it blank. Patient info → Phone, Email, Address, DOB, Sex or Marital Status. Questions in a macro section start connected to their own macro (\"This macro\"); change it or set it to None.",
          "The On / Off switch next to the name decides whether the form shows in Send form. Duplicate makes a copy to start a variation; Delete asks first.",
        ],
        why: "Forms save to the cloud for your whole office (every computer sees the same forms; edits on two computers merge, and every change is kept in version history). Options come straight from your macros, so a macro change shows up in the next form you send; forms already sent keep the questions they were sent with. Options that are blanks to fill (\"smoke ___ pack a ___\") or the word DELETE aren't shown to patients; they can type in the \"something else\" box instead.",
        watchOut: "Renaming an Objective macro? Check Settings → Forms: a section whose macro can't be found is marked ⚠ and left out of the form (the Send form window tells you which). A Pick one / Pick any question with no choices isn't asked. A connection whose macro or field was renamed or removed is marked ⚠; that answer goes in as a plain line instead. Patient info answers only fill a field that's blank, never change one you already have (Insert says which it skipped).",
      },
    ],
  },
  {
    id: "files",
    title: "Files",
    summary: "Getting documents into the right patient folder.",
    audience: "all",
    feature: "myFiles",
    tasks: [
      {
        heading: "Add a document to a patient",
        steps: [
          "Open the patient page → Patient Files.",
          "Upload, or drag files onto the panel. Scan uses your Mac's camera or your iPhone (see below).",
          "It files itself into that patient's folder — there is nothing to choose.",
        ],
        why: "The folder tree (year → case status → patient) is maintained by the app. Patients move between status folders on their own as the case changes, so use search rather than hunting for a folder.",
      },
      {
        heading: "Scan paperwork with a camera (or your iPhone)",
        steps: [
          "Open the patient page → Patient Files → Scan.",
          "Pick the camera. An iPhone near your Mac (same Apple ID) shows up as \"iPhone Camera\" and is picked for you; it gives the sharpest scans.",
          "Hold the page up and click Capture. Repeat for each page. Use ← → to reorder, Retake to redo a page, Delete to drop one.",
          "Type a name like \"MRI Report\" (or leave \"Scan MM-DD-YYYY\") and click Save as PDF.",
        ],
        why: "All pages become one PDF in the patient's folder in the cloud, named like every upload: case #, Last, First, then your name. The camera you pick is remembered for next time. Enhance turns the page into a clean black-and-white document; untick it to keep the original color photo.",
        watchOut: "If it says the browser isn't allowed to use the camera, click the camera icon in the address bar, choose Allow, and reopen Scan. No camera listed? Bring your iPhone near the Mac, or use Add a photo.",
      },
      {
        heading: "Email a document",
        steps: [
          "My Files → find the file → email it.",
          "The file downloads and an email opens with the wording from Settings.",
          "Attach the downloaded file yourself before sending.",
        ],
      },
      {
        heading: "Deleting",
        watchOut:
          "Deleting a file from the PATIENT PAGE is permanent and immediate. Deleting from the My Files page goes to Trash, where it can be restored. When in doubt, delete from My Files.",
      },
    ],
  },
];
