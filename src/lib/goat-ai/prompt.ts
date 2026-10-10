/**
 * G.O.A.T. Smart mode (beta) — the instructions given to the in-browser model.
 * Pure. Small models follow short, specific instructions best, so only the
 * rules for the kind of question asked are included, plus one worked example
 * written about a different (made-up) case so its facts can't leak into answers.
 */

import type { GoatAnswerPrefs } from "@/lib/goat-answer-prefs";
import { sourcesForPrompt, type AiIntent, type AiSource } from "@/lib/goat-ai/sources";

export const NOT_FOUND = "I couldn't find that in this patient's file.";

type Prefs = Pick<GoatAnswerPrefs, "showCosts" | "groupByRegion" | "regionOrder">;

export function buildSystemPrompt(prefs: Prefs, intents: AiIntent[] = [], patientName?: string): string {
  const rules = [
    `You are G.O.A.T., a careful assistant inside a chiropractic clinic's patient chart${patientName ? ` (patient: ${patientName})` : ""}. Answer using ONLY the numbered SOURCES. Sources are reports from different doctors, each with its own style and headings; read them like an experienced person would.`,
    "",
    "Rules:",
    `- Only facts written in the sources. Never guess. If the sources don't answer the question, reply exactly: ${NOT_FOUND}`,
    "- Short answer, plain text, one fact per line starting with \"- \". No greeting, no intro, no summary, no bold.",
    "- Keep the source's own words for procedures, findings and labels (e.g. \"As an alternative to injection therapy\", \"Intermittent Disc Decompression (IDD)\"). Never rename or abbreviate them.",
    "- Never write source labels like S1 or file names in the answer.",
    "- Copy numbers, degrees, spinal levels (L5/S1, C7/T1), dates, counts and sessions exactly as written.",
  ];
  if (intents.includes("rom")) {
    rules.push("- Range of motion: a heading line per region like \"Cervical ROM\", then one motion per line: \"- <degrees>° <motion> (<with pain / without pain, as written>)\".");
  }
  if (intents.includes("recommend")) {
    rules.push(
      "- Recommendations: one line per recommendation with the procedure and level, sessions and length, and the alternative it is offered as. Skip items that say None. Put follow-up last.",
    );
  }
  if (intents.includes("findings")) {
    rules.push("- Findings: one finding per line, level first when the source starts with it. Use the Impression when there is one.");
  }
  rules.push(
    prefs.showCosts
      ? "- Costs: include every fee and cost exactly as written."
      : "- Costs: leave out every fee, cost, price and dollar amount.",
  );
  if (prefs.groupByRegion) {
    rules.push(
      `- Body regions: start each line with its region and a colon (e.g. \"- Cervical: …\"), ordered ${prefs.regionOrder.join(", ")}. An item for several regions names them together (\"- Cervical and Lumbar: …\").`,
    );
  }
  return rules.join("\n");
}

/** One worked example (made-up knee/shoulder case) in the requested format. */
function example(intents: AiIntent[], prefs: Prefs): Array<{ role: "user" | "assistant"; content: string }> {
  if (intents.includes("recommend")) {
    const src =
      "[S1] Example_Ortho_Consult.pdf (Report)\nRecommendations:\nFor the right shoulder impingement: Recommend right shoulder subacromial corticosteroid injection.\nThe fee is approximately $900.\nAs an alternative to injection, the patient is a candidate for 6 sessions of physical therapy for the right knee and right shoulder, 45 minutes each.\nCost is $120 per session.\nMedications None\nFollow up 3 weeks";
    const r = (region: string) => (prefs.groupByRegion ? `${region}: ` : "");
    const lines = [
      `- ${r("Shoulder")}Recommend right shoulder subacromial corticosteroid injection${prefs.showCosts ? " (fee approximately $900)" : ""}`,
      `- ${r("Shoulder and Knee")}As an alternative to injection: 6 sessions of physical therapy, 45 minutes each${prefs.showCosts ? " ($120 per session)" : ""}`,
      "- Follow up 3 weeks",
    ];
    return [
      { role: "user", content: `SOURCES:\n${src}\n\nQUESTION: what are the recommendations` },
      { role: "assistant", content: lines.join("\n") },
    ];
  }
  if (intents.includes("rom")) {
    return [
      {
        role: "user",
        content:
          "SOURCES:\n[S1] Example_Exam.pdf (Report)\nThoracic spine range of motion: flexion 20 degrees with pain and rotation 15 degrees bilaterally without pain.\n\nQUESTION: thoracic rom",
      },
      { role: "assistant", content: "Thoracic ROM\n- 20° flexion (with pain)\n- 15° rotation, bilaterally (without pain)" },
    ];
  }
  return [];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Chat messages for one question. A previous turn (global chat follow-ups) is included briefly. */
export function buildMessages(input: {
  question: string;
  sources: AiSource[];
  prefs: Prefs;
  intents?: AiIntent[];
  patientName?: string;
  previous?: { question: string; answer: string } | null;
}): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const intents = input.intents ?? [];
  const msgs: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: buildSystemPrompt(input.prefs, intents, input.patientName) },
    ...example(intents, input.prefs),
  ];
  if (input.previous) {
    msgs.push({ role: "user", content: `QUESTION: ${input.previous.question}` });
    msgs.push({ role: "assistant", content: input.previous.answer.slice(0, 600) });
  }
  msgs.push({ role: "user", content: `SOURCES:\n${sourcesForPrompt(input.sources)}\n\nQUESTION: ${input.question}` });
  return msgs;
}

