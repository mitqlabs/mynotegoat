/**
 * GOAT Mail triage. Rules only: a message lands in one category, or in
 * "GOAT Needs Your Answer" when two categories fit or the name is unclear.
 * Nothing here talks to Microsoft. The mailbox read stays in the server route.
 */
import { findDuplicateCases, duplicateDateIso, splitPatientName } from "@/lib/patient-duplicate";
import { unionMerge } from "@/lib/kv-merge";
import { notifyChange } from "@/lib/local-sync";
import { quickFillFromText, type QuickFillResult } from "@/lib/quick-fill";

export const GOAT_MAIL_KEY = "casemate.goat-mail.v1";

/** Shown when the server has no mailbox app yet. No setup steps. */
export const GOAT_MAIL_SETUP_LINE = "GOAT Mail isn't turned on for this office yet. The person who runs NoteGoat turns it on. Until then, GOAT does not read any mailbox.";

/** Shown when the server is ready and this office has not connected a mailbox. */
export const GOAT_MAIL_CONNECT_LINE = "Sign in with your office Outlook to let GOAT read (never send) your email.";

/** Workspace settings row. The mail API writes it. Inbox is used when it is empty. */
export const GOAT_MAIL_FOLDERS_KEY = "casemate.goat-mail-folders.v1";

export type MailFolderChoice = {
  id: string;
  name: string;
  path: string;
  wellKnownName?: string;
};

/** Graph folder ids are opaque. Reject anything that could change the request path. */
export function isSafeFolderId(id: string): boolean {
  return id === "inbox" || /^[A-Za-z0-9=+\/_-]{1,180}$/.test(id);
}

/** Saved folder ids that still exist, or Inbox when the office has not chosen. */
export function chosenFolderIds(folders: MailFolderChoice[], saved: string[] | null | undefined): string[] {
  const known = new Set(folders.map((folder) => folder.id));
  const kept = (saved ?? []).filter((id) => (known.size > 0 ? known.has(id) : isSafeFolderId(id)));
  if (kept.length) return kept;
  const inbox = folders.find((folder) => folder.wellKnownName === "inbox") ?? folders.find((folder) => folder.name.toLowerCase() === "inbox");
  return inbox ? [inbox.id] : [];
}

/** Newest first. The same message in two folders is listed once. */
export function mergeMailMessages(groups: GoatMailMessage[][], limit = 25): GoatMailMessage[] {
  const byId = new Map<string, GoatMailMessage>();
  for (const group of groups) {
    for (const message of group) if (message.id) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || "")).slice(0, limit);
}

export type GoatMailCategory = "new-patient" | "lien" | "rb" | "medicals" | "specialist" | "bounced" | "other";

export type GoatMailFlag = "unbooked" | "multi-passenger" | "second-crash";

export type ClaimDocument = "lien" | "lop";

export type GoatMailMessage = {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  body: string;
};

export type GoatMailDecision = {
  id: string;
  patientId?: string;
  category?: GoatMailCategory;
  resolved?: boolean;
  updatedAt: string;
};

export type GoatMailDraft = {
  firstName: string;
  lastName: string;
  phone?: string;
  dob?: string;
  dateOfLoss: string;
  attorney?: string;
  address?: string;
  initialExam?: string;
};

export type GoatMailChoice = { id: GoatMailCategory; label: string };

export type GoatMailRow = {
  id: string;
  category: GoatMailCategory;
  label: string;
  subject: string;
  from: string;
  receivedAt: string;
  flags: GoatMailFlag[];
  missing: string[];
  needsAnswer: boolean;
  question: string;
  choices: GoatMailChoice[];
  patientId?: string;
  create: boolean;
  draft?: GoatMailDraft;
};

type PatientLike = { id: string; fullName: string; dateOfLoss?: string; deleted?: boolean };
type VisitLike = { patientId: string; date: string; status: string };

const ACTION = /\b(need|needed|request|requested|send|sign|please|attach|attached)\b/i;

function readable(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/[ \t]+\n/g, "\n").trim();
}

export function claimDocumentLabel(kind: ClaimDocument): string {
  return kind === "lop" ? "LOP" : "Lien";
}

export function mailCategoryLabel(category: GoatMailCategory, claim: ClaimDocument): string {
  switch (category) {
    case "new-patient":
      return "New Patient referral";
    case "lien":
      return `${claimDocumentLabel(claim)} request needed`;
    case "rb":
      return "R&B / Report & Bill requested";
    case "medicals":
      return "Medicals requested";
    case "specialist":
      return "Specialist/imaging reply";
    case "bounced":
      return "Bounced email";
    default:
      return "Other";
  }
}

