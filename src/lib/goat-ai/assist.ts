"use client";

/**
 * G.O.A.T. with Smart mode (beta): ONE answer, in the regular G.O.A.T. format.
 *
 * The rules answer first, exactly as without Smart mode. Smart mode then only
 * fills gaps:
 *  - Recommendations: the in-browser model reads the chosen report's FULL
 *    text (Plan / Recommendations / Assessment first, chunked to fit) and
 *    lists what the doctor recommends however it's worded; every item is
 *    checked against the report, merged with the rules' items (duplicates
 *    dropped) and rendered in the regular format (regions → Alternatives →
 *    Medications → Follow up → Costs when shown), with Copy.
 *  - Nothing answered by the rules: the model answers from the best-matching
 *    parts of the file, shown as a regular answer card.
 * When the model is ready it always writes the final answer (rules answers + file facts are its input).
 * Everything runs in this browser; nothing is sent anywhere.
 */

import { askGoat, type GoatAnswer, type GoatContext, type GoatResult } from "@/lib/goat";
import type { GoatAnswerPrefs } from "@/lib/goat-answer-prefs";
import { extractRecommendations, recommendationBlocksFrom, recommendationsText } from "@/lib/goat-recs";
import { answerSmart } from "@/lib/goat-ai/answer";
import { runGoatAi } from "@/lib/goat-ai/engine";
import { NOT_FOUND } from "@/lib/goat-ai/prompt";
import { buildRecsMessages, mergeRecs, parseRecsJson, recsFromAi, type AiRecsJson } from "@/lib/goat-ai/recs-ai";
import { chunkReport, chunkText, pickReport } from "@/lib/goat-ai/report-text";
import { detectIntents } from "@/lib/goat-ai/sources";

/** Characters of report text per model pass (4,096-token context: instructions + example + reply fit around it). */
export const REPORT_CHUNK_CHARS = 7000;
/** At most this many passes over one report (Plan first; later parts only when they have recommendation wording). */
export const MAX_REPORT_PASSES = 3;

/** Clearly asking for a doctor's recommendations (not "plan" or "follow up" alone). */
export const RECS_ASK_RE = /\b(recommend\w*|recs?|recos?|reccs?|suggest\w*|advis\w*|orders?|planned interventions?|next steps?|treatment options?|alternatives?)\b/i;

export interface AssistedAnswer {
  result: GoatResult;
  /** The model added to or wrote the answer. */
  smartUsed: boolean;
  warnings: string[];
  ms: number;
}

