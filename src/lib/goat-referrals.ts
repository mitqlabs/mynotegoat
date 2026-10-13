/**
 * Referral / specialist-visit dates for G.O.A.T. (rules, no AI needed).
 *
 * "When was Karen referred to PM and when did she go?" →
 * "Karen was referred to pain management (Dr. Jane Doe) on 01/20/2026 and was seen on 02/25/2026."
 *
 * Specialist box dates win; otherwise the dates are read from the files:
 *  - referral files ("referral" in the name): "Date of Referral", "Referral Date", "Referred on" …
 *  - report / consult files: "Consultation Visit", "Date of Service/Visit/Exam", "DOS" …
 * The doctor is matched by specialty (term groups + Contacts) or by name.
 */
import type { GoatContext, GoatSpecialist } from "@/lib/goat";
import type { GoatFile, GoatPerson } from "@/lib/goat-docs";
import { groupsInQuestion } from "@/lib/goat-terms";

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_SRC = `(\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4})`;

const REFERRAL_LABEL = /(?:date\s+of\s+referral|referral\s+date|date\s+referred|referred\s+on|referral\s+sent(?:\s+on)?)/;
const VISIT_LABEL = /(?:consultation\s+visit|consultation\s+date|date\s+of\s+(?:service|visit|consultation|consult|exam(?:ination)?|evaluation)|visit\s+date|exam\s+date|date\s+seen|seen\s+on|\bDOS\b)/;

/** Specialties people ask about by short name. */
export const SPECIALTIES: Array<{ label: string; ask: RegExp; match: RegExp }> = [
  { label: "pain management", ask: /\b(pm|pain\s*(?:management|mgmt|mgt|doc(?:tor)?|specialist)|pain\s+med\w*)\b/i, match: /\b(pain|pm|interventional|anesthesi\w*|physiatr\w*)\b/i },
  { label: "orthopedics", ask: /\b(ortho\w*)\b/i, match: /\bortho\w*/i },
  { label: "neurology", ask: /\b(neuro\w*)\b/i, match: /\bneuro\w*/i },
  { label: "neurosurgery", ask: /\b(neurosurg\w*|spine\s+surg\w*)\b/i, match: /\b(neurosurg\w*|spine\s+surg\w*)/i },
  { label: "physical therapy", ask: /\b(pt|physical\s+therap\w*)\b/i, match: /\b(pt|physical\s+therap\w*)\b/i },
];

