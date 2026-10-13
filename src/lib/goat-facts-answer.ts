/**
 * Quick plain answers from file facts (regular G.O.A.T., no AI):
 *  - imaging: "when was the xray and what did it show"
 *  - a specialist's visit with ROM / recommendations: "when was the pm appt, rom and recs"
 * and splitting two-part questions.
 */
import type { GoatAnswer, GoatContext } from "@/lib/goat";
import type { FileFacts } from "@/lib/goat-facts";
import { findReferralFacts, SPECIALTIES } from "@/lib/goat-referrals";
import { sortByRegion } from "@/lib/goat-region-order";
import { groupsInQuestion } from "@/lib/goat-terms";

const firstName = (p: string) => {
  const s = (p ?? "").trim();
  const w = s.includes(",") ? s.split(",")[1].trim().split(/\s+/)[0] : s.split(/\s+/)[0];
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : "The patient";
};
const isoToMdy = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (d ?? "").trim();
};
const MOD: Array<{ key: "xray" | "mri" | "ct"; label: string; ask: RegExp; box: RegExp }> = [
  { key: "xray", label: "X-ray", ask: /\b(x[\s-]?rays?|xrs?|radiographs?)\b/i, box: /x/i },
  { key: "mri", label: "MRI", ask: /\bmris?\b/i, box: /mri/i },
  { key: "ct", label: "CT", ask: /\bct\b|\bcat scan\b/i, box: /^ct/i },
];

/** "When was the X-ray and what did it show?" */
export function imagingFactsAnswer(ctx: GoatContext, question: string, facts: FileFacts[]): GoatAnswer | null {
  const mod = MOD.find((m) => m.ask.test(question));
  if (!mod) return null;
  const asksWhen = /\b(when|date|day)\b/i.test(question);
  const asksFind = /\b(find\w*|show\w*|impression\w*|result\w*|read|say|said|reveal\w*|reports?)\b/i.test(question);
  if (!asksWhen && !asksFind) return null;
  const files = facts.filter((f) => f.docType === mod.key).sort((a, b) => (b.mainDate > a.mainDate ? 1 : -1));
  const box = ctx.imaging.filter((i) => mod.box.test(i.modality) && !i.refused);
  if (!files.length && !box.length) return null;
  const who = firstName(ctx.patientName);
  const lines: string[] = [];
  const sources: Array<{ fileId: string; name: string }> = [];
  if (files.length) {
    for (const f of files.slice(0, 2)) {
      const region = f.regions.filter((r) => /Cervical|Thoracic|Lumbar|Shoulder|Knee|Hip|Wrist/.test(r)).join(", ");
      const b = box.find((x) => x.doneDate && isoToMdy(x.doneDate) === f.mainDate) ?? box[0];
      const date = f.mainDate || (b?.doneDate ? isoToMdy(b.doneDate) : "");
      lines.push(`${who}'s ${region ? `${region} ` : ""}${mod.label} was ${date ? `done on ${date}` : "done (no date found in the report)"}.`);
      const imp = f.impressions.length ? f.impressions : f.findings;
      if (asksFind || !asksWhen) lines.push(imp.length ? `It showed: ${sortByRegion(imp.slice(0, 5), (x) => x, ctx.recFormat?.regionOrder).join("; ")}.` : "I didn't find an impression or findings section in the report.");
      sources.push({ fileId: f.fileId, name: f.fileName });
    }
  } else {
    for (const b of box.slice(0, 2)) {
      const date = isoToMdy(b.doneDate) || "";
      lines.push(`${who}'s ${b.regions.join(", ")} ${mod.label} ${date ? `was done on ${date}` : b.scheduledDate ? `is scheduled for ${isoToMdy(b.scheduledDate)}` : "hasn't been done yet"}${b.center ? ` at ${b.center}` : ""}.`);
      if (asksFind || !asksWhen) lines.push(b.findings.trim() ? `Findings: ${b.findings.trim()}` : "No findings entered yet, and no report file was found.");
    }
  }
  return {
    title: `${mod.label}`,
    lines,
    source: sources.length ? `Patient Files — ${sources.map((s) => s.name).join(", ")}` : `${mod.label} panel`,
    section: mod.key === "xray" ? "xray" : "mri",
    fileId: sources[0]?.fileId,
    sources: sources.length ? sources : undefined,
  };
}

