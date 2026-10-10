/**
 * G.O.A.T. Smart mode (beta) — checking an answer against its sources (pure).
 *
 * For every line of the model's answer this finds the source sentence that
 * supports it, so the panel can show the exact quote under the answer, and it
 * flags any number in the answer that doesn't appear in the sources.
 */

import type { AiSource } from "@/lib/goat-ai/sources";

export interface AiSupport {
  sourceId: string;
  title: string;
  page?: number;
  /** The exact supporting sentence(s), quoted from the source. */
  quote: string;
}

export interface AiCheck {
  supports: AiSupport[];
  /** Numbers in the answer that no source contains (e.g. "45°"). */
  unverified: string[];
  /** Lines whose pain words disagree with the source clause they come from. */
  mismatches: string[];
}

const PAIN_WORDS = new Set(["with", "without", "pain", "painful", "painless", "free"]);
const NUM = /\$?\d[\d,]*(?:\.\d+)?/g;

const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twelve: "12", twenty: "20" };

function nums(text: string): string[] {
  const t = text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)\b/gi, (w) => NUMBER_WORDS[w.toLowerCase()]);
  return (t.match(NUM) ?? []).map((n) => n.replace(/[$,]/g, "")).filter((n) => n.length > 0);
}

function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4),
  );
}

/** Sentences (or numbered items / clauses split at " -" bullets) of a source line. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;])\s+(?=[A-Z0-9-])|\s+-(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

export function checkAnswer(answer: string, sources: AiSource[]): AiCheck {
  const pieces: Array<{ source: AiSource; page?: number; text: string; nums: string[]; words: Set<string> }> = [];
  for (const s of sources) {
    for (const l of s.lines) {
      for (const text of sentences(l.text)) pieces.push({ source: s, page: l.page, text, nums: nums(text), words: wordsOf(text) });
    }
  }
  const allNums = new Set(pieces.flatMap((p) => p.nums));
  const supports: AiSupport[] = [];
  const seen = new Set<string>();
  const unverified = new Set<string>();
  const lines = answer.split("\n").map((l) => l.trim()).filter((l) => l.length > 3);
  for (const line of lines) {
    const lineNums = nums(line);
    for (const n of lineNums) if (!allNums.has(n)) unverified.add(n);
    const lw = wordsOf(line);
    let best: (typeof pieces)[number] | null = null;
    let bestScore = 0;
    for (const p of pieces) {
      let score = 0;
      for (const n of lineNums) if (p.nums.includes(n)) score += 2;
      for (const w of lw) if (p.words.has(w)) score += 1;
      // Shorter, more specific sentences win ties.
      const adjusted = score - p.text.length / 2000;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        best = p;
      }
    }
    if (!best || bestScore < 2) continue;
    const key = `${best.source.id}|${best.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    supports.push({ sourceId: best.source.id, title: best.source.title, page: best.page, quote: best.text });
  }
  // Pain words must match the source: "25° left lateral rotation (with pain)" when the report says
  // "25 degrees of left lateral rotation without pain" is flagged.
  const painOf = (t: string): "with" | "without" | null =>
    /\b(without pain|no pain|pain[- ]free|painless|non[- ]?painful)\b/i.test(t) ? "without" : /\b(with pain|painful)\b/i.test(t) ? "with" : null;
  const mismatches: string[] = [];
  const clauses = lines.flatMap((l) => l.split(/[;,]\s+(?=\D*\d)/));
  for (const line of clauses) {
    const want = painOf(line);
    if (!want) continue;
    const lineNums = nums(line);
    if (!lineNums.length) continue;
    const lw = wordsOf(line);
    // Source clauses: split sentences further at commas so each motion is its own clause.
    let best: { text: string; score: number } | null = null;
    for (const p of pieces) {
      for (const clause of p.text.split(/,\s*/)) {
        const cn = nums(clause);
        if (!lineNums.some((n) => cn.includes(n))) continue;
        let score = 0;
        for (const w of wordsOf(clause)) if (lw.has(w) && !PAIN_WORDS.has(w)) score += 1;
        if (!best || score > best.score) best = { text: clause, score };
      }
    }
    const have = best ? painOf(best.text) : null;
    if (best && have && have !== want) mismatches.push(`"${line.replace(/^-\s*/, "")}" — the source says: "${best.text.trim()}"`);
  }
  return { supports, unverified: [...unverified], mismatches };
}
