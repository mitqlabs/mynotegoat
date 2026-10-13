"use client";

/**
 * G.O.A.T. Smart mode (beta) — one question end to end, all in the browser:
 * retrieval (sources.ts) → prompt (prompt.ts) → in-browser model (engine.ts)
 * → check against the sources (verify.ts).
 */

import { buildFactSources } from "@/lib/goat-ai/fact-sources";
import type { GoatAnswer, GoatContext } from "@/lib/goat";
import type { GoatAnswerPrefs } from "@/lib/goat-answer-prefs";
import { buildAiSources, type AiRetrieval } from "@/lib/goat-ai/sources";
import { applyAnswerPrefs, buildMessages, NOT_FOUND, tidyAnswer } from "@/lib/goat-ai/prompt";
import { checkAnswer, type AiCheck } from "@/lib/goat-ai/verify";
import { runGoatAi } from "@/lib/goat-ai/engine";

export interface SmartAnswer {
  retrieval: AiRetrieval;
  text: string;
  check: AiCheck;
  /** Whole answer time in ms (retrieval + model), and time to first word. */
  ms: number;
  firstTokenMs: number;
  /** True when no source matched, so the model wasn't asked. */
  skipped: boolean;
}

export async function answerSmart(input: {
  context: GoatContext;
  question: string;
  prefs: GoatAnswerPrefs;
  previous?: { question: string; answer: string } | null;
  onText?: (text: string) => void;
  /** What the basic lookup found (already checked against the page/files): input for the model. */
  ruleAnswers?: GoatAnswer[];
  /** Extra instruction added to the question (e.g. one heading per part). */
  instruction?: string;
}): Promise<SmartAnswer> {
  const t0 = performance.now();
  const retrieval = buildAiSources(input.context, input.question);
  // + mode reads the timeline + the facts relevant to the question (not raw excerpts).
  retrieval.sources = buildFactSources(input.context, input.question, retrieval.sources);
  const ruleLines = (input.ruleAnswers ?? []).flatMap((a) => [
    `${a.title}:`,
    ...a.lines,
    ...(a.groups ?? []).flatMap((g) => [g.lead, ...g.blocks.flatMap((b) => [b.heading, ...b.items].filter(Boolean))]),
  ]).filter((l) => l.trim()).slice(0, 40);
  if (ruleLines.length) retrieval.sources.unshift({ id: "S0", title: "Basic lookup results (checked against the chart)", kind: "page", section: input.ruleAnswers![0].section, lines: ruleLines.map((text) => ({ text })) });
  retrieval.sources.forEach((src, i) => (src.id = `S${i + 1}`));
  if (!retrieval.sources.length) {
    const text = retrieval.unread
      ? `${NOT_FOUND} ${retrieval.unread} file${retrieval.unread === 1 ? " hasn't" : "s haven't"} been read yet; use "Read files" and ask again.`
      : NOT_FOUND;
    input.onText?.(text);
    return { retrieval, text, check: { supports: [], unverified: [], mismatches: [] }, ms: performance.now() - t0, firstTokenMs: 0, skipped: true };
  }
  const messages = buildMessages({
    question: input.instruction ? `${input.question}\n(${input.instruction})` : input.question,
    sources: retrieval.sources,
    prefs: input.prefs,
    intents: retrieval.intents,
    patientName: input.context.patientName,
    previous: input.previous,
  });
  let firstAt = 0;
  const run = await runGoatAi(messages, (t) => {
    if (!firstAt) firstAt = performance.now();
    input.onText?.(applyAnswerPrefs(tidyAnswer(t), input.prefs, retrieval.intents));
  });
  const text = applyAnswerPrefs(tidyAnswer(run.text), input.prefs, retrieval.intents) || NOT_FOUND;
  const check = text.startsWith(NOT_FOUND) ? { supports: [], unverified: [], mismatches: [] } : checkAnswer(text, retrieval.sources);
  return { retrieval, text, check, ms: performance.now() - t0, firstTokenMs: firstAt ? firstAt - t0 : 0, skipped: false };
}
