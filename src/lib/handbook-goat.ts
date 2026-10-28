/**
 * Handbook → G.O.A.T. "What can I do?". RULE: every new G.O.A.T. feature must
 * add or update a task here (scripts/sanity-check.mjs Rule 7 enforces that
 * G.O.A.T. code changes come with a change to this file, and the "/" command
 * list below is generated from SLASH_COMMANDS so it can't drift).
 */
import { CHIPS, SLASH_COMMANDS } from "@/lib/goat-briefs";
import type { HandbookChapter } from "@/lib/handbook-content";
import { handbookPhrases } from "@/lib/goat-understand";

export const GOAT_HANDBOOK_ANCHOR = "/handbook#chapter-goat";

export const goatHandbookChapter: HandbookChapter = {
  id: "goat",
  title: "G.O.A.T. — What can I do?",
  summary: "Your office assistant (the goat button, bottom right). Type the way you talk. It never changes anything without a confirm card.",
  audience: "all",
  tasks: [
    {
      heading: "How it works",
      steps: [
        "Click the goat button. You'll see a greeting and chips — tap one or just type.",
        "Ask like you'd ask a coworker: \"what's john smith's dob\", \"who's coming in today\", \"how many checks are we waiting on\".",
        "Anything that changes data shows ONE confirm card first. Nothing is saved until you tap Confirm.",
        "G.O.A.T. loads quietly in the background a moment after a page opens, so pages open faster and the G.O.A.T. button still opens instantly.",
        "If G.O.A.T. isn't sure (two John Smiths, an unclear category), it asks instead of guessing.",
      ],
      why: "G.O.A.T. is rules-based and runs inside NoteGoat — no outside AI, and your data stays in your workspace.",
    },
    {
      heading: "Just say what to do",
      steps: [
        "Type it the way you'd text a coworker, typos and all. G.O.A.T. goes straight to one confirm card with sensible defaults. For example, a visit with no time gets the first open slot that day. If the time you asked for is taken, you get the nearest open time, with the other times as buttons.",
        "It only asks when something it needs is missing, and then just one short question (\"Move it to when?\").",
        "It understands names spelled a bit wrong (\"jon smth\"), \"him/her\" for the patient you were just on, and days like \"tmrw\", \"next wed\", \"in 2 weeks\" or \"10/24\".",
        ...handbookPhrases(),
        "Open a case just navigates there. Nothing changes, so there's no card.",
      ],
      why: "The list above comes straight from G.O.A.T.'s own list of actions, so it's always current.",
    },
    {
      heading: "Teach G.O.A.T. (👎 or just type the fix)",
      steps: [
        "Under any reply, tap 👎 if G.O.A.T. got it wrong, then tap what you meant. It does that now and reads that wording the same way next time, for everyone in the office.",
        "Or just type the fix: \"no I wanted you to book it\", \"not a note, a to-do\", \"I meant reschedule\", \"no, move it to Friday\". G.O.A.T. closes the wrong card, shows the right one, and learns it the same way. (\"No\" or \"no, cancel\" on its own just dismisses the card.)",
        "Names, days, times and numbers are saved as blanks, never the actual name. Any word matching a patient, contact or attorney in your office is removed, whether it's capitalized or not.",
        "Settings → G.O.A.T. → G.O.A.T. Library has two parts. Learned in your office lists the wording your office taught it and the misses; Delete any you don't want. Built in is the read-only list that comes with NoteGoat. Office wording that matches a built-in one is merged away.",
        "Too much on open? Tap Hide brief. The heads-ups sit behind a small \"N heads-ups ›\" link.",
      ],
      why: "Saved to the office's cloud settings, so it works on every computer.",
    },
    {
      heading: `Good morning chips: ${CHIPS.join(", ")}`,
      steps: [
        "Morning Rundown (everyone) — today's schedule, ALL open to-dos (overdue first, then by due date, then ones with no date), unread team messages, and patient questionnaires that came back and still need review (\"1 questionnaire received: Jane Example\" with a Review link to her patient file). Click a to-do line to open it on the To-Do page (highlighted); click the patient name in it to open the patient. Cleared to-dos don't show.",
        "Appointment Check (admins) — active patients who need to be scheduled, in two groups with counts: No appointments booked (nothing today or later; longest since last visit first, with the date and days ago; never-seen patients flagged ⚠) and Running out this week (a visit this week, nothing after). Names open the patient.",
        "Quick Biz (admins) — active / ready to submit / submitted cases, new patients this month, visits this week/month and money collected, by office. Read-only. \"How's business?\" works too.",
      ],
      why: "Office numbers — Appointment Check, Quick Biz, case counts (\"how many submitted cases\") and money questions (\"who owes us\", \"what got paid this month\") — are for the owner and admins. Anyone else gets a polite \"that's for admins\". Right after sign-in, while G.O.A.T. is still checking your role, it shows only Morning Rundown and says \"still checking your access\" if you ask for numbers.",
    },
    {
      heading: "Actions from the G.O.A.T. box on a patient page",
      steps: [
        "The G.O.A.T. box on a patient's page answers questions about that patient (\"what's his balance\", \"when was the last MRI\").",
        "Type an action there instead — \"remind me to do his report and bill\", \"add a to-do …\", \"add note …\", \"schedule/book him Friday 3pm\", \"tell Leilani …\" — and the main G.O.A.T. chat opens with it. \"him / her / his / this patient\" means the patient whose page you're on.",
        "You get the usual single confirm card (e.g. To-Do \"Do report and bill\" for that patient, with a due date if you said one). Nothing changes until you tap Confirm.",
      ],
    },
    {
      heading: "Case pipeline and Case Review (admins)",
      steps: [
        "Ask in plain words: \"who needs an mri referral\", \"waiting on mri results\", \"waiting for report\", \"what's ready to submit\", \"waiting for checks\" (= Submitted), \"which cases have no attorney\". \"case pipeline\" gives all the counts.",
        "Each list shows the count and the patients (tap a name to open them), most urgent first: longest waiting on Case Flow, earliest discharge for Ready to submit, oldest R&B Sent (with days waiting) for Submitted.",
        "After each list, 1–2 chips offer the next step (e.g. Needs MRI → \"Waiting on MRI results?\"; Waiting for reports → \"Ready to submit?\").",
        "Case Review (greeting chip, \"do a case review\", \"what's missing\", /view case review): counts per Case Flow need — e.g. X-rays: 4, MRI/CT: 7, Specialist: 3. Tap a count to see those patients, longest open first.",
        "\"case review for <name>\" lists everything that case still needs on Case Flow.",
        "/view also takes: case review, pipeline, needs mri, mri results, reports, ready to submit, submitted, missing.",
      ],
      why: "These use the same rules as Patient List → Case Flow and your case statuses — nothing new to set up — and tasks you've cleared with Clear task stay out. Narrative reports aren't a tracked step, so \"waiting for report\" means the X-ray, MRI/CT and specialist reports Case Flow tracks. Case lists are for the owner and admins, like other case numbers.",
    },
    {
      heading: "Imaging findings (MRI, CT, X-ray)",
      steps: [
        "Ask \"mri findings\" or \"lumbar mri\". G.O.A.T. reads the impression and lists it by region (Cervical, Thoracic, Lumbar), one line per level in spine order: size, side, what it is, and what it presses on — e.g. \"C5-6: 3 mm left paracentral disc herniation — cord compression, neuroforaminal narrowing (L>R)\".",
        "Things with no level (degeneration, desiccation, Modic changes) go on a General line. Boilerplate like \"correlation is recommended\" is left out.",
        "Shared levels are split (\"C5-6 & C6-7 herniations\" shows on both). A size cut off in the PDF says so instead of guessing.",
        "Combined reports (e.g. Cervical + Lumbar MRI) show every region under its own heading, even when the report splits the impression with \"LUMBAR SPINE:\" sub-headings. Nothing is cut off.",
        "More than one study: the latest is first. Ask for one region to see just that one.",
        "Show original opens the report text exactly as written.",
      ],
      why: "Rules only — no outside AI. If a report isn't written level by level (e.g. a knee MRI), you get the report text as before.",
    },
    {
      heading: "Specialist findings (pain management, ortho, neuro)",
      steps: [
        "Ask \"pm findings\" or \"ortho findings\". G.O.A.T. leads with the patient's own referred doctor, e.g. \"Pain management: Dr. Name, seen, report uploaded 10/26/2026.\" If none is linked: \"No pain management doctor on this case.\"",
        "Then short bullets from the report: Recommendations / Plan first, then Range of motion (ROM measurements like \"Lumbar flexion 40/60 degrees\", even when they sit under Physical Exam), then Assessment / Diagnoses and Findings, with the page and Open file. Letterhead, addresses, signatures and page footers are left out.",
        "If a report from the specialist is dated after the referral but the referral isn't marked completed, G.O.A.T. says so. It never changes the referral itself — mark it completed in the Specialist box.",
      ],
      why: "Rules only, in your browser — no outside AI. Contacts not linked to this patient are never listed.",
    },
    {
      heading: "Look things up",
      steps: [
        "Patients: \"kara's attorney\", \"when was maria's last visit\", \"does alex have an mri\".",
        "Office: \"whats on the schedule tomorrow\", \"show our to-dos\", \"mock imaging fax number\".",
        "Money and cases (admins): \"how many submitted cases\", \"who owes us\", \"what got paid this month\".",
      ],
    },
    {
      heading: "Notes, to-dos and payments",
      steps: [
        "Notes: \"add a note for john smith: spoke to atty\" — saved as a new entry in the patient's Notes log, stamped with today's date and your name.",
        "To-dos: \"/todo call Mock Law for John Smith friday\", or just say it: \"add to-do call vartan 555-555-8855 to schedule new appt\" or \"remind me to call armen barmen 555-555-5588\". The text is kept as typed (phone included). If a name matches a patient, G.O.A.T. still shows the to-do card and offers \"Attach to …\" — tap or ignore. A contact, law firm or patient named inside a reminder never turns it into a lookup or a question: \"remind me to call Mock Law new case 555-555-0100\" is always a to-do.",
        "Open on a patient's page? \"him\", \"her\", \"them\", \"this patient\" — or no name at all — mean that patient. \"remind me to call for appointment\" on John Smith's page → \"Call John Smith for appointment\", attached to his case, one confirm. Name someone else (\"remind me to call Jane Doe\") and it's theirs; if the name could be several people, it asks. The same goes for notes (\"add a note that he called\"), team messages (\"tell Hannah to call her about the MRI\"), booking (\"book him friday at 3\") and lookups (\"when is his next appt\").",
        "Payments and cases: \"mark smith paid 3200\", \"reduce lopez to 2500\", \"set lee to submitted\". Say \"undo\" right after to put it back.",
      ],
    },
    {
      heading: "Compliance and notes — ask or tell G.O.A.T.",
      steps: [
        "Count: \"how many patients are non-compliant\", \"who is non-compliant\", \"how many patients have DNS ATM\", \"how many patients have no compliance set\". It lists the patients and links to Patient List.",
        "Change one: \"set compliance for Mock Smith to Yes\" or \"mark Mock Smith non-compliant\". You get ONE confirm card showing the old and new value. Nothing changes until you tap Confirm. If two patients match, it asks which one; it never picks silently.",
        "Read notes: \"what notes does Mock Smith have\" or \"show Mock Smith's notes\" lists the newest notes in the patient's Notes panel (date, who wrote it) and any Earlier notes, with a link to open the patient.",
        "Compliance is optional. If your office has not switched it on, G.O.A.T. says so and links to the setting instead of guessing. Staff without edit access to patients can ask and count, but not change.",
        "How-to questions about screens and settings are answered from this Handbook, with a link to the exact section.",
      ],
      why: "These use your own office's settings and data only, inside NoteGoat — no outside AI. Changes always go through a confirm card, the same save path as clicking it yourself, and show up in the Activity Log.",
    },
    {
      heading: "Broadcast texts: who does it go to?",
      steps: [
        "Ask: \"who does broadcast send to\", \"how do I text all active patients\", \"how do I tell everyone we're closed Thursday\". G.O.A.T. explains the Send to choices and links to Message patients. It never sends a text itself.",
        "All active patients (the default): every patient whose case status is Active, once per phone number. Booked on a day: only patients with a visit that day (optional time window, skips canceled visits).",
        "Always left out: no valid phone, \"no text reminders\" or STOP replies. Discharged, Ready to Submit, Submitted, Dropped and Paid patients are not Active.",
      ],
      why: "Answered from the Handbook (Message patients chapter) inside NoteGoat, no outside AI. Nothing is changed.",
    },
    {
      heading: "\"/\" commands (optional shortcuts)",
      steps: [
        "You never need these — plain words work for everything. They're shortcuts for people who like typing them, and they aren't shown in the greeting.",
        "Type / as the FIRST character in the G.O.A.T. box to open the menu (Tab picks the first one). A / later in a sentence, like 10/20, is just text.",
        "One line is enough: \"/note gisselle call atty\" or \"/todo aram subpoena records friday\". G.O.A.T. finds the patient from the first words (first, last or full name; small typos OK) and shows that patient as a button to confirm. It never picks silently, even when only one patient matches. Tap the patient, and the note goes to the confirm card with the patient's name on it. If no patient matches, it shows the patient search, filled in with what you typed.",
        "It only asks \"Which case?\" when more than one patient matches, and only asks for the text when you typed just a name.",
        "Just /note shows a patient search (type a name, case # or phone and tap the patient), then asks \"What's the note?\". Just /todo works the same way, and the search also has \"No patient / general to-do\". Then it asks \"What's the task?\". A /todo that names no patient is a plain to-do. The to-do keeps your full wording (\"call\" is never mistaken for a name). If the text names a patient (\"/todo call tyler smith\") G.O.A.T. shows that patient as a button to confirm, and the name stays in the task text; if two patients match it asks which one; if no one is named the card says \"No patient\" with Attach chips instead of guessing from the page you are on.",
        "Changed your mind halfway? Tap a chip, type another / or @ command, ask something new, or type cancel — the half-finished step is dropped.",
        "/view shows a list: /view todo (every open to-do; click a line to open it, click the name to open the patient), /view schedule (today), /view messages (unread). Admins also get /view appointment check and /view quick biz. After typing \"/view \" the menu suggests them.",
        "/contact asks \"Add or edit?\". Add: type one contact or paste a list. Edit: pick the contact, change fields, Confirm.",
        ...SLASH_COMMANDS.map((c) => `/${c.cmd} — ${c.hint}. Example: ${c.example}`),
      ],
    },
    {
      heading: "Schedule visits and new patients (no / needed)",
      steps: [
        "Existing patient: \"schedule john smith for friday at 3\", \"book maria next tuesday\" (or /schedule …). G.O.A.T. finds the patient (asks which one if several match), checks the slot and office hours, and shows a confirm card with any conflict, nearby open times and an override. Nothing books until you tap Confirm.",
        "Missing the day or time? G.O.A.T. asks, and also offers \"Or open New Appointment\" prefilled with what it has.",
        "New patient: \"schedule new patient John Smith for next Wednesday at 10\" or \"schedule armen barmen for new appt next Thursday at 3pm\". G.O.A.T. gives an \"Open New Appointment (new patient)\" button: the Schedule's New Appointment opens in New-patient mode with the name, phone, day, time and the New Patient visit type filled in (one provider and one location are picked for you). You fill the rest; Save Appointment adds the patient and books the New Patient visit (and sets their Initial Exam date).",
        "Phone missing? If an open to-do mentions that person with a phone (\"Call Armen Barmen 555-555-5588\"), G.O.A.T. uses that phone — and after you save, the Schedule offers to mark that to-do done (Mark done / Keep it).",
        "Name matches an existing patient and you said \"new appt\"? G.O.A.T. asks: \"Existing patient Armen Barmen, or a new patient?\".",
        "A call or text about a new patient (\"I have a new patient for you …\" or /new …): G.O.A.T. opens Patient List → New Patient prefilled (patient info only). If it also has a visit day/time, it opens New Appointment in New-patient mode instead, so the visit is booked there. It asks only about what's unclear (e.g. which part is the last name).",
        "Days and times: tomorrow, next Wednesday, friday, 10/22; \"3\" or \"10\" are read inside office hours (3 PM, 10 AM).",
      ],
      watchOut: "G.O.A.T. never creates a patient or books on its own — you always save the form or tap Confirm.",
    },
    {
      heading: "Message the team (@mentions)",
      steps: [
        "Just say it: \"message Hannah about John Smith\", \"tell hannah john smith's MRI is in\", \"text hannah can you call Mock Law\", \"let the team know the fax is down\". This is NoteGoat Messages (team chat), never an SMS to a phone.",
        "Who: G.O.A.T. finds the team member. Two Hannahs? It asks which one. No match? It shows the team to pick from (or the whole team).",
        "What: no message yet (\"message Hannah about John Smith\")? It asks \"What should I tell Hannah?\".",
        "Which case: when a patient is named, G.O.A.T. always asks before linking — \"About Smith, John (Active)?\" (Yes / Different patient / No patient), or a list when several match. The sent message links to that case (tap it to open the patient).",
        "\"Message the team …\" / \"let everyone know …\" posts to General with no @mention.",
        "Type @ and pick a teammate: \"@hannah please call kara back\".",
        "Tap 🔒 on the card for Eyes only — just you and them see it. Otherwise it posts to General.",
      ],
    },
    {
      heading: "Duplicate encounters (patient page)",
      steps: [
        "When a patient has two encounters on the same date, G.O.A.T. shows a yellow banner → Review.",
        "They're shown side by side; the green \"Real data\" one is the fullest.",
        "Choose Combine (keep the fuller one, add anything only the other has) or Keep the fuller one only → Confirm merge.",
        "A backup is saved first. Restore on the same banner puts both back.",
      ],
      watchOut: "G.O.A.T. never merges on its own — only when you tap Confirm merge.",
    },
    {
      heading: "Add many contacts at once (paste)",
      steps: [
        "Paste a list into G.O.A.T. (\"add these as contacts\" is optional). One contact per block: name, phone, address — emails and fax are picked up too.",
        "G.O.A.T. suggests a category from the names (Law, Esq, APC, LLP, Firm, Legal → Attorney, even if a name also says Injury, Accident or Care). If it isn't sure, it asks you to pick before anything is added.",
        "Review the table: edit any cell, untick rows you don't want. Likely duplicates of existing contacts start unticked.",
        "Confirm adds the ticked ones and tells you how many were added and skipped. \"Undo this import\" on the same card removes exactly those.",
        "Wrong category? Just say so: \"you put them under Acute Care\", \"they should be attorneys\" or \"change them to Imaging\". G.O.A.T. guesses the right one from the names (\"Oops, my bad — those 22 should be Attorneys, right?\") or asks if it can't tell, then shows one card to move exactly the contacts from that import (with Undo).",
        "When you open G.O.A.T. it greets you with a quick brief (today's visits, new patients, overdue and due-today to-dos; admins also see cases waiting on checks) and up to 3 heads-ups: overdue to-dos, active cases with no Initial Exam, PI cases with no attorney, and active patients with nothing booked. Click one to go there, or × to hide it for this chat.",
        "Type like you text: typos and shorthand are fine (\"tmrw\", \"pls\", \"remind me 2\", \"lawer\", \"wensday\").",
        "Ask for two things at once: \"book John Smith Wed 2pm and remind me to call his lawyer\". G.O.A.T. handles them one after the other, knows \"his\" means John, and still shows a card for each before saving.",
        "Heads-ups you hide with × stay hidden on every device you sign in on (saved to your account, kept 30 days). A new problem shows up as a new heads-up.",
        "The Initial Exam heads-up counts a case as having one if the Initial Exam box is filled, a New Patient visit is on the schedule, or there's an Initial Exam note. Only active cases are checked.",
        "G.O.A.T. remembers the last patient you worked on, even next time you sign in (saved to your account). Say \"call his lawyer\" or \"remind me to call her back\" and the to-do is linked to that patient on the card.",
        "If G.O.A.T. isn't sure what you mean, it asks one short question (\"Is this about John, or all your cases?\") instead of showing a list of buttons.",
        "To-do cards show the real date they resolved to (\"Due Thu, 10/22/2026\") so you can check it before saving.",
      ],
      why: "Every contacts save is also kept in the cloud's version history, so an admin can restore an earlier list if needed.",
    },
    {
      heading: "Tell G.O.A.T. it got something wrong",
      steps: [
        "Right after G.O.A.T. does something (a note, to-do, booking, message or contact import), say \"you did it wrong\", \"that's wrong\", \"not that\" or \"no\".",
        "It apologizes, says in plain words what it did, and offers only buttons that fit: e.g. Change it, Take it out (where it can undo), or It's fine.",
        "Nothing changes until you tap Confirm on the card it shows.",
      ],
      why: "A follow-up about what G.O.A.T. just did always refers to that, never to an older patient you looked at.",
    },
    {
      heading: "G.O.A.T. on your phone (home-screen app)",
      steps: [
        "Open mynotegoat.com/goat: just the G.O.A.T. chat, full screen, made for phones. Same login, same patients, same confirm cards; admin-only answers stay admin-only. \"Full app\" (top right) opens the rest of My Note Goat.",
        "iPhone/iPad (Safari): open /goat, tap Share, then Add to Home Screen. G.O.A.T. shows this tip at the top of the chat until you close it (×). Closing it is saved to your account, so it stays closed on your other devices too.",
        "The first time you open the Home Screen icon, log in once. The app keeps its own login after that, and it comes straight back to G.O.A.T.",
        "Android (Chrome): the tip has an Install button. Long-press the icon for shortcuts: Ask G.O.A.T., New to-do, Schedule.",
        "A link like /goat?q=add to-do call Mock Law puts that text in the box. Nothing runs until you tap Send.",
      ],
      watchOut: "The Android app-store (APK) version isn't built yet. The home-screen app is the phone version for now.",
    },
    {
      heading: "Book someone who isn't a patient yet",
      steps: [
        "Type it like you'd say it: \"schedule john smith next thursday for initial appointment\". \"initial\", \"new appt\", \"first visit\", \"NP\" and \"eval\" all mean the New Patient visit type.",
        "If nobody is named John Smith, G.O.A.T. says so and adds him as a new patient right in the chat. It asks only for what's missing, one short question at a time: phone first, then the day or time if you didn't give them.",
        "Then you get one card with the new patient (name, phone) and the New Patient visit (date, time, provider and office). Confirm adds the patient and books the visit together. Edit in New Appointment opens the filled-in popup instead.",
        "Office hours and open times are checked the same way as on the Schedule. If the time doesn't work, the card shows open times nearby.",
      ],
      watchOut: "When you type a first AND last name, G.O.A.T. only picks patients with that last name (small typos are OK). It never jumps from John Smith to a different John. If two patients have the same name, it asks which one you mean.",
    },
    {
      heading: "How G.O.A.T. reads days",
      steps: [
        "A weekday on its own, or \"this Wednesday\", means the coming one. On a Monday, \"Wednesday\" is two days away and \"this Monday\" is today.",
        "\"Next Wednesday\" means the one after that, one week later. On Mon 10/19/2026, that's Wed 10/28/2026.",
        "Every card shows the exact date (e.g. Wed 10/28/2026), so you can catch a mix-up before you confirm.",
      ],
    },
    {
      heading: "Ask about the schedule in plain words",
      steps: [
        "Ask by visit type and time: \"any upcoming new patients?\", \"new patients this week\", \"any re-exams friday\", \"when is the next new patient\", \"who's coming in tomorrow\", \"how many appointments today\".",
        "G.O.A.T. answers with a short list: date, time, patient, visit type and office. Each patient's name is a link (shown once), plus a link to that day on the Schedule.",
        "Typos and stray punctuation are fine (\"new patients>\" works). Canceled and no-show visits are left out.",
        "Count canceled, no-show or completed visits: \"how many canceled appointments\", \"no-shows this week\", \"who canceled last month\". With no timeframe it asks \"For which time frame?\" with buttons (Today, This week, This month, Last month, All time), then answers.",
        "It only sees the offices you can see. Admin-only numbers (case counts, money) stay admin-only.",
        "If G.O.A.T. isn't sure what you mean, it asks a short question with buttons (schedule, to-dos, case, contact) instead of listing everything.",
      ],
    },
    {
      heading: "Ask \"how do I…\" about anything in the Handbook",
      steps: [
        "Ask G.O.A.T. \"how do I send a form\", \"where do I change office hours\" or \"how to merge duplicate encounters\".",
        "G.O.A.T. searches the whole Handbook on your device (no cloud AI), gives you the short version of the best section and links straight to it.",
        "If two or three sections fit, it lists them so you can pick one. If nothing fits, it asks what you're trying to do.",
        "New Handbook sections are searchable as soon as they're added. Admin-only sections only show up for admins.",
      ],
    },
    {
      heading: "Ask for help",
      steps: ["Type \"what can you do?\" or \"help\" and G.O.A.T. sums this up and links here."],
    },
  ],
};

