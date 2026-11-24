/**
 * Office setup walkthrough. Progress is a workspace_kv row so it follows
 * the office to every computer. localStorage is only the cache the boot
 * already uses for other cloud keys.
 */

import { notifyChange } from "@/lib/local-sync";

export const SETUP_WALKTHROUGH_KEY = "casemate.setup-walkthrough.v1";
export const OPEN_SETUP_EVENT = "open-setup-walkthrough";

export interface SetupStep {
  id: string;
  title: string;
  /** Where the Open button goes. */
  href: string;
  openLabel: string;
  /** What to click, in order. */
  lines: string[];
  /** Optional picture of generic sample data. Never a real office. */
  example?: { src: string; alt: string };
}

export const SETUP_STEPS: SetupStep[] = [
  {
    id: "office-info",
    title: "Office info",
    href: "/settings?section=office",
    openLabel: "Open Office Information",
    example: { src: "/setup-walkthrough/office-info.png", alt: "Example office card for Northwind Spine, a made-up practice" },
    lines: [
      "Click Settings in the left sidebar.",
      "Stay on the Office tab.",
      "Open Office Settings, then open Office Information.",
      "Type your practice name in Office Name.",
      "Type the main number in Phone, and the fax and email if you use them.",
      "Type the street, city, state, and ZIP. This is what prints on letters.",
      "Under Claim document, choose Lien or LOP. That is the word G.O.A.T. Mail uses for the claim document.",
      "If you have more than one location, find Office Locations, click + Office, and type a short nickname for each place. Put that location’s address and number on its own card. Hours for each location are on that card too.",
    ],
  },
  {
    id: "hours-closed",
    title: "Hours and closed days",
    href: "/settings?section=schedule",
    openLabel: "Open Schedule settings",
    example: { src: "/setup-walkthrough/hours.png", alt: "Example hours: Monday through Friday 9:00 to 5:00, Saturday and Sunday not open" },
    lines: [
      "Click Settings, then the Schedule tab.",
      "Open Office Settings, then open Schedule.",
      "Find Office Hours. A new office starts Monday–Friday 9:00 to 5:00, Saturday and Sunday not open. Change the times to yours.",
      "For a day you are closed every week, uncheck Open. That weekday will not take appointments.",
      "Set Appointment interval (15 minutes is the starting point) and how many visits can share one start time.",
      "Leave “Block appointments outside office hours” on if you do not want visits booked before open or after close.",
      "Closed days that are not every week (a holiday, a staff day, a day you close early) are not set here. Click Key Dates in the sidebar.",
      "On Key Dates, pick the date, set Office status to Closed, type a short reason, and click Add Key Date. The schedule treats that day as closed.",
    ],
  },
  {
    id: "staff-roles",
    title: "Staff and roles",
    href: "/settings?tab=office",
    openLabel: "Open Team Members",
    lines: [
      "Click Settings, then the Office tab.",
      "Open Team Members.",
      "Click + Team Member.",
      "Type their first name, the email they will sign in with, and a temporary password (at least 6 characters).",
      "Under Access role, choose Staff (day-to-day), Manager (runs the office), or Admin (everything).",
      "Click Create Member. They sign in with that email and password, then change the password.",
      "On the Office tab, open Roles & Permissions.",
      "For Staff and for Manager, set what each role can open, add, edit, and delete. Admin already has everything.",
      "Set the delete password on that same screen if you want a password before someone can delete a patient or a note.",
    ],
  },
  {
    id: "providers",
    title: "Providers",
    href: "/settings?section=office",
    openLabel: "Open Doctors",
    lines: [
      "Click Settings, then Office, then Office Settings, then Office Information.",
      "Find the Doctors card. These are the providers you schedule under.",
      "Type a provider’s name and add them. Do this for every doctor who sees patients, even if they do not have a login.",
      "If that provider also signs in, open Team Members and turn on Doctor next to their name. Their login and the schedule name stay tied together.",
      "With more than one location, open each office card and tap the doctors who work there.",
    ],
  },
  {
    id: "attorneys",
    title: "Attorneys",
    href: "/contacts",
    openLabel: "Open Contacts",
    example: { src: "/setup-walkthrough/attorneys.png", alt: "Example attorney row: Sample Law Group, a made-up firm" },
    lines: [
      "A new office starts with an empty attorney list. Nothing is copied in.",
      "Click Contacts in the sidebar.",
      "Click Add Contact.",
      "Type the firm or attorney name.",
      "Set the category to Attorney.",
      "Type the number, fax, email, and address you want on letters and on the patient file.",
      "Save. Repeat for each firm you work with.",
      "To add imaging centers or specialists, use the same Add Contact button and pick that category instead.",
    ],
  },
  {
    id: "case-settings",
    title: "Case settings",
    href: "/settings?section=caseStatuses",
    openLabel: "Open Case Status Categories",
    lines: [
      "Click Settings, then the Office tab.",
      "Open Office Settings, then open Case Status Categories.",
      "The starting statuses are Active, Discharged, Ready To Submit, Submitted, Dropped, and Paid. Case Flow needs a status on every case. Rename one only if your office uses a different word.",
      "Set the color next to a status if you want it to stand out on the lists.",
      "Open the Lien / LOP options and the Review options and delete any you will not use. Add a line if you track something else.",
      "The claim word (Lien or LOP) itself is on Office Information, under Claim document.",
    ],
  },
  {
    id: "soap-macros",
    title: "SOAP note macros",
    href: "/settings?section=soapMacros",
    openLabel: "Open SOAP Macro Settings",
    lines: [
      "A new office starts with no SOAP macros. You write your own. Nothing from another office is filled in.",
      "Click Settings, then the Notes & Macros tab.",
      "Open Macros, then open SOAP Macro Settings.",
      "Click + Macro.",
      "Pick the section: Subjective, Objective, Assessment, or Plan.",
      "Type a short button name (what you tap while writing the note) and the sentence the button inserts.",
      "Use [[words]] for a blank you fill in each visit, such as [[pain scale]].",
      "Click Create. Add at least one macro in each of the four sections before you rely on the note screen.",
      "Open a test note later and tap the button to confirm the wording.",
    ],
  },
  {
    id: "templates",
    title: "Note and letter templates",
    href: "/settings?section=documents",
    openLabel: "Open Document Templates",
    lines: [
      "Click Settings, then the Notes & Macros tab.",
      "Open Templates, then open Document Templates.",
      "A new office has two short letters: Specialist Referral and Imaging Request. Open each one and replace the short text with your wording. Tokens such as {{PATIENT_FULL_NAME}} and {{OFFICE_NAME}} fill in from the patient and the office.",
      "The header above the letters uses those same office tokens. Edit it if you want a different letterhead.",
      "On the same screen, open Narrative Reports if you send a long report. Add the report your office actually sends. Leave it empty if you do not.",
      "Text messages you send by hand live under the Reminders tab, in SMS / Text Templates. Edit those before you text a patient.",
    ],
  },
  {
    id: "diagnosis-codes",
    title: "Diagnosis codes",
    href: "/settings?section=billingMacros",
    openLabel: "Open Diagnosis codes",
    lines: [
      "A new office starts with one empty folder named General. No diagnosis list is copied in.",
      "Click Settings, then the Billing tab.",
      "Open Macros, then open Billing Macro Settings.",
      "Open Diagnosis Macro Settings.",
      "Add a folder for each region you want (for example Cervical, Lumbar) or keep everything in General.",
      "Add each ICD-10 code your office uses: the code and a short description, filed in a folder.",
      "The note screen can also search the built-in ICD-10 list. Codes you add here are the ones that show up as buttons.",
      "If you bill procedures, open the treatment list on this same screen and add each CPT you charge, with your price. Those start empty too.",
    ],
  },
  {
    id: "schedule-types",
    title: "Schedule and appointment types",
    href: "/settings?section=schedule",
    openLabel: "Open Appointment Types",
    lines: [
      "A new office starts with no appointment types. The schedule cannot name a visit until you add some.",
      "Click Settings, then the Schedule tab.",
      "Open Schedule, then find Appointment Types.",
      "Type a name (New Patient, Office Visit, Re-exam, Discharge), pick a color, set the minutes, and choose whether it is for personal-injury patients, cash patients, or both.",
      "Add every type your front desk books. Mark one as the default if most visits are the same kind.",
      "Click Schedule in the sidebar and confirm the day shows your open hours and the types you added.",
      "Book a pretend visit only if you want to see the grid. You can delete it afterward.",
    ],
  },
  {
    id: "forms",
    title: "Forms and questionnaires",
    href: "/settings?section=forms",
    openLabel: "Open Forms",
    lines: [
      "A new office starts with no forms.",
      "Click Settings, then the Forms tab.",
      "Open Forms.",
      "Click + New form.",
      "Name it (for example New patient questions).",
      "Add the questions. Forms are built from your Objective macros, so add those macros first if the form should drop answers into the note.",
      "Save the form.",
      "On a patient file, use Send form when you want that patient to fill it out.",
    ],
  },
  {
    id: "text-reminders",
    title: "Text reminders",
    href: "/settings?section=textReminders",
    openLabel: "Open the text reminder setup",
    lines: [
      "Click Settings, then the Reminders tab.",
      "Open Text Reminders.",
      "That page already has the guided device setup. Follow it from the top. Do not skip a step.",
      "The Device is the office computer or the office Device that sends the texts. It does not send anything until those steps are finished and you turn reminders on.",
      "Under SMS / Text Templates on the same Reminders tab, read the appointment reminder. A new office’s reminder signs off with {{OFFICE_NAME}}, not another practice’s name. Change the words if you want.",
      "Leave reminders off until a real day looks right in the preview.",
    ],
  },
  {
    id: "goat",
    title: "G.O.A.T.",
    href: "/settings/goat#chat",
    openLabel: "Open G.O.A.T. settings",
    lines: [
      "Click Settings, then the G.O.A.T. tab. You can also open G.O.A.T. from the sidebar and use the chat from any page.",
      "Open G.O.A.T. settings (the button above, or Settings → G.O.A.T.).",
      "Read G.O.A.T. answers. Turn on costs and fees only if you want those in the wording. Drag the region order into the order you dictate.",
      "Open G.O.A.T. words & abbreviations. Add any short word your office uses that is not already there.",
      "Open Note signatures. Add each person who writes notes. Turn on Doctor for providers so the note signs with their name. Link a signature to that person’s login when they have one.",
      "Type a short question in the G.O.A.T. chat about a patient you add later, and confirm it answers in your words.",
    ],
  },
  {
    id: "goat-page",
    title: "G.O.A.T. Page",
    href: "/settings/goat#goat-page",
    openLabel: "Open the G.O.A.T. Page board",
    lines: [
      "Click G.O.A.T. in the sidebar to see the board your day starts on.",
      "Click Settings, then the G.O.A.T. tab, and open G.O.A.T. Page. The button above lands on that section.",
      "Turn on the boxes you want (today’s schedule, status lists, tasks). Turn off boxes you will not use.",
      "Click Arrange boxes, move and resize the boxes, then click Done arranging.",
      "Click Save as office default so the rest of the staff start from this layout. Each person can still arrange their own afterward.",
      "Click G.O.A.T. in the sidebar again and confirm the board matches what you just saved.",
    ],
  },
  {
    id: "documents-files",
    title: "Documents and files",
    href: "/my-files",
    openLabel: "Open My Files",
    lines: [
      "Click My Files in the sidebar. This is the office file cabinet, separate from a single patient’s chart.",
      "Create a folder for each place you keep shared paperwork (referrals, forms, letterhead).",
      "Open a folder and click Upload File for a blank form or a logo you want everyone to reach.",
      "Patient paperwork lives on the patient, not here. Open a patient, find the files section, and upload that patient’s records there.",
      "Letters you generate from a template are created from the patient file. The templates themselves are edited under Settings → Document Templates.",
    ],
  },
  {
    id: "patient-flow",
    title: "New patient to case",
    href: "/patients",
    openLabel: "Open Patient List",
    example: { src: "/setup-walkthrough/patient.png", alt: "Example patient Jane Sample, a made-up chart" },
    lines: [
      "Click Patient List in the sidebar.",
      "Click New Patient.",
      "Type the first and last name, date of birth, and number.",
      "Choose the attorney from the list you built. If they have no attorney, leave it as you would for a cash patient and set the patient type accordingly.",
      "Type the date of injury for a personal-injury case.",
      "Save. The new chart opens.",
      "On the chart, confirm the case status is Active and the attorney, date of injury, and number are right.",
      "Click Schedule in the sidebar, click the day, and book their first visit. Choose the New Patient appointment type you created.",
      "After the visit, open Encounters (or the note from the chart) and write the note with your SOAP macros.",
      "The case stays on Patient List. Statistics and the G.O.A.T. Page read that same chart.",
    ],
  },
];