function signals(text: string, from: string): Set<GoatMailCategory> {
  const found = new Set<GoatMailCategory>();
  const bounced =
    /mailer-daemon|postmaster/i.test(from) ||
    /\b(undeliverable|delivery status notification|mail delivery failed|returned mail)\b/i.test(text);
  if (bounced) {
    found.add("bounced");
    return found;
  }
  if (/\b(new patient|patient referral|referr(?:al|ed)|please schedule|date of (?:injury|loss)|\bdoi\b|\bdol\b)\b/i.test(text)) found.add("new-patient");
  if (/\b(lien|lop|letter of protection)\b/i.test(text) && ACTION.test(text)) found.add("lien");
  if (/\b(r\s*&\s*b|r and b|reports? and bills?)\b/i.test(text)) found.add("rb");
  if (/\b(medical records|medicals|records request)\b/i.test(text)) found.add("medicals");
  if (/\b(mri|x-?rays?|xray|ct scan|emg|ncv|radiology|imaging)\b/i.test(text) && /\b(report|results?|findings?|impression|attached|enclosed)\b/i.test(text)) {
    found.add("specialist");
  }
  return found;
}

function patientLineCount(body: string): number {
  return (body.match(/^\s*patient\s*:/gim) ?? []).length;
}

function multiPassenger(text: string): boolean {
  return patientLineCount(text) >= 2 || /\b(passengers?|driver and passenger|both (?:patients|occupants)|two patients|multiple (?:patients|occupants))\b/i.test(text);
}

function nameUnclear(fill: QuickFillResult): boolean {
  return fill.ask.some((line) => /last name/i.test(line));
}

function missingFields(fill: QuickFillResult): string[] {
  const missing: string[] = [];
  if (!fill.phone) missing.push("phone");
  if (!fill.dateOfLoss) missing.push("date of injury");
  if (!fill.dob) missing.push("date of birth");
  if (!fill.attorney) missing.push("attorney");
  return missing;
}

function addressOf(fill: QuickFillResult): string {
  return [fill.addressStreet, fill.addressUnit, fill.addressCity, fill.addressState, fill.addressZip].filter(Boolean).join(", ");
}

function sameName(patient: PatientLike, first: string, last: string): boolean {
  const parts = splitPatientName(patient.fullName);
  return parts.first.toLowerCase() === first.toLowerCase() && parts.last.toLowerCase() === last.toLowerCase();
}

function bookedLater(patientId: string, visits: VisitLike[], todayIso: string): boolean {
  return visits.some((visit) => visit.patientId === patientId && visit.date >= todayIso && visit.status !== "Canceled" && visit.status !== "No Show");
}

export function triageGoatMail(input: {
  messages: GoatMailMessage[];
  patients: PatientLike[];
  appointments: VisitLike[];
  todayIso: string;
  claimDocument: ClaimDocument;
  decisions?: GoatMailDecision[];
}): GoatMailRow[] {
  const decisions = new Map((input.decisions ?? []).map((row) => [row.id, row]));
  const rows: GoatMailRow[] = [];
  for (const message of input.messages) {
    const decision = decisions.get(message.id);
    if (decision?.resolved) continue;
    const text = readable(message.body);
    const found = signals(readable(`${message.subject}\n${message.body}`).replace(/\s+/g, " "), message.from);
    const fill = quickFillFromText(text, { todayIso: input.todayIso });
    const chosen = decision?.category;
    const conflict = !chosen && found.size > 1 && !found.has("bounced");
    let category: GoatMailCategory = chosen ?? (found.size === 1 ? [...found][0] : "other");
    if (conflict) category = "other";
    const severalPassengers = multiPassenger(message.body);
    const unclearName = nameUnclear(fill);
    const named = Boolean(fill.firstName && fill.lastName);
    const live = input.patients.filter((patient) => !patient.deleted && named && sameName(patient, fill.firstName ?? "", fill.lastName ?? ""));
    const newDol = duplicateDateIso(fill.dateOfLoss);
    const duplicate = named
      ? findDuplicateCases(live, { firstName: fill.firstName ?? "", lastName: fill.lastName ?? "", dateOfLoss: fill.dateOfLoss })
      : [];
    const secondCrash = named && Boolean(newDol) && live.some((patient) => {
      const existing = duplicateDateIso(patient.dateOfLoss);
      return Boolean(existing) && existing !== newDol;
    });
    const blankExisting = named && live.some((patient) => !duplicateDateIso(patient.dateOfLoss));
    const needsName = category === "new-patient" && (!named || unclearName);
    const needsWho = category === "new-patient" && named && live.length > 1 && !secondCrash && duplicate.length === 0;
    const needsCrash = category === "new-patient" && blankExisting && !secondCrash && duplicate.length === 0;
    const needsAnswer = conflict || needsName || needsWho || needsCrash || (severalPassengers && patientLineCount(message.body) >= 2 && !chosen);
    let question = "";
    let choices: GoatMailChoice[] = [];
    if (conflict) {
      question = "Which is this?";
      choices = [...found].map((id) => ({ id, label: mailCategoryLabel(id, input.claimDocument) }));
    } else if (needsName) {
      question = unclearName ? "Which last name should GOAT use?" : "Who is the new patient?";
    } else if (needsWho || needsCrash) {
      question = "Which patient?";
    } else if (needsAnswer) {
      question = "Which patients are in this crash?";
    }
    const matched = duplicate[0] ?? (live.length === 1 ? live[0] : undefined);
    const flags: GoatMailFlag[] = [];
    if (category === "new-patient" && !needsAnswer) {
      const alreadyBooked = matched ? bookedLater(matched.id, input.appointments, input.todayIso) : false;
      if (!alreadyBooked) flags.push("unbooked");
      if (severalPassengers) flags.push("multi-passenger");
      if (secondCrash) flags.push("second-crash");
    } else if (severalPassengers && (category === "new-patient" || needsAnswer)) {
      flags.push("multi-passenger");
    }
    const missing = category === "new-patient" ? missingFields(fill) : [];
    const canCreate =
      category === "new-patient" &&
      !needsAnswer &&
      named &&
      !unclearName &&
      duplicate.length === 0 &&
      !blankExisting &&
      !decision?.patientId &&
      patientLineCount(message.body) < 2;
    const draft: GoatMailDraft | undefined = canCreate
      ? {
          firstName: fill.firstName ?? "",
          lastName: fill.lastName ?? "",
          phone: fill.phone,
          dob: fill.dob,
          dateOfLoss: fill.dateOfLoss ?? "",
          attorney: fill.attorney,
          address: addressOf(fill) || undefined,
          initialExam: fill.evalDate,
        }
      : undefined;
    rows.push({
      id: message.id,
      category,
      label: needsAnswer && conflict ? "Needs your answer" : mailCategoryLabel(category, input.claimDocument),
      subject: message.subject || "(no subject)",
      from: message.from,
      receivedAt: message.receivedAt,
      flags,
      missing,
      needsAnswer,
      question,
      choices,
      patientId: decision?.patientId ?? (duplicate[0]?.id),
      create: canCreate,
      draft,
    });
  }
  return rows;
}