/** The specialist asked about (specialty, term group, or name) and that doctor's report facts. */
export function specialistReports(ctx: GoatContext, question: string, facts: FileFacts[]): { label: string; doctor: string; reports: FileFacts[] } | null {
  const groupText = groupsInQuestion(question, ctx.termGroups ?? []).map((g) => g.terms.join(" ")).join(" ");
  const spec = SPECIALTIES.find((s) => s.ask.test(question) || (groupText && s.ask.test(groupText)));
  const people = ctx.people ?? [];
  const last = (n: string) => n.replace(/\b(dr|md|do)\b\.?/gi, " ").split(/[^A-Za-z'-]+/).filter((w) => w.length >= 4).pop()?.toLowerCase() ?? "";
  // Doctors come from the reports themselves (file name / Provider line); Contacts only confirm their specialty.
  const all = facts.filter((f) => f.docType === "specialist report" && f.doctor);
  const contactOf = (d: string) => people.find((p) => last(p.name) && last(p.name) === last(d));
  const q = question.toLowerCase();
  let reports = all.filter((f) => last(f.doctor) && (q.includes(last(f.doctor)) || groupText.toLowerCase().includes(last(f.doctor))));
  if (!reports.length && spec) {
    reports = all.filter((f) => spec.match.test(contactOf(f.doctor)?.specialty ?? "") || f.specialty === spec.label);
    if (!reports.length) {
      const docs = [...new Set(all.map((f) => f.doctor))];
      if (docs.length === 1 && !(contactOf(docs[0])?.specialty ?? "").trim()) reports = all;
    }
  }
  if (!spec && !reports.length) return null;
  const doc = reports[0]?.doctor ?? "";
  return { label: spec?.label ?? contactOf(doc)?.specialty?.toLowerCase() ?? "", doctor: doc, reports: reports.sort((a, b) => (a.mainDate < b.mainDate ? 1 : -1)) };
}

/** "When was the PM appt, what was the ROM and recs?" — date + ROM + recommendations from the report. */
export function specialistVisitFactsAnswer(ctx: GoatContext, question: string, facts: FileFacts[]): GoatAnswer | null {
  const asksWhen = /\b(when|date|appt|appointment|visit|seen|go|went)\b/i.test(question);
  const asksRom = /\brom\b|range of motion/i.test(question);
  const asksRecs = /\b(recs?|recommend\w*|plan)\b/i.test(question);
  if (!(asksWhen && (asksRom || asksRecs)) && !(asksRom && !/\b(our|my|chiro|today|encounter)\b/i.test(question) && /\b(pm|pain|ortho|neuro|dr\.?)\b/i.test(question))) return null;
  const sr = specialistReports(ctx, question, facts);
  if (!sr || !sr.reports.length) return null;
  const r = sr.reports[0];
  const who = firstName(ctx.patientName);
  const doc = sr.doctor || r.doctor;
  const to = [sr.label, doc ? `(${doc})` : ""].filter(Boolean).join(" ") || "the specialist";
  // Referral date: the Specialist box, else the referral file to the same doctor ("Date of Referral").
  const ref = findReferralFacts(ctx, /\brefer/i.test(question) ? question : `when was ${who} referred to ${sr.label || "the specialist"} and when seen`);
  const lastName = (doc.replace(/\b(dr|md|do)\b\.?/gi, " ").split(/[^A-Za-z'-]+/).filter((w) => w.length >= 4).pop() ?? "").toLowerCase();
  const refFile = facts.find((f) => f.docType === "referral" && lastName.length >= 4 && (f.fileName.toLowerCase().includes(lastName) || f.doctor.toLowerCase().includes(lastName)) && f.dates.some((d) => d.label === "referral"));
  const referredOn = ref?.referredOn || refFile?.dates.find((d) => d.label === "referral")?.date || "";
  const asksReferral = /\brefer/i.test(question);
  const lines = [
    referredOn
      ? `${who} was referred to ${to} on ${referredOn} and was seen on ${r.mainDate || "a date I couldn't find in the report"}.`
      : `${who} saw ${to} on ${r.mainDate || "an undated visit"}.${asksReferral ? " I didn't find the referral date." : ""}`,
  ];
  const groups = [] as NonNullable<GoatAnswer["groups"]>;
  const order = ctx.recFormat?.regionOrder;
  if (asksRom) groups.push({ lead: "Range of motion", blocks: [{ heading: "", items: r.rom.length ? sortByRegion(r.rom, (x) => x, order) : ["Not found in the report."], plain: true }] });
  if (asksRecs) {
    const recs = [...r.recommendations, ...r.procedures.filter((p) => !r.recommendations.includes(p)), ...r.followUp.filter((p) => !r.recommendations.includes(p))];
    groups.push({ lead: "Recommendations", blocks: [{ heading: "", items: recs.length ? (recs.every((x) => /\b(cervical|thoracic|lumbar|shoulder|knee|hip|elbow|wrist|hand|ankle|foot|neck|back)\b/i.test(x)) ? sortByRegion(recs.slice(0, 12), (x) => x, order) : recs.slice(0, 12)) : ["Not found in the report."], plain: true }] });
  }
  return {
    title: "Specialist visit",
    lines,
    groups,
    source: `Patient Files — ${r.fileName}`,
    section: "specialist",
    fileId: r.fileId,
    sources: [...(refFile ? [{ fileId: refFile.fileId, name: refFile.fileName }] : ref?.referralFile ? [ref.referralFile] : []), { fileId: r.fileId, name: r.fileName }],
    copyText: [lines[0], ...groups.flatMap((g) => [g.lead + ":", ...g.blocks.flatMap((b) => b.items.map((i) => `- ${i}`))])].join("\n"),
  };
}

/** "when was the last visit and what's the balance?" → two questions. Single questions come back as one. */
export function splitQuestion(question: string): string[] {
  const parts = question
    .split(/\?\s+(?=\S)|\s*;\s*|\s+(?:and|also|plus)\s+(?=(?:when|what|what's|whats|where|who|how|did|does|do|is|was|has|have|show|list|any|tell)\b)/i)
    .map((p) => p.trim().replace(/\?$/, ""))
    .filter((p) => p.split(/\s+/).length >= 2);
  // "when was the xray and what did it show": the second part leans on the first, so it's one question.
  if (parts.slice(1).some((p) => /\b(it|that|this|they|those|them|he|she|him|her|his|there|then)\b/i.test(p) && !/\b(x[\s-]?ray|xr|mri|ct|visit|appointment|appt|bill|balance|referr\w*|dr\.?|doctor|pm|ortho)\b/i.test(p))) return [question];
  return parts.length > 1 ? parts : [question];
}