/** Short "what can you do?" answer for the chat (links to the chapter). */
export function goatHelpText(): string {
  return [
    "Here's what I can do:",
    `- Chips: ${CHIPS.join(", ")} (the last two are for admins)`,
    "- Look up patients, the schedule, to-dos, contacts, cases and money",
    "- Add signed notes, to-dos, payments and case changes (with a confirm card)",
    "- Message the team (\"tell hannah john smith's MRI is in\", or @; 🔒 Eyes only)",
    "- Just say what you need in plain words; nothing needs a special command",
    `- Optional shortcuts: ${SLASH_COMMANDS.map((c) => `/${c.cmd}`).join(", ")}`,
    "- Merge duplicate encounters on the patient page (with a backup)",
    "- Paste a list of contacts to add them all at once",
    "- On your phone: open /goat and add G.O.A.T. to your Home Screen",
    "If I'm not sure, I'll ask. Full guide: Handbook → G.O.A.T.",
  ].join("\n");
}

export function isGoatHelpQuestion(raw: string): boolean {
  const q = raw.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  return /^(help|help me|\?|commands|menu)$|^what (can|do) (you|u|goat) do( for me| here)?$|^what are your (features|commands|skills)\b|^how do i use (you|goat)\b|^what can i (ask|do)( here| with you)?\b|^what (else )?can (you|u) help (me )?with\b/.test(q);
}