function normalizeDecisions(value: unknown): GoatMailDecision[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is GoatMailDecision => !!row && typeof row === "object" && typeof (row as GoatMailDecision).id === "string")
    .map((row) => ({
      id: row.id,
      ...(typeof row.patientId === "string" ? { patientId: row.patientId } : {}),
      ...(row.category === "new-patient" || row.category === "lien" || row.category === "rb" || row.category === "medicals" || row.category === "specialist" || row.category === "bounced" || row.category === "other" ? { category: row.category } : {}),
      ...(row.resolved === true ? { resolved: true } : {}),
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
    }));
}

export function loadMailDecisions(): GoatMailDecision[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeDecisions(JSON.parse(window.localStorage.getItem(GOAT_MAIL_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function mergeMailDecisions(local: GoatMailDecision[], cloud: unknown): GoatMailDecision[] {
  return normalizeDecisions(unionMerge(local, normalizeDecisions(cloud)));
}

export function answerMail(records: GoatMailDecision[], id: string, category: GoatMailCategory, now: string): GoatMailDecision[] {
  const prior = records.find((row) => row.id === id);
  return [...records.filter((row) => row.id !== id), { ...prior, id, category, updatedAt: now }];
}

export function resolveMail(records: GoatMailDecision[], id: string, now: string): GoatMailDecision[] {
  const prior = records.find((row) => row.id === id);
  return [...records.filter((row) => row.id !== id), { ...prior, id, resolved: true, updatedAt: now }];
}

export function rememberMailPatient(records: GoatMailDecision[], id: string, patientId: string, now: string): GoatMailDecision[] {
  const prior = records.find((row) => row.id === id);
  return [...records.filter((row) => row.id !== id), { ...prior, id, patientId, updatedAt: now }];
}

/** Save locally, then merge with the cloud row before writing it. */
export async function saveMailDecisions(records: GoatMailDecision[]): Promise<void> {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GOAT_MAIL_KEY, JSON.stringify(records));
  notifyChange(GOAT_MAIL_KEY);
  try {
    const kv = await import("@/lib/kv-cloud");
    const remote = await kv.fetchKvValue<unknown>(GOAT_MAIL_KEY).catch(() => null);
    const merged = mergeMailDecisions(records, remote);
    window.localStorage.setItem(GOAT_MAIL_KEY, JSON.stringify(merged));
    await kv.dualWriteKv(GOAT_MAIL_KEY, "tasks", merged);
  } catch {
    // Local copy stands; the boot merge reconciles later.
  }
}