export async function assistGoat(input: {
  context: GoatContext;
  question: string;
  prefs: GoatAnswerPrefs;
  previous?: { question: string; answer: string } | null;
  /** Short progress text ("Reading Premier_Pain….pdf…"). */
  onStatus?: (status: string) => void;
  /** Streaming text for a free answer (no rules answer). */
  onText?: (text: string) => void;
}): Promise<AssistedAnswer> {
  const t0 = performance.now();
  const base = askGoat(input.context, input.question);
  const intents = detectIntents(input.question);
  const done = (result: GoatResult, smartUsed: boolean, warnings: string[] = []): AssistedAnswer => ({ result, smartUsed, warnings, ms: performance.now() - t0 });

  const ruleRecs = base.answers.find((a) => a.title === "Recommendations");
  // A doctor's recommendations: + mode reads the whole report and fills what the rules missed.
  // Any other question the rules answered (visits, dates, plan, billing …) is answered by the rules alone.
  if (intents.includes("recommend") && (ruleRecs || RECS_ASK_RE.test(input.question))) {
    const ruleAnswer = ruleRecs;
    const ruleFile = ruleAnswer ? (input.context.files ?? []).find((f) => ruleAnswer.source.includes(f.name)) : undefined;
    const pick = pickReport(input.context, input.question, ruleFile?.id);
    if (!pick) return done(base, false);
    const report = (pick.file.pages ?? []).join("\n");
    const chunks = chunkReport(pick.file, REPORT_CHUNK_CHARS)
      .filter((c, i) => i === 0 || c.signal >= 3)
      .slice(0, MAX_REPORT_PASSES);
    const parts: AiRecsJson[] = [];
    for (const [i, c] of chunks.entries()) {
      input.onStatus?.(`Reading ${pick.file.name}${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ""}…`);
      const run = await runGoatAi(buildRecsMessages(pick.file.name, chunkText(c), { n: i + 1, of: chunks.length }), () => undefined, { maxTokens: 700 });
      const j = parseRecsJson(run.text);
      if (j) parts.push(j);
    }
    const ai = recsFromAi(parts, report);
    const merged = mergeRecs(ai.recs, extractRecommendations(report));
    const blocks = recommendationBlocksFrom(merged, { showCosts: input.prefs.showCosts, regionOrder: input.prefs.regionOrder });
    if (!blocks.length) return done(base, false);
    const notes = [
      pick.how === "best guess" ? "No doctor was named, so this is from the report most likely to have a plan." : "",
      pick.others.length ? `Also on file: ${pick.others.join("; ")}.` : "",
    ].filter(Boolean);
    const answer: GoatAnswer = {
      title: "Recommendations",
      lines: [],
      groups: [{ lead: `${pick.who.length ? `${pick.who.join(" / ")} — ` : ""}${pick.file.name}`, blocks: blocks.map((b) => ({ ...b, plain: true })), note: notes.join(" ") || undefined }],
      source: `Patient Files — ${pick.file.name} (${pick.dateLabel} ${pick.date || "—"}) · read in full by + mode`,
      section: "specialist",
      copyText: recommendationsText(blocks),
      fileId: pick.file.id,
    };
    const warnings = ai.dropped.length ? [`+ mode left out ${ai.dropped.length} item${ai.dropped.length === 1 ? "" : "s"} it couldn't find written in the report.`] : [];
    return done(
      {
        ...base,
        // One answer: the Smart-filled recommendations replace the rules' version (and the referral status card).
        answers: [answer, ...base.answers.filter((a) => a.title !== "Recommendations" && a.section !== "specialist")],
        filesFirst: false,
      },
      parts.length > 0,
      warnings,
    );
  }

  // + mode writes the final answer every time. The basic lookup's answers and the file facts are its
  // input; the basic answer is only the fallback when the model finds nothing or fails.
  let smart: Awaited<ReturnType<typeof answerSmart>>;
  try {
    smart = await answerSmart({ context: input.context, question: input.question, prefs: input.prefs, previous: input.previous, onText: input.onText, ruleAnswers: base.answers });
  } catch (e) {
    console.error("[goat+] + mode failed; showing the basic lookup", e);
    return done(base, false, ["+ mode couldn't answer this time, so this is the basic lookup."]);
  }
  if (smart.skipped || smart.text.startsWith(NOT_FOUND)) return done(base, false);
  const ruleLinks = base.answers.flatMap((a) => a.sources ?? (a.fileId ? [{ fileId: a.fileId, name: a.source.replace(/^Patient Files — /, "") }] : []));
  const files = smart.retrieval.sources.filter((s) => s.kind === "file");
  const answer: GoatAnswer = {
    title: "Answer",
    lines: smart.text.split("\n").filter((l) => l.trim()),
    source: files.length ? `Patient Files — ${[...new Set(files.map((f) => f.title))].join(", ")} · + mode` : "Patient page · + mode",
    section: smart.retrieval.sources[0]?.section ?? "specialist",
    copyText: smart.text,
    fileId: files[0]?.fileId ?? ruleLinks[0]?.fileId,
    sources: ruleLinks.length ? ruleLinks.filter((l, i, all) => all.findIndex((x) => x.fileId === l.fileId) === i) : undefined,
  };
  const warnings = [
    ...smart.check.mismatches.map((m) => `Double-check: ${m}`),
    ...(smart.check.unverified.length ? [`Couldn't find ${smart.check.unverified.map((n) => `"${n}"`).join(", ")} in the file. Check before using.`] : []),
  ];
  return done({ ...base, answers: [answer], filesFirst: false }, true, warnings);
}
