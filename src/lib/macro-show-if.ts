import type { MacroAnswerMap, MacroAnswerValue, MacroQuestion } from "@/lib/macro-templates";

/**
 * Optional rule on a macro question: show it only when an earlier question
 * in the same macro is answered with one of these option labels.
 * Saved on the question inside the macro library (workspace_kv), not in
 * the browser alone. Missing means the question always shows.
 */
export interface MacroShowIf {
  questionId: string;
  answers: string[];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function questionsHaveShowIf(questions: readonly Pick<MacroQuestion, "showIf">[]): boolean {
  return questions.some((question) => (question.showIf?.answers.length ?? 0) > 0);
}

/** True when the stored answer is exactly one of the rule's option labels. */
export function answerMatchesShowIf(
  value: MacroAnswerValue | undefined,
  expected: readonly string[],
): boolean {
  const wanted = new Set(expected.map((entry) => entry.trim()).filter((entry) => entry.length > 0));
  if (!wanted.size) return false;
  const picks = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return picks.some((pick) => wanted.has(pick.trim()));
}

/**
 * A question with no rule is always visible. A question whose parent is
 * hidden is hidden too (chains). A rule that points at a missing or later
 * question is ignored so older macros keep showing every question.
 * `seen` stops a circular rule from looping; that question stays hidden.
 */
export function isMacroQuestionVisible(
  question: MacroQuestion,
  questions: readonly MacroQuestion[],
  answers: MacroAnswerMap,
  seen?: ReadonlySet<string>,
): boolean {
  const rule = question.showIf;
  if (!rule || !rule.questionId || rule.answers.length === 0) return true;
  const selfIndex = questions.findIndex((entry) => entry.id === question.id);
  const parentIndex = questions.findIndex((entry) => entry.id === rule.questionId);
  if (selfIndex < 0 || parentIndex < 0 || parentIndex >= selfIndex) return true;
  if (seen?.has(question.id)) return false;
  const parent = questions[parentIndex];
  const nextSeen = new Set(seen);
  nextSeen.add(question.id);
  if (!isMacroQuestionVisible(parent, questions, answers, nextSeen)) return false;
  return answerMatchesShowIf(answers[parent.id], rule.answers);
}

export function visibleMacroQuestions(
  questions: readonly MacroQuestion[],
  answers: MacroAnswerMap,
): MacroQuestion[] {
  return questions.filter((question) => isMacroQuestionVisible(question, questions, answers));
}

/** Hidden questions contribute an empty answer so their text is not inserted. */
export function answersOmittingHidden(
  questions: readonly MacroQuestion[],
  answers: MacroAnswerMap,
): MacroAnswerMap {
  if (!questionsHaveShowIf(questions)) return answers;
  let changed = false;
  const next: MacroAnswerMap = { ...answers };
  for (const question of questions) {
    if (isMacroQuestionVisible(question, questions, answers)) continue;
    if (next[question.id] !== "") {
      next[question.id] = "";
      changed = true;
    }
  }
  return changed ? next : answers;
}

/**
 * Drop [[questionId]] tokens for hidden questions. The original template
 * is returned unchanged when nothing is hidden, so macros without rules
 * render exactly as before.
 */
export function templateOmittingHidden(
  template: string,
  questions: readonly MacroQuestion[],
  answers: MacroAnswerMap,
): string {
  if (!questionsHaveShowIf(questions)) return template;
  let next = template;
  for (const question of questions) {
    if (isMacroQuestionVisible(question, questions, answers)) continue;
    next = next.replace(new RegExp(`\\[\\[\\s*${escapeRegExp(question.id)}\\s*\\]\\]`, "g"), "");
  }
  if (next === template) return template;
  return tidyOmittedMacroTemplate(next);
}

/** Remove the empty blocks left behind when a hidden token was the whole line. */
export function tidyOmittedMacroTemplate(value: string): string {
  return value
    .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "")
    .replace(/<div>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function withoutShowIf(question: MacroQuestion): MacroQuestion {
  if (!question.showIf) return question;
  const rest = { ...question };
  delete rest.showIf;
  return rest;
}

/**
 * Keep a rule only when it points at an earlier question and names one
 * or more of that question's current options. A rule cannot point forward
 * or at itself, so a circle cannot be saved. Anything else is removed and
 * the question always shows.
 */
export function sanitizeMacroShowIf(questions: MacroQuestion[]): MacroQuestion[] {
  const firstIndex = new Map<string, number>();
  questions.forEach((question, index) => {
    if (!firstIndex.has(question.id)) firstIndex.set(question.id, index);
  });
  return questions.map((question, index) => {
    const rule = question.showIf;
    if (!rule) return question;
    if (firstIndex.get(question.id) !== index) return withoutShowIf(question);
    const parentIndex = firstIndex.get(rule.questionId);
    if (parentIndex === undefined || parentIndex >= index) return withoutShowIf(question);
    const parent = questions[parentIndex];
    const allowed = new Set(parent.options.map((option) => option.trim()).filter((option) => option.length > 0));
    const answers: string[] = [];
    const seenAnswers = new Set<string>();
    for (const answer of rule.answers) {
      const trimmed = answer.trim();
      if (!trimmed || !allowed.has(trimmed) || seenAnswers.has(trimmed)) continue;
      seenAnswers.add(trimmed);
      answers.push(trimmed);
    }
    if (!answers.length) return withoutShowIf(question);
    const sameAnswers =
      rule.answers.length === answers.length && rule.answers.every((answer, answerIndex) => answer === answers[answerIndex]);
    if (sameAnswers && rule.questionId === question.showIf?.questionId) return question;
    return { ...question, showIf: { questionId: parent.id, answers } };
  });
}

/** Read a show-if block off raw JSON. Invalid shapes are dropped. */
export function readMacroShowIf(value: unknown): MacroShowIf | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const questionId = typeof row.questionId === "string" ? row.questionId.trim() : "";
  if (!questionId) return undefined;
  if (!Array.isArray(row.answers)) return undefined;
  const answers: string[] = [];
  const seen = new Set<string>();
  for (const answer of row.answers) {
    if (typeof answer !== "string") continue;
    const trimmed = answer.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    answers.push(trimmed);
  }
  if (!answers.length) return undefined;
  return { questionId, answers };
}
