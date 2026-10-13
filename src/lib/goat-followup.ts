/**
 * Short patient follow-ups in rule-based G.O.A.T.: "when was her x-ray?" then
 * "and the MRI?" → "when was her MRI?" (same patient, topic swapped).
 */
const TOPICS = /\b(x-?rays?|xr|mri|ct( scan)?|pm|pain management|ortho\w*|neuro\w*|referrals?|recs?|recommendations?|rom|range of motion|visits?|appts?|appointments?|balance|bill|charges?|attorney|atty|dob|birthday|dol|doi|date of (loss|injury)|diagnos\w*|dx|findings|impressions?|phone|address|insurance)\b/i;
const LEAD = /^\s*(?:and|ok|so|also)?\s*(?:what about|how about|and)\s+(?:the|his|her|their)?\s*/i;

/** The full question for a follow-up, or null when it isn't one. */
export function expandFollowUp(question: string, previous: string | null): string | null {
  if (!previous) return null;
  const q = question.trim().replace(/[?.!]+$/, "");
  if (q.split(/\s+/).length > 5 || !LEAD.test(q)) return null;
  const topic = q.replace(LEAD, "").trim();
  if (!topic) return null;
  const prev = previous.trim().replace(/[?.!]+$/, "");
  const m = TOPICS.exec(prev);
  if (m) return `${prev.slice(0, m.index)}${topic}${prev.slice(m.index + m[0].length)}?`;
  const head = /^(when|what|where|who|how many|how much|did|does|is|was)\b(?:\s+(?:was|is|were|are|did|does))?/i.exec(prev);
  return head ? `${head[0]} ${topic}?` : null;
}