const STEP_IDS = new Set(SETUP_STEPS.map((step) => step.id));

export interface StepCheck {
  on: boolean;
  at: string;
}

export interface SetupProgress {
  checks: Record<string, StepCheck>;
  dismissedAt?: string;
}

export function emptyProgress(): SetupProgress {
  return { checks: {} };
}

export function isStepDone(progress: SetupProgress, id: string): boolean {
  return progress.checks[id]?.on === true;
}

export function doneCount(progress: SetupProgress): number {
  return SETUP_STEPS.filter((step) => isStepDone(progress, step.id)).length;
}

export function normalizeProgress(value: unknown): SetupProgress {
  if (!value || typeof value !== "object") return emptyProgress();
  const row = value as Record<string, unknown>;
  const checks: Record<string, StepCheck> = {};
  const rawChecks = row.checks;
  if (rawChecks && typeof rawChecks === "object") {
    for (const [id, raw] of Object.entries(rawChecks as Record<string, unknown>)) {
      if (!STEP_IDS.has(id) || !raw || typeof raw !== "object") continue;
      const item = raw as { on?: unknown; at?: unknown };
      const at = typeof item.at === "string" ? item.at : "";
      if (!at) continue;
      checks[id] = { on: item.on === true, at };
    }
  }
  const dismissedAt = typeof row.dismissedAt === "string" && row.dismissedAt.trim() ? row.dismissedAt : undefined;
  return { checks, ...(dismissedAt ? { dismissedAt } : {}) };
}

