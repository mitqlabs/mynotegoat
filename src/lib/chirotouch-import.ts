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
  "areas of chief complaint": "what are your chief complaints",
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
  /** questionId → answer value. String for single-select/free-text; array of
   *  option labels for multi-select (so checkboxes come in selected). */
  answers: Record<string, string | string[]>;
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
  type Candidate = {
    macro: MacroTemplate;
    questionId: string;
    options: string[];
    multiSelect: boolean;
  };
  // A question label can exist in more than one macro (e.g. both the MVC and
  // Slip & Fall history macros ask "Were you seen at emergency/urgent care?").
  // Index ALL macros that own a given label so we can pick the right one.
  const index = new Map<string, Candidate[]>();
  for (const macro of macros) {
    for (const q of macro.questions) {
      const key = normalizeQuestion(q.label);
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push({
        macro,
        questionId: q.id,
        options: q.options ?? [],
        multiSelect: Boolean(q.multiSelect),
      });
    }
  }

  // Resolve each record to its candidate macros (respecting ignore + aliases).
  const resolved = records.map((rec) => {
    const norm = normalizeQuestion(rec.question);
    if (CHIROTOUCH_IGNORE_QUESTIONS.has(norm)) {
      return { rec, candidates: [] as Candidate[], ignore: true };
    }
    const effective = CHIROTOUCH_QUESTION_ALIASES[norm] ?? norm;
    return { rec, candidates: index.get(effective) ?? [], ignore: false };
  });

  // Score each macro by how many of the pasted questions it could fill. A
  // question shared by two macros then routes to the one the rest of the data
  // belongs to (many matches) rather than a stray single-question macro — so a
  // full MVC paste fills MVC HX and never triggers an empty Slip & Fall block.
  const macroScore = new Map<string, number>();
  for (const r of resolved) {
    if (r.ignore) continue;
    const seen = new Set<string>();
    for (const c of r.candidates) {
      if (seen.has(c.macro.id)) continue;
      seen.add(c.macro.id);
      macroScore.set(c.macro.id, (macroScore.get(c.macro.id) ?? 0) + 1);
    }
  }

  const fillByMacro = new Map<string, ImportMacroFill>();
  const unmatched: ImportRecord[] = [];

  for (const r of resolved) {
    if (r.ignore) continue;
    if (!r.candidates.length) {
      unmatched.push(r.rec);
      continue;
    }
    // Pick the candidate whose macro the rest of the data most belongs to.
    let best = r.candidates[0];
    for (const c of r.candidates) {
      if ((macroScore.get(c.macro.id) ?? 0) > (macroScore.get(best.macro.id) ?? 0)) {
        best = c;
      }
    }
    const toCanonical = (raw: string) =>
      best.options.find((opt) => normalizeQuestion(opt) === normalizeQuestion(raw)) ?? raw;
    let value: string | string[];
    if (best.multiSelect) {
      // Split a combined answer ("a, b, c, and d") into parts and map each to a
      // canonical option so the checkboxes come in selected. Only for
      // multi-select questions — single-select free text ("...jarring and being
      // thrown...") must NOT be split.
      const parts = r.rec.answer
        .split(/,|\s+and\s+/i)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      value = parts.length ? parts.map(toCanonical) : r.rec.answer;
    } else {
      value = toCanonical(r.rec.answer);
    }

    let fill = fillByMacro.get(best.macro.id);
    if (!fill) {
      fill = { macro: best.macro, answers: {}, filled: [] };
      fillByMacro.set(best.macro.id, fill);
    }
    fill.answers[best.questionId] = value;
    fill.filled.push({ question: r.rec.question, answer: r.rec.answer });
  }

  return { fills: Array.from(fillByMacro.values()), unmatched };
}
