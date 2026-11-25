/**
 * Narrative Inputs: the questions a report asks before it generates
 * (Personal Injury Discharge: treatments, spine region, future care).
 *
 * Offices edit the questions in Settings → Narrative Reports. A Yes/No
 * question can show or hide a later question. Blank or skipped answers
 * drop the sentence that used them, so the report never keeps an empty
 * blank, a dangling {{TOKEN}}, or a stray period.
 *
 * Saved office copies are not rewritten here. Known amount typos are
 * corrected when a choice is shown or placed into the report.
 */
import type {
  NarrativeReportLibrary,
  NarrativeReportPrompt,
  NarrativeReportTemplate,
} from "@/lib/report-templates";
import { EMPTY_TOKEN_MARK } from "@/lib/report-html-cleanup";

export const RECOMMEND_DECOMPRESSION_TOKEN = "PROMPT_RECOMMEND_DECOMPRESSION";
export const FUTURE_CARE_AMOUNT_TOKEN = "PROMPT_FUTURE_CARE_AMOUNT";
export const HOW_MANY_TREATMENTS_TOKEN = "PROMPT_HOW_MANY_TREATMENTS";
export const SPINE_REGION_TOKEN = "PROMPT_WHICH_REGION_OF_THE_SPINE";

export const YES_NO_DEFAULT_OPTIONS = ["Yes", "No"];

/** The extra 0 in the saved Personal Injury Discharge amounts. */
const AMOUNT_TYPOS: Array<[string, string]> = [
  ["$11,0000.00", "$11,000.00"],
  ["$7,0000.00", "$7,000.00"],
  ["$5,5000.00", "$5,500.00"],
  ["$5,0000.00", "$5,000.00"],
  ["$3,5000.00", "$3,500.00"],
  ["$2,5000.00", "$2,500.00"],
];

export function correctNarrativeAmountTypos(value: string): string {
  return AMOUNT_TYPOS.reduce((text, [bad, good]) => text.split(bad).join(good), value);
}

export function promptInputKind(prompt: NarrativeReportPrompt): "yesno" | "choices" | "text" {
  if (prompt.input === "yesno" || prompt.input === "choices" || prompt.input === "text") return prompt.input;
  return prompt.options.length > 0 ? "choices" : "text";
}

export function narrativePromptVisible(
  prompt: NarrativeReportPrompt,
  prompts: NarrativeReportPrompt[],
  values: Record<string, string>,
  seen: Set<string> = new Set(),
): boolean {
  const gate = prompt.showWhen;
  if (!gate?.promptId || !gate.answers?.length) return true;
  if (seen.has(prompt.id)) return true;
  const parent = prompts.find((entry) => entry.id === gate.promptId);
  if (!parent) return true;
  const nextSeen = new Set(seen);
  nextSeen.add(prompt.id);
  if (!narrativePromptVisible(parent, prompts, values, nextSeen)) return false;
  const answer = correctNarrativeAmountTypos((values[parent.token] ?? "").trim());
  return gate.answers.some((entry) => correctNarrativeAmountTypos(entry.trim()) === answer);
}

export function visibleNarrativePrompts(
  prompts: NarrativeReportPrompt[],
  values: Record<string, string>,
): NarrativeReportPrompt[] {
  return prompts.filter((prompt) => narrativePromptVisible(prompt, prompts, values));
}

/** A Yes/No answer that hides every later question should generate the report now. */
export function narrativeAnswerSkipsToReport(
  prompts: NarrativeReportPrompt[],
  values: Record<string, string>,
  promptId: string,
): boolean {
  const prompt = prompts.find((entry) => entry.id === promptId);
  if (!prompt || promptInputKind(prompt) !== "yesno") return false;
  const dependents = prompts.filter((entry) => entry.showWhen?.promptId === prompt.id);
  if (!dependents.length) return false;
  const answer = correctNarrativeAmountTypos((values[prompt.token] ?? "").trim());
  const showsAny = dependents.some((entry) =>
    (entry.showWhen?.answers ?? []).some((option) => correctNarrativeAmountTypos(option.trim()) === answer),
  );
  if (showsAny) return false;
  const index = prompts.findIndex((entry) => entry.id === promptId);
  return !prompts.slice(index + 1).some((entry) => narrativePromptVisible(entry, prompts, values));
}

/** Values that actually print. Hidden questions are blank. Amount typos are corrected. */
export function applyNarrativeAnswers(
  prompts: NarrativeReportPrompt[],
  values: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const prompt of prompts) {
    if (!narrativePromptVisible(prompt, prompts, values)) {
      next[prompt.token] = "";
      continue;
    }
    next[prompt.token] = correctNarrativeAmountTypos((values[prompt.token] ?? "").trim());
  }
  return next;
}

function wantsDefaultDecompressionGate(template: NarrativeReportTemplate): boolean {
  const tokens = new Set(template.prompts.map((prompt) => prompt.token));
  const named = /personal injury discharge/i.test(template.name);
  const shaped =
    tokens.has(FUTURE_CARE_AMOUNT_TOKEN) &&
    tokens.has(HOW_MANY_TREATMENTS_TOKEN) &&
    tokens.has(SPINE_REGION_TOKEN);
  return named || shaped;
}

/**
 * Add "Recommend Decompression?" before Future Care Amount when the office
 * has not added or removed it. Does not rewrite saved option text.
 */
export function mergeNarrativeInputDefaults(library: NarrativeReportLibrary): NarrativeReportLibrary {
  return { templates: library.templates.map(mergeTemplateDefaults) };
}