/** Newer check wins per step. A dismiss on either side stays dismissed. */
export function mergeProgress(a: SetupProgress, b: SetupProgress): SetupProgress {
  const ids = new Set([...Object.keys(a.checks), ...Object.keys(b.checks)]);
  const checks: Record<string, StepCheck> = {};
  for (const id of ids) {
    if (!STEP_IDS.has(id)) continue;
    const left = a.checks[id];
    const right = b.checks[id];
    if (left && right) checks[id] = left.at >= right.at ? left : right;
    else if (left) checks[id] = left;
    else if (right) checks[id] = right;
  }
  const dismissed = [a.dismissedAt, b.dismissedAt].filter((value): value is string => Boolean(value)).sort().at(-1);
  return { checks, ...(dismissed ? { dismissedAt: dismissed } : {}) };
}

export function withStep(progress: SetupProgress, id: string, on: boolean, at = new Date().toISOString()): SetupProgress {
  if (!STEP_IDS.has(id)) return progress;
  return { ...progress, checks: { ...progress.checks, [id]: { on, at } } };
}

export function withDismissed(progress: SetupProgress, at = new Date().toISOString()): SetupProgress {
  const dismissedAt = progress.dismissedAt && progress.dismissedAt > at ? progress.dismissedAt : at;
  return { ...progress, dismissedAt };
}

