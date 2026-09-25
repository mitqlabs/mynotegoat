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
          "Patient List → New Patient.",
          "Fill the first row: Last Name, First Name, DOB, Sex, Phone. Last and first name are required.",
          "Fill the address row if you have it.",
          "Under Attorney Information: attorney, their phone, and the Date Of Injury (required). The Case # builds itself.",
          "Add anything worth knowing under Notes, then Create Patient.",
        ],
        why: "A new case always starts the same way, so the app sets it for you: Case Status Active, Lien/LOP Pending, and a \"Schedule Initial Visit\" item on their Case Flow. You change those on the patient's page as things move.",
        watchOut:
          "Tick Non-PI Patient only for cash/self-pay patients. It removes the attorney, injury date and case-number workflow, and those patients never appear in Case Flow.",
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
          "Schedule Initial Visit — clears as soon as the patient has any appointment booked. A canceled or no-showed one doesn't count.",
          "Lien / LOP — clears when the lien status moves on from the one the office marks as outstanding.",
          "X-Ray — Needs Referral clears when a referral is added; the follow-up clears when the report is received.",
          "MRI / CT and Specialist — Needs Referral → Appt Not Scheduled → Report Not Received, each clearing when that date is filled in.",
        ],
        watchOut:
          "Marking a referral \"Patient Refused\" also clears it — that's the honest way to close something that's never coming, instead of leaving it to nag forever.",
      },
    ],
  },
];
