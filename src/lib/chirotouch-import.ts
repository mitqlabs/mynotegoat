/**
 * ChiroTouch → Note Goat import (temporary migration tool).
 *
 * ChiroTouch's chart-note "Data" tab copies out as a repeating 3-line block:
 *   <section>            e.g. "objective"   (ignored)
 *   <question>           e.g. "Where were you seated?"
 *   <answer>             e.g. "driver"
 *
 * We parse those into Question/Answer records, then match each question to a
 * question in the user's Objective-section macros so the answers can be
 * filled into native macro runs. Nothing is guessed silently — anything that
 * can't be matched is returned in `unmatched` for the UI to surface.
 */

import type { MacroTemplate } from "@/lib/macro-templates";

const SECTION_WORDS = new Set(["objective", "subjective", "assessment", "plan", "data", "soap", "section", "question", "text"]);

export interface ImportRecord {
  question: string;
  answer: string;
}

/** Lowercase, collapse whitespace, drop trailing punctuation — for matching. */
export function normalizeQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/[?.:!,\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ChiroTouch question text → the equivalent Note Goat question text, for the
 * handful that are worded differently. Keys and values are compared after
 * normalizeQuestion(). Add entries here as new mismatches turn up.
 */
export const CHIROTOUCH_QUESTION_ALIASES: Record<string, string> = {
  "what type of vehicle were you driving": "what was the vehicle you were in",
  "what type of vehicle was the other vehicle": "what was the other vehicle",
  "were you prepared or any of the following": "were you prepared for impact",
  "how did you feel after the impact? were you": "how did you feel after the impact",
  "are you experiencing any of the following": "symptoms since collision",
};

/**
 * ChiroTouch questions to SKIP entirely on import (not filled, not flagged as
 * unmatched). Compared after normalizeQuestion().
 */
export const CHIROTOUCH_IGNORE_QUESTIONS = new Set<string>([
  "injury date",
  "when was your last car accident prior this one",
]);

/** Parse pasted ChiroTouch "Data" text into Question/Answer records. */
export function parseChirotouchData(text: string): ImportRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const records: ImportRecord[] = [];
  let i = 0;
  while (i < lines.length) {
    // Skip section/header marker lines (objective, question, text, …).
    if (SECTION_WORDS.has(lines[i].toLowerCase())) {
      i += 1;
      continue;
    }
    // This line is the question; the answer is everything up to the next
    // section marker (answers are usually one line but be tolerant).
    const question = lines[i];
    i += 1;
    const answerParts: string[] = [];
    while (i < lines.length && !SECTION_WORDS.has(lines[i].toLowerCase())) {
      answerParts.push(lines[i]);
      i += 1;
    }
    const answer = answerParts.join(" ").trim();
    if (question) records.push({ question, answer });
  }
  return records;
}

export interface ImportMacroFill {
  macro: MacroTemplate;
  /** questionId → answer value (canonical option text when it matched one). */
  answers: Record<string, string>;
  /** For the preview: which Q/A rows filled this macro. */
  filled: Array<{ question: string; answer: string }>;
}

export interface ImportPlan {
  fills: ImportMacroFill[];
  unmatched: ImportRecord[];
}

/**
 * Match parsed records to the given macros' questions and build the fill plan.
 * `macros` should be the active Objective-section macros. First macro that owns
 * a question wins. Answers are mapped to a matching option (canonical casing)
 * when one exists, otherwise kept as free text (Other/edit).
 */
export function buildImportPlan(records: ImportRecord[], macros: MacroTemplate[]): ImportPlan {
  // Index every macro question by its normalized label.
  const questionIndex = new Map<string, { macro: MacroTemplate; questionId: string; options: string[] }>();
  for (const macro of macros) {
    for (const q of macro.questions) {
      const key = normalizeQuestion(q.label);
      if (key && !questionIndex.has(key)) {
        questionIndex.set(key, { macro, questionId: q.id, options: q.options ?? [] });
      }
    }
  }

  const fillByMacro = new Map<string, ImportMacroFill>();
  const unmatched: ImportRecord[] = [];

  for (const rec of records) {
    const norm = normalizeQuestion(rec.question);
    if (CHIROTOUCH_IGNORE_QUESTIONS.has(norm)) continue; // skip entirely
    const effective = CHIROTOUCH_QUESTION_ALIASES[norm] ?? norm;
    const hit = questionIndex.get(effective);
    if (!hit) {
      unmatched.push(rec);
      continue;
    }
    // Prefer the macro's canonical option text when the answer matches one
    // (so the pill shows selected); otherwise keep the raw answer (Other/edit).
    const canonicalOption = hit.options.find(
      (opt) => normalizeQuestion(opt) === normalizeQuestion(rec.answer),
    );
    const value = canonicalOption ?? rec.answer;

    let fill = fillByMacro.get(hit.macro.id);
    if (!fill) {
      fill = { macro: hit.macro, answers: {}, filled: [] };
      fillByMacro.set(hit.macro.id, fill);
    }
    fill.answers[hit.questionId] = value;
    fill.filled.push({ question: rec.question, answer: rec.answer });
  }

  return { fills: Array.from(fillByMacro.values()), unmatched };
}