export function loadProgress(): SetupProgress {
  if (typeof window === "undefined") return emptyProgress();
  try {
    const raw = window.localStorage.getItem(SETUP_WALKTHROUGH_KEY);
    return raw ? normalizeProgress(JSON.parse(raw)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

function writeLocal(progress: SetupProgress) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETUP_WALKTHROUGH_KEY, JSON.stringify(progress));
  notifyChange(SETUP_WALKTHROUGH_KEY);
}

/** Read the cloud copy and merge it with this browser. Does not skip the cloud. */
export async function pullProgress(): Promise<SetupProgress> {
  const local = loadProgress();
  try {
    const { fetchKvValue } = await import("@/lib/kv-cloud");
    const cloud = await fetchKvValue<unknown>(SETUP_WALKTHROUGH_KEY);
    if (cloud == null) return local;
    const merged = mergeProgress(local, normalizeProgress(cloud));
    writeLocal(merged);
    return merged;
  } catch {
    return local;
  }
}

/** Merge with the cloud row, save locally, and write the cloud. Throws if the cloud write fails. */
export async function saveProgress(next: SetupProgress): Promise<SetupProgress> {
  const { fetchKvValue, dualWriteKvOrThrow } = await import("@/lib/kv-cloud");
  let merged = next;
  try {
    const cloud = await fetchKvValue<unknown>(SETUP_WALKTHROUGH_KEY);
    if (cloud != null) merged = mergeProgress(normalizeProgress(cloud), next);
  } catch {
    merged = mergeProgress(loadProgress(), next);
  }
  writeLocal(merged);
  await dualWriteKvOrThrow(SETUP_WALKTHROUGH_KEY, "tasks", merged);
  return merged;
}

export function openSetupWalkthrough() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_SETUP_EVENT));
}
