/**
 * G.O.A.T. Mail triage. Rules only: a message lands in one category, or in
 * "G.O.A.T. Needs Your Answer" when two categories fit or the name is unclear.
 * Nothing here talks to Microsoft. The mailbox read stays in the server route.
 */
import { findDuplicateCases, duplicateDateIso, splitPatientName } from "@/lib/patient-duplicate";
import { isObviouslyBadPatientName, referralNameFromSubject } from "@/lib/new-patient-intake";
import { unionMerge } from "@/lib/kv-merge";
import { notifyChange } from "@/lib/local-sync";
import { quickFillFromText, type QuickFillResult } from "@/lib/quick-fill";

export const GOAT_MAIL_KEY = "casemate.goat-mail.v1";

/** Shown when the server has no mailbox app yet. No setup steps. */
export const GOAT_MAIL_SETUP_LINE = "G.O.A.T. Mail isn't turned on for this office yet. The person who runs NoteGoat turns it on. Until then, G.O.A.T. does not read any mailbox.";

/** Shown when the server is ready and this office has not connected a mailbox. */
export const GOAT_MAIL_CONNECT_LINE = "Sign in with your office Outlook to let G.O.A.T. read (never send) your email.";

/** Workspace settings row. The mail API writes it. Inbox is used when it is empty. */
export const GOAT_MAIL_FOLDERS_KEY = "casemate.goat-mail-folders.v1";

/** Optional Microsoft app-secret expiry. The mail API writes this row. */
export const GOAT_MAIL_SECRET_KEY = "casemate.goat-mail-secret.v1";

/** Editable mail buckets. The mail API writes this row. Missing means the built-in buckets. */
export const GOAT_MAIL_BUCKETS_KEY = "casemate.goat-mail-buckets.v1";

const MAIL_MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."] as const;

export function normalizeSecretExpiresOn(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return value;
}

/** "Nov. 11, 2026" and "June 5, 2026". May, June, and July have no period. */
export function mailSecretDateLabel(iso: string): string {
  const clean = normalizeSecretExpiresOn(iso);
  if (!clean) return iso;
  const date = new Date(Number(clean.slice(0, 4)), Number(clean.slice(5, 7)) - 1, Number(clean.slice(8, 10)));
  return `${MAIL_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function mailSecretAlertText(iso: string): string {
  return `G.O.A.T. Mail's Microsoft secret expires on ${mailSecretDateLabel(iso)}. Create a new secret in Entra and update GOAT_MAIL_CLIENT_SECRET in Vercel.`;
}

export const GOAT_MAIL_SECRET_EXPIRED = "G.O.A.T. Mail's Microsoft secret has expired. Create a new secret in Entra and update GOAT_MAIL_CLIENT_SECRET in Vercel.";

/** True when the date is today, already past, or no more than 30 days away. */
export function mailSecretDue(expiresOn: string | null | undefined, today: Date): boolean {
  const clean = normalizeSecretExpiresOn(expiresOn ?? "");
  if (!clean) return false;
  const expires = new Date(Number(clean.slice(0, 4)), Number(clean.slice(5, 7)) - 1, Number(clean.slice(8, 10)));
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const limit = new Date(start);
  limit.setDate(limit.getDate() + 30);
  return expires.getTime() <= limit.getTime();
}

/** Microsoft rejected the app secret (invalid or expired). A stale refresh token is not this. */
export function isInvalidClientSecretError(detail: string | undefined): boolean {
  const text = detail ?? "";
  if (/AADSTS7000215|AADSTS7000222|invalid_client/i.test(text)) return true;
  return /client secret/i.test(text) && /invalid|expired|expir/i.test(text);
}

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

export type GoatMailCategory = string;

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
  /** Parsed referral shown in New Patient Intake. Nothing is created until Add patient. */
  referral?: GoatMailDraft & { from: string };
};

type PatientLike = { id: string; fullName: string; dateOfLoss?: string; deleted?: boolean; phone?: string; dob?: string };