/** Clean up small-model formatting habits: markdown bold/headings, stray bullets, trailing spaces. */
export function tidyAnswer(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Office preferences applied after the model writes (a small model doesn't
// always follow formatting rules, so these are enforced here as well).
// ---------------------------------------------------------------------------

const PREF_REGION: Array<[string, RegExp]> = [
  ["Cervical", /\b(cervical|neck|c[- ]?spine|C[1-7]\s*[-/]\s*(?:C[1-7]|T1))\b/i],
  ["Thoracic", /\b(thoracic|mid[- ]?back|t[- ]?spine|T\d{1,2}\s*[-/]\s*(?:T\d{1,2}|L1))\b/i],
  ["Lumbar", /\b(lumbar|low(?:er)? back|l[- ]?spine|L[1-5]\s*[-/]\s*(?:L[1-5]|S1))\b/i],
  ["Shoulder", /\bshoulders?\b/i],
  ["Elbow", /\belbows?\b/i],
  ["Wrist/Hand", /\b(wrists?|hands?|fingers?)\b/i],
  ["Hip", /\bhips?\b/i],
  ["Knee", /\bknees?\b/i],
  ["Ankle/Foot", /\b(ankles?|foot|feet|toes?)\b/i],
];

function regionsOfLine(line: string): string[] {
  return PREF_REGION.filter(([, re]) => re.test(line)).map(([r]) => r);
}

/** "- Cervical: 30° flexion (with pain), 50° extension (with pain)" → "Cervical ROM" + one motion per line. */
function expandRomLines(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => {
      const m = /^-?\s*(Cervical|Thoracic|Lumbar|Shoulder|Hip|Knee|Elbow|Wrist|Ankle)(?: spine)?(?: ROM| range of motion)?\s*:\s*(.+)$/i.exec(line.trim());
      if (!m) return [line];
      const items = m[2].split(/[,;]\s+(?=\d)/).map((t) => t.trim().replace(/\.$/, "")).filter(Boolean);
      if (items.length < 2 || !items.every((t) => /\d/.test(t))) return [line];
      const region = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      return [`${region} ROM`, ...items.map((t) => `- ${t}`)];
    })
    .join("\n");
}

export function applyAnswerPrefs(text: string, prefs: Prefs, intents: AiIntent[] = []): string {
  let out = intents.includes("rom") ? expandRomLines(text) : text;
  if (!prefs.showCosts) {
    out = out
      .split("\n")
      .map((l) =>
        l
          .replace(/\s*\([^()]*\$\s?\d[^()]*\)/g, "")
          .replace(/[,;]?\s*(?:at|for|costs?|fees?|estimated(?: cost)?|professional fees|medical expenses)[^,.;()\n]*\$\s?\d[\d,]*(?:\.\d+)?[^,.;()\n]*/gi, "")
          .replace(/[^.;\n]*\$\s?\d[\d,]*[^.;\n]*[.;]?/g, "")
          .replace(/\s+([.,;])/g, "$1")
          .trimEnd(),
      )
      .filter((l) => l.replace(/^[-\s]+/, "").length > 0)
      .join("\n");
  }
  if (prefs.groupByRegion && !intents.includes("rom")) {
    const lines = out.split("\n");
    const bullets = lines.map((l, i) => ({ l, i, regions: /^-\s/.test(l) ? regionsOfLine(l) : [] }));
    const distinct = new Set(bullets.flatMap((b) => b.regions));
    if (distinct.size >= 2) {
      const order = (r: string) => {
        const k = prefs.regionOrder.indexOf(r);
        return k < 0 ? 99 : k;
      };
      const labelled = bullets.map((b) => {
        if (!b.regions.length) return { ...b, key: 999 };
        const sorted = [...b.regions].sort((x, y) => order(x) - order(y));
        const label = sorted.length > 1 ? `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}` : sorted[0];
        const body = b.l.replace(/^-\s*/, "");
        const already = new RegExp(`^(${sorted.map((r) => r.replace("/", "\\/")).join("|")})( and [A-Za-z/]+)*\\s*:`, "i").test(body);
        return { ...b, l: already ? b.l : `- ${label}: ${body}`, key: order(sorted[0]) };
      });
      // Re-order each run of consecutive bullet lines by region; other lines stay where they are.
      const result: string[] = [];
      let run: typeof labelled = [];
      const flush = () => {
        run.sort((a, b) => a.key - b.key || a.i - b.i).forEach((b) => result.push(b.l));
        run = [];
      };
      for (const b of labelled) {
        if (/^-\s/.test(b.l)) run.push(b);
        else {
          flush();
          result.push(b.l);
        }
      }
      flush();
      out = result.join("\n");
    }
  }
  return out;
}