function mergeTemplateDefaults(template: NarrativeReportTemplate): NarrativeReportTemplate {
  const skipped = new Set(template.skippedDefaultTokens ?? []);
  if (!wantsDefaultDecompressionGate(template) || skipped.has(RECOMMEND_DECOMPRESSION_TOKEN)) return template;
  if (template.prompts.some((prompt) => prompt.token === RECOMMEND_DECOMPRESSION_TOKEN)) return template;
  const gateId = `${template.id}:recommend-decompression`;
  const gate: NarrativeReportPrompt = {
    id: gateId,
    label: "Recommend Decompression?",
    token: RECOMMEND_DECOMPRESSION_TOKEN,
    options: [...YES_NO_DEFAULT_OPTIONS],
    required: false,
    input: "yesno",
  };
  const prompts = template.prompts.map((prompt) => ({ ...prompt }));
  const futureIndex = prompts.findIndex((prompt) => prompt.token === FUTURE_CARE_AMOUNT_TOKEN);
  const insertAt = futureIndex === -1 ? prompts.length : futureIndex;
  prompts.splice(insertAt, 0, gate);
  const future = prompts[insertAt + 1];
  if (future?.token === FUTURE_CARE_AMOUNT_TOKEN && !future.showWhen) {
    prompts[insertAt + 1] = { ...future, showWhen: { promptId: gateId, answers: ["Yes"] } };
  }
  return { ...template, prompts };
}

type TokenState = "hidden" | "blank" | "active";

function tokenState(
  token: string,
  prompts: NarrativeReportPrompt[],
  values: Record<string, string>,
): TokenState {
  const prompt = prompts.find((entry) => entry.token.toUpperCase() === token);
  if (prompt && !narrativePromptVisible(prompt, prompts, values)) return "hidden";
  const raw = prompt ? values[prompt.token] : values[token];
  return (raw ?? "").trim() ? "active" : "blank";
}

const PROMPT_TOKEN_RE = /\{\{\s*(PROMPT_[A-Z0-9_]+)\s*\}\}/gi;

function promptTokensIn(text: string): string[] {
  return [...text.matchAll(PROMPT_TOKEN_RE)].map((match) => match[1].toUpperCase());
}

function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    if (ch === "." && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "")) continue;
    let end = i + 1;
    while (end < text.length && /[.!?]/.test(text[end])) end += 1;
    if (end < text.length && !/\s/.test(text[end])) continue;
    while (end < text.length && /\s/.test(text[end])) end += 1;
    out.push(text.slice(start, end));
    start = end;
    i = end - 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

function tidyKept(text: string): string {
  const cleaned = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/([.!?])\1+/g, "$1");
  if (!cleaned.replace(/[\s\u00a0\u200b\uE000]/g, "")) return EMPTY_TOKEN_MARK;
  return cleaned;
}

function omitInBlockText(text: string, states: Map<string, TokenState>): string {
  const tokens = promptTokensIn(text);
  if (!tokens.length) return text;
  if (tokens.some((token) => states.get(token) === "hidden")) return EMPTY_TOKEN_MARK;
  let removingTail = false;
  let out = "";
  for (const sentence of splitSentences(text)) {
    const sentenceTokens = promptTokensIn(sentence);
    const hasBlank = sentenceTokens.some((token) => states.get(token) !== "active");
    if (hasBlank) {
      removingTail = true;
      continue;
    }
    if (removingTail && sentenceTokens.length === 0 && sentence.trim()) continue;
    removingTail = false;
    out += sentence;
  }
  return tidyKept(out);
}

type HtmlPart = { kind: "tag" | "text"; value: string };

function splitHtml(html: string): HtmlPart[] {
  const parts: HtmlPart[] = [];
  const re = /<[^>]+>/g;
  let last = 0;
  for (const match of html.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", value: html.slice(last, index) });
    parts.push({ kind: "tag", value: match[0] });
    last = index + match[0].length;
  }
  if (last < html.length) parts.push({ kind: "text", value: html.slice(last) });
  return parts;
}

function isBlockBoundary(tag: string): boolean {
  return /^<\/?(?:div|p|br|h[1-6]|li|tr|blockquote|section|article|ul|ol|table)\b/i.test(tag);
}

/**
 * Drop sentences whose prompt was left blank, and drop a whole paragraph
 * when a hidden follow-up (for example Future Care after "No") sits in it.
 * A cleared paragraph leaves the empty-field mark so a bold heading above
 * it is removed with the rest of an empty section.
 */
export function omitInactivePromptSentences(
  html: string,
  prompts: NarrativeReportPrompt[],
  values: Record<string, string>,
): string {
  const discovered = new Set<string>();
  for (const token of promptTokensIn(html)) discovered.add(token);
  const states = new Map<string, TokenState>();
  for (const token of discovered) states.set(token, tokenState(token, prompts, values));
  if (![...states.values()].some((state) => state !== "active")) return html;

  const parts = splitHtml(html);
  let out = "";
  let block: HtmlPart[] = [];
  const flush = () => {
    if (!block.length) return;
    const text = block.filter((part) => part.kind === "text").map((part) => part.value).join("");
    const next = promptTokensIn(text).length ? omitInBlockText(text, states) : null;
    out += next === null || next === text ? block.map((part) => part.value).join("") : next;
    block = [];
  };
  for (const part of parts) {
    if (part.kind === "tag" && isBlockBoundary(part.value)) {
      flush();
      out += part.value;
    } else {
      block.push(part);
    }
  }
  flush();
  return out;
}