/** Last 10 digits, so 305-295-7810 and (305) 295-7810 are the same phone. */
export function mailPhoneKey(phone: string | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/**
 * An existing chart for this referral: same name, and the same phone or the
 * same date of birth. Name alone is not a match. A filler name never matches.
 */
export function matchExistingMailPatient<T extends PatientLike>(
  list: T[],
  input: { firstName: string; lastName: string; phone?: string; dob?: string },
): T | undefined {
  if (isObviouslyBadPatientName(input.firstName, input.lastName)) return undefined;
  const phone = mailPhoneKey(input.phone);
  const dob = duplicateDateIso(input.dob);
  if (!phone && !dob) return undefined;
  return list.find((patient) => {
    if (patient.deleted || !sameName(patient, input.firstName, input.lastName)) return false;
    const phoneHit = Boolean(phone) && mailPhoneKey(patient.phone) === phone;
    const dobHit = Boolean(dob) && duplicateDateIso(patient.dob) === dob;
    return phoneHit || dobHit;
  });
}

export type MailIntakePlan =
  | { action: "skip" }
  | { action: "link"; patientId: string }
  | { action: "create" };

/**
 * What to do with one email before any chart is created.
 * The same message id is never created twice. A name+phone or name+DOB
 * match is linked. A filler name such as "This" is skipped.
 */
export function planMailIntake(input: {
  messageId: string;
  draft: { firstName: string; lastName: string; phone?: string; dob?: string };
  decisions: GoatMailDecision[];
  patients: PatientLike[];
}): MailIntakePlan {
  if (input.decisions.some((row) => row.id === input.messageId && row.patientId)) return { action: "skip" };
  if (isObviouslyBadPatientName(input.draft.firstName, input.draft.lastName)) return { action: "skip" };
  const match = matchExistingMailPatient(input.patients, input.draft);
  if (match) return { action: "link", patientId: match.id };
  return { action: "create" };
}
type VisitLike = { patientId: string; date: string; status: string };

const ACTION = /\b(need|needed|request|requested|send|sign|please|attach|attached)\b/i;

function readable(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/[ \t]+\n/g, "\n").trim();
}

export function claimDocumentLabel(kind: ClaimDocument): string {
  return kind === "lop" ? "LOP" : "Lien";
}

