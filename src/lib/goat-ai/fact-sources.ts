/**
 * What + mode reads: the compact patient timeline plus the facts of the files that
 * matter for the question (not raw report excerpts). Pure; all local.
 */
import type { GoatContext } from "@/lib/goat";
import { factFieldsFor, factsForPrompt, type FileFacts } from "@/lib/goat-facts";
import { factsForFiles } from "@/lib/goat-facts-store";
import { findReferralFacts, referralFactLines, SPECIALTIES } from "@/lib/goat-referrals";
import { buildTimeline, compactTimeline } from "@/lib/goat-timeline";
import type { AiSource } from "@/lib/goat-ai/sources";

/** Files ranked for the question: doc type, specialty, doctor or file-name words. */
export function relevantFacts(question: string, facts: FileFacts[], max = 3): FileFacts[] {
  const q = question.toLowerCase();
  const spec = SPECIALTIES.find((s) => s.ask.test(question));
  const score = (f: FileFacts) => {
    let s = 0;
    if (/x[\s-]?ray|\bxr\b|radiograph/.test(q) && f.docType === "xray") s += 5;
    if (/\bmri\b/.test(q) && f.docType === "mri") s += 5;
    if (/\bct\b/.test(q) && f.docType === "ct") s += 5;
    if (/referr/.test(q) && f.docType === "referral") s += 3;
    if (spec && f.specialty === spec.label) s += 4;
    const last = f.doctor.split(/\s+/).pop()?.toLowerCase() ?? "";
    if (last.length >= 4 && q.includes(last)) s += 5;
    if (/recommend|recs?\b|rom\b|range of motion|plan|inject/.test(q) && f.docType === "specialist report") s += 2;
    return s;
  };
  const ranked = facts.map((f) => ({ f, s: score(f) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || (a.f.mainDate < b.f.mainDate ? 1 : -1));
  return (ranked.length ? ranked.map((x) => x.f) : facts.filter((f) => f.docType !== "bill")).slice(0, max);
}

/** Sources for the + mode prompt: S1 timeline, then referral facts, then the relevant files' facts, then page sections (non-file). */
export function buildFactSources(ctx: GoatContext, question: string, pageSources: AiSource[]): AiSource[] {
  const facts = factsForFiles(ctx.files);
  const out: AiSource[] = [];
  const id = () => `S${out.length + 1}`;
  const timeline = compactTimeline(buildTimeline(ctx, facts));
  if (timeline) out.push({ id: id(), title: "Patient timeline", kind: "page", section: "appointments", lines: timeline.split("\n").map((text) => ({ text })) });
  const ref = findReferralFacts(ctx, question);
  if (ref) out.push({ id: id(), title: "Referral & visit dates", kind: "page", section: "specialist", lines: referralFactLines(ref).map((text) => ({ text })) });
  const fields = factFieldsFor(question);
  for (const f of relevantFacts(question, facts)) {
    out.push({ id: id(), title: f.fileName, kind: "file", fileId: f.fileId, docType: f.docType === "referral" ? "referral" : f.docType === "specialist report" ? "report" : "other", date: f.mainDate || undefined, dateLabel: f.mainDate ? "dated" : undefined, who: f.doctor ? [f.doctor] : [], section: f.docType === "xray" ? "xray" : f.docType === "mri" || f.docType === "ct" ? "mri" : "specialist", lines: factsForPrompt(f, fields).split("\n").map((text) => ({ text: text.trim() })) });
  }
  for (const s of pageSources) if (s.kind === "page" && !out.some((o) => o.title === s.title)) out.push({ ...s, id: id() });
  return out.slice(0, 8);
}
