/**
 * Multi-part questions for + mode ("when was she referred to PM and when did she go,
 * what was the ROM and recs"): one heading per part, and any part the model leaves out
 * is added back from the basic lookup's facts after it writes. Pure.
 */
import type { GoatAnswer } from "@/lib/goat";

export type PartKey = "referral" | "visit" | "rom" | "recs";
export const PART_HEADINGS: Record<PartKey, string> = {
  referral: "Referral date",
  visit: "Visit date",
  rom: "Range of motion",
  recs: "Recommendations",
};

export function questionParts(question: string): PartKey[] {
  const q = question.toLowerCase();
  const parts: PartKey[] = [];
  if (/\brefer\w*/.test(q)) parts.push("referral");
  if (/\b(when|date)\b/.test(q) && /\b(go|goes|went|gone|seen|see|saw|visit\w*|consult\w*|appointment|appt)\b/.test(q)) parts.push("visit");
  if (/\brom\b|range of motion/.test(q)) parts.push("rom");
  if (/\b(recs?|recommend\w*|suggest\w*|plan)\b/.test(q)) parts.push("recs");
  return parts;
}

export function partsInstruction(parts: PartKey[], romShownSeparately = false): string {
  const romNote = romShownSeparately && parts.includes("rom") ? " Range of motion is shown separately, copied from the report: do NOT write ROM numbers yourself." : "";
  if (romShownSeparately) parts = parts.filter((p) => p !== "rom");
  if (parts.length < 2) return romNote.trim();
  return `This question has ${parts.length} parts. Answer every part, each under its own heading line: ${parts.map((p) => `"${PART_HEADINGS[p]}"`).join(", ")}. If a part isn't in the sources, write the heading and say it wasn't found.${romNote}`;
}

const DATE = /\b\d{2}\/\d{2}\/\d{4}\b/;

/** The facts for each part, from the basic lookup's answers. */
export function partFacts(answers: GoatAnswer[]): Partial<Record<PartKey, string[]>> {
  const out: Partial<Record<PartKey, string[]>> = {};
  for (const a of answers) {
    for (const line of a.lines) {
      const ref = /referred to (.+?) on (\d{2}\/\d{2}\/\d{4})/.exec(line);
      if (ref && !out.referral) out.referral = [`Referred to ${ref[1]} on ${ref[2]}.`];
      const seen = /(?:was seen|saw .+?)(?: by .+?)? on (\d{2}\/\d{2}\/\d{4})/.exec(line);
      if (seen && !out.visit) out.visit = [`Seen on ${seen[1]}.`];
    }
    for (const g of a.groups ?? []) {
      const items = g.blocks.flatMap((b) => b.items).filter((i) => !/^Not found/.test(i));
      if (!items.length) continue;
      if (/range of motion|\brom\b/i.test(g.lead) && !out.rom) out.rom = items;
      if (/recommend/i.test(g.lead) && !out.recs) out.recs = items;
    }
    if (a.title === "Recommendations" && !out.recs) {
      const items = (a.groups ?? []).flatMap((g) => g.blocks.flatMap((b) => b.items));
      if (items.length) out.recs = items;
    }
  }
  return out;
}

/** Is this part answered in the model's text? */
export function partCovered(text: string, part: PartKey, facts: string[] | undefined): boolean {
  const t = text.toLowerCase();
  const date = facts?.map((f) => DATE.exec(f)?.[0]).find(Boolean);
  if (part === "referral") return date ? t.includes(date) : /referr\w*[^.\n]*\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t);
  if (part === "visit") return date ? t.includes(date) : /(seen|visit|went|saw)[^.\n]*\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t);
  if (part === "rom") {
    if (!facts?.length) return /range of motion|\brom\b/.test(t);
    const nums = facts.flatMap((f) => f.match(/\d+°/g) ?? []);
    return nums.length ? nums.some((n) => t.includes(n) || t.includes(n.replace("°", " degrees"))) : facts.some((f) => t.includes(f.toLowerCase().slice(0, 25)));
  }
  if (!facts?.length) return /recommend/.test(t);
  return facts.some((f) => {
    const key = f.toLowerCase().replace(/^[^:]*:\s*/, "").replace(/^(?:we\s+)?(?:recommend(?:ed|s)?|consider|continue|suggest(?:ed)?)\s+(?:a\s+|an\s+|the\s+)?/, "").split(/\s+/).slice(0, 3).join(" ");
    return key.length > 6 && t.includes(key);
  });
}

/** Add back any part the model left out, under its heading, from the basic lookup's facts. */
export function backfillParts(text: string, parts: PartKey[], answers: GoatAnswer[]): { text: string; added: PartKey[] } {
  if (parts.length < 2) return { text, added: [] };
  const facts = partFacts(answers);
  const added: PartKey[] = [];
  let out = text.trim();
  for (const p of parts) {
    if (partCovered(out, p, facts[p])) continue;
    const lines = facts[p];
    out += `\n\n${PART_HEADINGS[p]}\n${lines?.length ? lines.map((l) => `- ${l}`).join("\n") : "- Not found in this patient's files."}`;
    added.push(p);
  }
  return { text: out, added };
}

/** The ROM card from the basic lookup (rendered from the extracted facts, never rewritten by the model). */
export function romGroupsFrom(answers: GoatAnswer[]): NonNullable<GoatAnswer["groups"]> {
  for (const a of answers) {
    if (/^range of motion/i.test(a.title) && a.groups?.length) return a.groups;
    const g = (a.groups ?? []).filter((x) => /range of motion|\brom\b/i.test(x.lead));
    if (g.length) return g;
  }
  return [];
}