export function mailCategoryLabel(category: string, claim: ClaimDocument): string {
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

export type MailBucket = {
  id: string;
  name: string;
  keywords: string[];
  /** Bounced also matches the sender address. */
  matchFrom?: boolean;
  /** Lien matches only when the message also asks for something. */
  requireAction?: boolean;
  /** Specialist matches only when the message also sounds like a report. */
  requireReport?: boolean;
};

const BUCKET_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** The buckets and keywords the rules started with. */
export function defaultMailBuckets(): MailBucket[] {
  return [
    { id: "new-patient", name: "New Patient referral", keywords: ["new patient", "patient referral", "referral", "referred", "please schedule", "date of injury", "date of loss", "doi", "dol"] },
    { id: "lien", name: "Lien / LOP request", keywords: ["lien", "lop", "letter of protection"], requireAction: true },
    { id: "rb", name: "R&B / Report & Bill requested", keywords: ["r&b", "r & b", "r and b", "report and bill", "reports and bills"] },
    { id: "medicals", name: "Medicals requested", keywords: ["medical records", "medicals", "records request"] },
    { id: "specialist", name: "Specialist/imaging reply", keywords: ["mri", "x-ray", "x-rays", "xray", "xrays", "ct scan", "emg", "ncv", "radiology", "imaging"], requireReport: true },
    { id: "bounced", name: "Bounced email", keywords: ["mailer-daemon", "postmaster", "undeliverable", "delivery status notification", "mail delivery failed", "returned mail"], matchFrom: true },
    { id: "other", name: "Other", keywords: [] },
  ];
}

export function resolveMailBuckets(saved: MailBucket[] | null | undefined): MailBucket[] {
  return saved?.length ? saved : defaultMailBuckets();
}

export function normalizeMailBuckets(value: unknown): MailBucket[] | null {
  if (!Array.isArray(value)) return null;
  const buckets: MailBucket[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<MailBucket>;
    const id = typeof item.id === "string" ? item.id.trim().toLowerCase() : "";
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 80) : "";
    if (!BUCKET_ID.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    const keywords = Array.isArray(item.keywords)
      ? item.keywords.filter((word): word is string => typeof word === "string").map((word) => word.trim().toLowerCase()).filter(Boolean).slice(0, 40)
      : [];
    buckets.push({
      id,
      name,
      keywords,
      ...(item.matchFrom === true ? { matchFrom: true } : {}),
      ...(item.requireAction === true ? { requireAction: true } : {}),
      ...(item.requireReport === true ? { requireReport: true } : {}),
    });
  }
  return buckets.length ? buckets : null;
}

function keywordHit(text: string, keyword: string): boolean {
  const cleaned = keyword.trim().toLowerCase();
  if (!cleaned) return false;
  const pattern = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\s+/g, "\\s+").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${pattern}(?:[^a-z0-9]|$)`, "i").test(text);
}

function bucketMatches(bucket: MailBucket, text: string, from: string): boolean {
  if (bucket.id === "other" || !bucket.keywords.length) return false;
  const hay = bucket.matchFrom ? `${from}\n${text}` : text;
  if (!bucket.keywords.some((keyword) => keywordHit(hay, keyword))) return false;
  if (bucket.requireAction && !ACTION.test(text)) return false;
  if (bucket.requireReport && !/\b(report|results?|findings?|impression|attached|enclosed)\b/i.test(text)) return false;
  return true;
}

/** Bucket ids this message fits. Bounced wins by itself. */
export function matchMailBuckets(text: string, from: string, buckets: MailBucket[]): string[] {
  const bounced = buckets.find((bucket) => bucket.id === "bounced");
  if (bounced && bucketMatches(bounced, text, from)) return ["bounced"];
  return buckets.filter((bucket) => bucket.id !== "bounced" && bucketMatches(bucket, text, from)).map((bucket) => bucket.id);
}

function bucketDisplayName(bucket: MailBucket | undefined, claim: ClaimDocument): string {
  if (!bucket) return "Other";
  const original = defaultMailBuckets().find((item) => item.id === bucket.id);
  if (original && original.name === bucket.name && (bucket.id === "new-patient" || bucket.id === "lien" || bucket.id === "rb" || bucket.id === "medicals" || bucket.id === "specialist" || bucket.id === "bounced" || bucket.id === "other")) {
    return mailCategoryLabel(bucket.id, claim);
  }
  return bucket.name;
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
  buckets?: MailBucket[] | null;
}): GoatMailRow[] {
  const decisions = new Map((input.decisions ?? []).map((row) => [row.id, row]));
  const buckets = resolveMailBuckets(input.buckets);
  const rows: GoatMailRow[] = [];
  for (const message of input.messages) {
    const decision = decisions.get(message.id);
    if (decision?.resolved) continue;
    const text = readable(message.body);
    const found = new Set(matchMailBuckets(readable(`${message.subject}\n${message.body}`).replace(/\s+/g, " "), message.from, buckets));
    const fill = quickFillFromText(text, { todayIso: input.todayIso });
    const fromSubject = referralNameFromSubject(message.subject);
    if (fromSubject && !found.has("bounced")) found.add("new-patient");
    if (fromSubject && isObviouslyBadPatientName(fill.firstName ?? "", fill.lastName ?? "")) {
      fill.firstName = fromSubject.firstName;
      fill.lastName = fromSubject.lastName;
    }
    const chosen = decision?.category;
    const conflict = !chosen && found.size > 1 && !found.has("bounced");
    let category: GoatMailCategory = chosen ?? (found.size === 1 ? [...found][0] : "other");
    if (conflict) category = "other";
    const severalPassengers = multiPassenger(message.body);
    const unclearName = nameUnclear(fill);
    const named = Boolean(fill.firstName && fill.lastName);
    const badName = named && isObviouslyBadPatientName(fill.firstName ?? "", fill.lastName ?? "");
    const linked = named && !badName
      ? matchExistingMailPatient(input.patients, {
          firstName: fill.firstName ?? "",
          lastName: fill.lastName ?? "",
          phone: fill.phone,
          dob: fill.dob,
        })
      : undefined;
    const live = input.patients.filter((patient) => !patient.deleted && named && !badName && sameName(patient, fill.firstName ?? "", fill.lastName ?? ""));
    const newDol = duplicateDateIso(fill.dateOfLoss);
    const duplicate = named
      ? findDuplicateCases(live, { firstName: fill.firstName ?? "", lastName: fill.lastName ?? "", dateOfLoss: fill.dateOfLoss })
      : [];
    const secondCrash = named && Boolean(newDol) && live.some((patient) => {
      const existing = duplicateDateIso(patient.dateOfLoss);
      return Boolean(existing) && existing !== newDol;
    });
    const blankExisting = named && live.some((patient) => !duplicateDateIso(patient.dateOfLoss));
    const needsName = category === "new-patient" && (!named || unclearName || badName);
    const needsWho = category === "new-patient" && named && live.length > 1 && !secondCrash && duplicate.length === 0;
    const needsCrash = category === "new-patient" && blankExisting && !secondCrash && duplicate.length === 0;
    const needsAnswer = conflict || needsName || needsWho || needsCrash || (severalPassengers && patientLineCount(message.body) >= 2 && !chosen);
    let question = "";
    let choices: GoatMailChoice[] = [];
    if (conflict) {
      question = "Which is this?";
      choices = [...found].map((id) => ({ id, label: bucketDisplayName(buckets.find((bucket) => bucket.id === id), input.claimDocument) }));
    } else if (needsName) {
      question = unclearName ? "Which last name should G.O.A.T. use?" : "Who is the new patient?";
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
      !badName &&
      !linked &&
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
      label: needsAnswer && conflict ? "Needs your answer" : bucketDisplayName(buckets.find((bucket) => bucket.id === category), input.claimDocument),
      subject: message.subject || "(no subject)",
      from: message.from,
      receivedAt: message.receivedAt,
      flags,
      missing,
      needsAnswer,
      question,
      choices,
      patientId: decision?.patientId ?? duplicate[0]?.id ?? linked?.id,
      create: canCreate,
      referral: category === "new-patient"
        ? {
            firstName: fill.firstName ?? "",
            lastName: fill.lastName ?? "",
            phone: fill.phone,
            dob: fill.dob,
            dateOfLoss: fill.dateOfLoss ?? "",
            attorney: fill.attorney,
            from: message.from,
          }
        : undefined,
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
      ...(typeof row.category === "string" && BUCKET_ID.test(row.category) ? { category: row.category } : {}),
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