export function toMDY(raw: string): string {
  const s = raw.trim();
  const num = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (num) {
    let y = Number(num[3]);
    if (y < 100) y += 2000;
    return `${pad(Number(num[1]))}/${pad(Number(num[2]))}/${y}`;
  }
  const m = new RegExp(`^(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i").exec(s);
  if (m) {
    const key = m[1].toLowerCase() === "sept" ? "sep" : m[1].toLowerCase();
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(key) + 1;
    return `${pad(month)}/${pad(Number(m[2]))}/${m[3]}`;
  }
  return s;
}

/** First date written right after one of the labels (within ~80 characters, may cross a line). */
export function dateAfterLabel(text: string, label: RegExp): string {
  const re = new RegExp(`${label.source}[\\s\\S]{0,80}?${DATE_SRC}`, "i");
  const m = re.exec(text ?? "");
  return m ? toMDY(m[1]) : "";
}

export const referralDateIn = (text: string) => dateAfterLabel(text, REFERRAL_LABEL);
export const visitDateIn = (text: string) => dateAfterLabel(text, VISIT_LABEL);

export const isReferralFile = (f: Pick<GoatFile, "name">) => /referr?al|referred/i.test(f.name);
export const isReportFile = (f: Pick<GoatFile, "name">) => !isReferralFile(f) && /report|consult|eval|visit|follow[\s_-]?up|f\/u|note/i.test(f.name);

/** Asking when someone was referred / went to / was seen by a specialist. */
export function isReferralWhenQuestion(q: string): boolean {
  const t = q.toLowerCase();
  const when = /\b(when|what\s+date|which\s+date|date)\b/.test(t);
  const refer = /\brefer\w*/.test(t);
  const went = /\b(go|goes|went|gone|seen|see|saw|visit\w*|consult\w*|appointment|appt)\b/.test(t);
  return when && (refer || went);
}

const nameWords = (name: string) =>
  name.replace(/\b(dr|md|do|dc|np|pa|mr|mrs|ms)\b\.?/gi, " ").split(/[^a-z'-]+/i).filter((w) => w.length >= 4);

/** Some 5+ letter part of the name (usually the last name) appears in the text. */
const mentions = (hay: string, name: string) => {
  const h = hay.toLowerCase();
  return nameWords(name).some((w) => w.length >= 5 && h.includes(w.toLowerCase()));
};

const firstName = (patientName: string) => {
  const p = (patientName ?? "").trim();
  if (!p) return "The patient";
  const part = p.includes(",") ? p.split(",")[1].trim().split(/\s+/)[0] : p.split(/\s+/)[0];
  return part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : "The patient";
};

const titleName = (name: string) => {
  const n = name.trim().replace(/\s+/g, " ");
  const cased = n === n.toUpperCase() ? n.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : n;
  return /^dr\.?\s/i.test(cased) ? cased.replace(/^dr\.?\s/i, "Dr. ") : `Dr. ${cased}`;
};

export interface ReferralFacts {
  patient: string;
  specialty: string;
  doctor: string;
  referredOn: string;
  seenOn: string;
  scheduledFor: string;
  referralFile?: { fileId: string; name: string };
  visitFile?: { fileId: string; name: string };
  fromBox: boolean;
}

/** Doctor named in a file name like "Specialist Report - DR. JANE DOE.pdf". */
const doctorFromFileName = (name: string) => {
  const m = /\bdr\.?\s+([a-z' -]+?)(?:\.\w+)?$/i.exec(name.replace(/\.(pdf|docx?|txt|png|jpe?g)$/i, ""));
  return m ? `Dr. ${m[1].trim()}` : "";
};

export function findReferralFacts(ctx: Pick<GoatContext, "patientName" | "specialists" | "files" | "people" | "termGroups">, question: string): ReferralFacts | null {
  if (!isReferralWhenQuestion(question)) return null;
  const q = question;
  const people: GoatPerson[] = ctx.people ?? [];
  const groups = groupsInQuestion(q, ctx.termGroups ?? []);
  const groupText = groups.map((g) => g.terms.join(" ")).join(" ");
  const asked = SPECIALTIES.find((s) => s.ask.test(q) || (groupText && s.ask.test(groupText)));

  // Who: a named person, a person in a matching term group, or a contact with the asked specialty.
  let doctors = people.filter((p) => mentions(q, p.name) || (groupText && mentions(groupText, p.name)));
  if (!doctors.length && asked) doctors = people.filter((p) => asked.match.test(p.specialty ?? ""));
  const specificAsk = !!asked || doctors.length > 0 || /\bspecialist\b/i.test(q);
  if (!specificAsk) return null;

  // Specialist box first.
  const box: GoatSpecialist | undefined = ctx.specialists.find(
    (s) => s.name.trim() && (doctors.some((d) => mentions(s.name, d.name) || mentions(d.name, s.name)) || mentions(q, s.name) || (asked ? asked.match.test(s.name) : false)),
  ) ?? (!asked && !doctors.length ? ctx.specialists.find((s) => s.sentDate || s.completedDate) : undefined);

  const files = (ctx.files ?? []).filter((f) => f.pages && f.pages.length);
  const textOf = (f: GoatFile) => (f.pages ?? []).join("\n");
  const aboutDoctor = (f: GoatFile) => {
    if (doctors.length) return doctors.some((d) => mentions(f.name, d.name) || mentions(textOf(f).slice(0, 4000), d.name));
    if (asked) return asked.match.test(f.name) || asked.ask.test(textOf(f));
    return true;
  };
  const refFiles = files.filter((f) => isReferralFile(f) && aboutDoctor(f));
  const repFiles = files.filter((f) => isReportFile(f) && aboutDoctor(f));

  let referredOn = box?.sentDate ?? "";
  let seenOn = box?.completedDate ?? "";
  const scheduledFor = !seenOn ? box?.scheduledDate ?? "" : "";
  let referralFile: ReferralFacts["referralFile"];
  let visitFile: ReferralFacts["visitFile"];
  if (!referredOn) {
    for (const f of refFiles) {
      const d = referralDateIn(textOf(f));
      if (d) { referredOn = d; referralFile = { fileId: f.id, name: f.name }; break; }
    }
  }
  if (!seenOn) {
    for (const f of repFiles) {
      const d = visitDateIn(textOf(f));
      if (d) { seenOn = d; visitFile = { fileId: f.id, name: f.name }; break; }
    }
  }
  if (!referredOn && !seenOn && !scheduledFor) return null;

  const fileDoc = doctorFromFileName((referralFile ?? visitFile)?.name ?? "");
  const doctorRaw = doctors[0]?.name || box?.name || fileDoc;
  const specialty = asked?.label || doctors[0]?.specialty?.toLowerCase() || "";
  return {
    patient: firstName(ctx.patientName),
    specialty,
    doctor: doctorRaw ? titleName(doctorRaw) : "",
    referredOn,
    seenOn,
    scheduledFor,
    referralFile,
    visitFile,
    fromBox: !!box && !!(box.sentDate || box.completedDate || box.scheduledDate),
  };
}

/** One plain sentence. */
export function referralSentence(f: ReferralFacts): string {
  const to = [f.specialty, f.doctor ? (f.specialty ? `(${f.doctor})` : f.doctor) : ""].filter(Boolean).join(" ") || "the specialist";
  const parts: string[] = [];
  if (f.referredOn) parts.push(`${f.patient} was referred to ${to} on ${f.referredOn}`);
  if (f.seenOn) parts.push(f.referredOn ? `was seen on ${f.seenOn}` : `${f.patient} was seen by ${to} on ${f.seenOn}`);
  else if (f.scheduledFor) parts.push(f.referredOn ? `is scheduled for ${f.scheduledFor}` : `${f.patient} is scheduled with ${to} for ${f.scheduledFor}`);
  let s = parts.join(" and ") + ".";
  if (!f.referredOn) s += " I didn't find the referral date.";
  else if (!f.seenOn && !f.scheduledFor) s += " I didn't find a visit date yet.";
  return s;
}

/** Facts as short lines for the + mode prompt. */
export function referralFactLines(f: ReferralFacts): string[] {
  return [
    `Referral to ${f.specialty || "specialist"}${f.doctor ? ` (${f.doctor})` : ""}.`,
    f.referredOn ? `Referred on ${f.referredOn}${f.referralFile ? ` (from ${f.referralFile.name})` : " (Specialist box)"}.` : "Referral date not found.",
    f.seenOn ? `Seen on ${f.seenOn}${f.visitFile ? ` (from ${f.visitFile.name})` : " (Specialist box)"}.` : f.scheduledFor ? `Scheduled for ${f.scheduledFor}.` : "Visit date not found.",
  ];
}
