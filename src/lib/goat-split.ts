/**
 * Multi-part patient questions: "when was his XR and what were the findings?"
 * → ["when was his XR", "what were the findings (XR)"]. Each part is answered
 * on its own (rules, or + mode filling gaps) and the answers come back together.
 */

const DOC_TERMS: Array<[RegExp, string]> = [
  [/\b(x-?rays?|xr|radiograph)/i, "x-ray"],
  [/\bmri\b/i, "MRI"],
  [/\b(pm|pain management|pain mgmt)\b/i, "pain management"],
  [/\b(ortho|orthopedic|orthopaedic)\b/i, "orthopedic"],
  [/\b(neuro|neurolog)/i, "neurology"],
  [/\b(ct scan|ct)\b/i, "CT"],
];

/** What each part can be about: a question word or a known topic. */
const ASKS = /\b(when|what|which|who|how|did|does|is|was|were|are|any|list|show|give|tell|date|findings?|impression|rom|range of motion|recs?|recommend\w*|plan|diagnos\w*|dx|meds?|medications?|appt|appointment|visit|next|last|injections?|fees?|costs?)\b/i;

/** Parts about what a report says (these inherit the report the question named). */
const DOC_CONTENT = /\b(findings?|impression|rom|range of motion|recs?|recommend\w*|plan|diagnos\w*|dx|meds?|medications?|injections?|fees?|costs?|results?|say|said|show)\b/i;

export function docTerm(question: string): string | null {
  for (const [re, label] of DOC_TERMS) if (re.test(question)) return label;
  return null;
}

/** Split into parts; a single part comes back unchanged. */
export function splitPatientQuestion(question: string): string[] {
  const q = question.trim().replace(/[?.!]+$/, "");
  // Don't split inside "range of motion and …" style lists unless the right side is its own ask.
  const raw = q.split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+(?:also\s+)?|\s+also\s+|;\s*|\s+plus\s+)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (raw.length < 2) return [question.trim()];
  // Merge pieces that don't ask anything on their own back into the previous part ("neck and back").
  const parts: string[] = [];
  for (const piece of raw) {
    if (parts.length && !ASKS.test(piece)) parts[parts.length - 1] += ` and ${piece}`;
    else parts.push(piece);
  }
  if (parts.length < 2) return [question.trim()];
  // Carry the document the question is about into parts that don't name one ("what were the findings" → of the x-ray).
  const doc = docTerm(q);
  return parts.map((p) => (doc && !docTerm(p) && DOC_CONTENT.test(p) ? `${p} (${doc})` : p));
}
