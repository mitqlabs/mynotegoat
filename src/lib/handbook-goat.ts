/**
 * Handbook → G.O.A.T. "What can I do?". RULE: every new G.O.A.T. feature must
 * add or update a task here (scripts/sanity-check.mjs Rule 7 enforces that
 * G.O.A.T. code changes come with a change to this file, and the "/" command
 * list below is generated from SLASH_COMMANDS so it can't drift).
 */
import { CHIPS, SLASH_COMMANDS } from "@/lib/goat-briefs";
import type { HandbookChapter } from "@/lib/handbook-content";

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
        "If G.O.A.T. isn't sure (two John Smiths, an unclear category), it asks instead of guessing.",
      ],
      why: "G.O.A.T. is rules-based and runs inside NoteGoat — no outside AI, and your data stays in your workspace.",
    },
    {
      heading: `Good morning chips: ${CHIPS.join(", ")}`,
      steps: [
        "Morning Rundown (everyone) — today's schedule, ALL open to-dos (overdue first, then by due date, then ones with no date) and unread team messages.",
        "Appointment Check (admins) — active patients who need to be scheduled, in two groups with counts: No appointments booked (nothing today or later; longest since last visit first, with the date and days ago; never-seen patients flagged ⚠) and Running out this week (a visit this week, nothing after). Names open the patient.",
        "Quick Biz (admins) — active / ready to submit / submitted cases, new patients this month, visits this week/month and money collected, by office. Read-only. \"How's business?\" works too.",
      ],
      why: "Office numbers — Appointment Check, Quick Biz, case counts (\"how many submitted cases\") and money questions (\"who owes us\", \"what got paid this month\") — are for the owner and admins. Anyone else gets a polite \"that's for admins\". Right after sign-in, while G.O.A.T. is still checking your role, it shows only Morning Rundown and says \"still checking your access\" if you ask for numbers.",
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
        "Notes: \"add a note for john smith: spoke to atty\" — saved signed with your name.",
        "To-dos: \"/todo call Mock Law for John Smith friday\".",
        "Payments and cases: \"mark smith paid 3200\", \"reduce lopez to 2500\", \"set lee to submitted\". Say \"undo\" right after to put it back.",
      ],
    },
    {
      heading: "\"/\" commands",
      steps: [
        "Type / as the FIRST character in the G.O.A.T. box to open the menu (Tab picks the first one). A / later in a sentence, like 10/20, is just text.",
        "/note asks \"Which case?\" (tap the right one), then the text, then a confirm card.",
        "/todo asks \"Just a to-do, or add to a case?\", then the text, then a confirm card.",
        "Changed your mind halfway? Tap a chip, type another / or @ command, ask something new, or type cancel — the half-finished step is dropped.",
        "/view shows a list: /view todo (every open to-do, with its case), /view schedule (today), /view messages (unread). Admins also get /view appointment check and /view quick biz. After typing \"/view \" the menu suggests them.",
        "/contact asks \"Add or edit?\". Add: type one contact or paste a list. Edit: pick the contact, change fields, Confirm.",
        ...SLASH_COMMANDS.map((c) => `/${c.cmd} — ${c.hint}. Example: ${c.example}`),
      ],
    },
    {
      heading: "Message the team (@mentions)",
      steps: [
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
        "G.O.A.T. suggests a category (law firms → Attorney) — change it if it's wrong.",
        "Review the table: edit any cell, untick rows you don't want. Likely duplicates of existing contacts start unticked.",
        "Confirm adds the ticked ones and tells you how many were added and skipped. \"Undo this import\" on the same card removes exactly those.",
      ],
      why: "Every contacts save is also kept in the cloud's version history, so an admin can restore an earlier list if needed.",
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
    "- Message the team with @ (🔒 Eyes only)",
    `- Commands: ${SLASH_COMMANDS.map((c) => `/${c.cmd}`).join(", ")}`,
    "- Merge duplicate encounters on the patient page (with a backup)",
    "- Paste a list of contacts to add them all at once",
    "If I'm not sure, I'll ask. Full guide: Handbook → G.O.A.T.",
  ].join("\n");
}

export function isGoatHelpQuestion(raw: string): boolean {
  const q = raw.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  return /^(help|help me|\?|commands|menu)$|^what (can|do) (you|u|goat) do( for me| here)?$|^what are your (features|commands|skills)\b|^how do i use (you|goat)\b|^what can i (ask|do)( here| with you)?\b|^what (else )?can (you|u) help (me )?with\b/.test(q);
}
