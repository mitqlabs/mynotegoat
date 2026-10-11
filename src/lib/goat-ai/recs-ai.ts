/**
 * G.O.A.T. Smart mode (beta) — recommendations read by the in-browser model.
 *
 * The model reads the chosen report's full text (report-text.ts) and returns
 * the recommendations as JSON. Everything after that is deterministic and
 * pure: each item is checked against the report (numbers, levels and costs
 * must be in it; most of its words too), merged with what the rules already
 * found (duplicates dropped), and rendered in the regular G.O.A.T. format —
 * regions, Alternatives, Medications, Follow up, Costs (when shown).
 */

import { recKey, regionForRec, type Recommendations, type RecCost } from "@/lib/goat-recs";

export interface AiRecsJson {
  interventions?: Array<{ region?: string; text?: string; cost?: string }>;
  alternatives?: Array<{ label?: string; text?: string; cost?: string }>;
  medications?: string[];
  followUp?: string[];
}

export function recsSystemPrompt(): string {
  return [
    "You read ONE doctor's report and list what the doctor recommends, however it is worded: \"I recommend\", \"Recommend\", \"would be a candidate for\", \"may require\", \"as an alternative\", \"option\", \"consider\", \"plan to\", \"order\". Recommendations can be anywhere: under Plan, Assessment, Recommendations or Orders, or in a \"comment:\" under each numbered diagnosis.",
    "",
    "Reply with JSON only, exactly this shape:",
    '{"interventions":[{"region":"","text":"","cost":""}],"alternatives":[{"label":"","text":"","cost":""}],"medications":[""],"followUp":[""]}',
    "",
    "Rules:",
    "- interventions: each distinct treatment the doctor recommends or plans, once. region: Cervical, Thoracic, Lumbar, Sacrum, Shoulder, Elbow, Wrist/Hand, Hip, Knee or Ankle/Foot (with Right/Left/Bilateral for a limb), or \"\" if none. text: the treatment in the report's own words with its level, side, number of injections or sessions and guidance (e.g. \"Lumbar transforaminal epidural steroid injection at L4-L5 under fluoroscopic guidance, up to 2 injections\"). Leave out the diagnosis name, ICD codes, \"comment:\" and the reason.",
    "- alternatives: anything offered as an alternative, an option, \"candidate for\", or only if something else fails (\"if pain persists\"). label: the report's words for what it replaces or when (\"Alternative to injection therapy\", \"If low back pain persists\"), else \"\".",
    "- cost: that item's fee or cost exactly as written (\"$900 per injection\"), else \"\".",
    "- medications: each medication with its dose as written. followUp: when to return, as written.",
    "- Skip anything that says None. Never add anything that isn't in the report. Copy numbers, levels and dollar amounts exactly.",
  ].join("\n");
}

const EXAMPLE_REPORT = `Assessment and Plan
1. Right shoulder impingement (M75.41)
comment: I recommend an ultrasound guided right subacromial corticosteroid injection. She may require up to 2 injections. The fee is $900.
2. Knee pain
comment: Should the knee pain continue she is a candidate for 6 sessions of physical therapy for the right knee. Cost $120 per session.
Medications: Meloxicam 15 mg daily.
Return in 2 weeks.`;

const EXAMPLE_JSON =
  '{"interventions":[{"region":"Right Shoulder","text":"Ultrasound guided right subacromial corticosteroid injection, may require up to 2 injections","cost":"$900"}],"alternatives":[{"label":"If the knee pain continues","text":"6 sessions of physical therapy for the right knee","cost":"$120 per session"}],"medications":["Meloxicam 15 mg daily"],"followUp":["2 weeks"]}';

export function buildRecsMessages(reportName: string, reportText: string, part?: { n: number; of: number }): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return [
    { role: "system", content: recsSystemPrompt() },
    { role: "user", content: `REPORT (Example.pdf):\n${EXAMPLE_REPORT}` },
    { role: "assistant", content: EXAMPLE_JSON },
    { role: "user", content: `REPORT (${reportName}${part && part.of > 1 ? `, part ${part.n} of ${part.of}` : ""}):\n${reportText}` },
  ];
}

/** The model's reply → JSON (tolerates code fences, chatter and trailing commas). Null when unreadable. */
export function parseRecsJson(reply: string): AiRecsJson | null {
  const t = reply.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  const body = t.slice(a, b + 1).replace(/,\s*([}\]])/g, "$1");
  try {
    const j = JSON.parse(body) as AiRecsJson;
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Checking against the report
// ---------------------------------------------------------------------------

const STOP = new Set(
  "the a an and or of to for with at in on by per as is be was are his her their patient patients up any each that this which from into over under after before then than will would may can should".split(" "),
);

/** Comparable text: lower case, "C6 - C7" → "c6-c7", "six" → "6". */
function norm(s: string): string {
  const words: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twelve: "12", twenty: "20" };
  return s
    .toLowerCase()
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)\b/g, (w) => words[w])
    .replace(/\s*([-–/])\s*/g, "-")
    .replace(/[,$]/g, (c) => (c === "$" ? "$" : ""))
    .replace(/\s+/g, " ");
}

function tokens(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9$.-]+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Numbers, levels and amounts in a piece of text ("c6-c7", "3", "$7000", "10"). */
function figures(s: string): string[] {
  return (norm(s).match(/\$?\d[\d.]*|[a-z]\d{1,2}(?:-[a-z]?\d{1,2})?/g) ?? []).map((f) => f.replace(/\.$/, ""));
}

/** Every number / level / amount in `item` is in the report. */
export function figuresIn(item: string, report: string): boolean {
  const src = norm(report);
  return figures(item).every((f) => {
    const bare = f.replace(/^\$/, "");
    return src.includes(f) || src.includes(bare) || src.includes(bare.replace(/(\d)(?=(\d{3})+$)/g, "$1,"));
  });
}

/** Is this item written in the report? All its figures are, and most of its words. */
export function grounded(item: string, report: string): boolean {
  const src = norm(report);
  const srcTokens = new Set(tokens(report));
  for (const f of figures(item)) {
    const bare = f.replace(/^\$/, "");
    if (!src.includes(f) && !src.includes(bare) && !src.includes(bare.replace(/(\d)(?=(\d{3})+$)/g, "$1,"))) return false;
  }
  const t = tokens(item).filter((w) => !/^\$?\d/.test(w));
  if (!t.length) return false;
  const hit = t.filter((w) => srcTokens.has(w) || [...srcTokens].some((s) => s.length >= 5 && (s.startsWith(w) || w.startsWith(s)))).length;
  return hit / t.length >= 0.7;
}

// ---------------------------------------------------------------------------
// Into the regular format, merged with the rules
// ---------------------------------------------------------------------------

function sentence(s: string): string {
  const t = s.replace(/\s+/g, " ").trim().replace(/^[-–•*,;:\s]+/, "");
  if (!t) return "";
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
}

const REGION_WORD = /^(?:(right|left|bilateral)\s+)?(cervical|thoracic|lumbar|sacrum|sacral|si joint|shoulder|elbow|wrist|hand|wrist\/hand|hip|knee|ankle|foot|ankle\/foot)s?$/i;

function regionHeading(modelRegion: string, text: string): string {
  const r = (modelRegion ?? "").trim();
  if (r && REGION_WORD.test(r)) {
    const viaText = regionForRec(r);
    if (viaText) {
      const side = /^(right|left|bilateral)\b/i.exec(r)?.[1];
      return side && !/^(right|left|bilateral)\b/i.test(viaText) && !/^(Cervical|Thoracic|Lumbar|Sacrum)/.test(viaText)
        ? `${side[0].toUpperCase()}${side.slice(1).toLowerCase()} ${viaText}`
        : viaText;
    }
  }
  return regionForRec(text) || regionForRec(r) || "";
}

/** Shared content words between two items (for de-duplication). */
const PLACE_RE = /\b(cervical|thoracic|lumbar|sacr\w*|shoulder|elbow|wrist|hand|hip|knee|ankle|foot|neck|trapezius|[ctls]\d{1,2}(?:\s*[-/]\s*[ctls]?\d{1,2})?)\b/gi;
function places(s: string): Set<string> {
  return new Set((s.match(PLACE_RE) ?? []).map((p) => p.toLowerCase().replace(/\s+/g, "").replace(/\//g, "-")));
}

function overlap(a: string, b: string): number {
  // Same procedure at a different region or level is a different item.
  const pa = places(a);
  const pb = places(b);
  if (pa.size && pb.size && ![...pa].some((p) => pb.has(p))) return 0;
  const x = new Set(tokens(recKey(a)));
  const y = new Set(tokens(recKey(b)));
  const both = [...x].filter((w) => y.has(w)).length;
  const min = Math.min(x.size, y.size) || 1;
  return Math.max(both / min, both >= 5 ? 1 : 0);
}

function covered(item: string, list: string[]): boolean {
  return list.some((o) => overlap(item, o) >= 0.6);
}

/** Which item each Smart cost belongs to (to name it when its region has several items). */
const costItem = new WeakMap<RecCost, string>();

export interface AiRecsResult {
  recs: Recommendations;
  /** Model items dropped because the report doesn't say them. */
  dropped: string[];
}

/** Model JSON (one or more passes) → checked Recommendations. */
export function recsFromAi(parts: AiRecsJson[], report: string): AiRecsResult {
  const recs: Recommendations = { interventions: [], alternatives: [], medications: [], followUp: [], costs: [], unplaced: [] };
  const dropped: string[] = [];
  const seen: string[] = [];
  const cost = (owner: string, c: string | undefined, itemText: string) => {
    let t = (c ?? "").trim();
    if (!t || !/\$\s?\d/.test(t)) return;
    // "$7000" when the report says "$7000 per injection": keep the "per …".
    if (/^\$\s?[\d,]+(?:\.\d+)?$/.test(t)) {
      const per = new RegExp(`${t.replace(/[$.]/g, "\\$&")}\\s+(per\\s+[a-z]+(?:\\s+[a-z]+)?|each|apiece)`, "i").exec(report.replace(/\s+/g, " "));
      if (per) t = `${t} ${per[1].replace(/\s+(?:and|or|if|the|for|to)$/i, "")}`;
    }
    if (!figuresIn(t, report)) {
      dropped.push(t);
      return;
    }
    if (recs.costs.some((x) => x.owner === owner && x.text === sentence(t))) return;
    const entry = { owner, text: sentence(t) };
    recs.costs.push(entry);
    costItem.set(entry, itemText);
  };
  for (const j of parts) {
    for (const it of j.interventions ?? []) {
      const text = (it.text ?? "").trim();
      if (!text || /^none\b/i.test(text)) continue;
      if (!grounded(text, report)) {
        dropped.push(text);
        continue;
      }
      if (covered(text, seen)) continue;
      seen.push(text);
      const region = regionHeading(it.region ?? "", text);
      recs.interventions.push({ region, text: sentence(text), quote: text });
      cost(region || "Other", it.cost, text);
    }
    for (const it of j.alternatives ?? []) {
      const text = (it.text ?? "").trim();
      if (!text || /^none\b/i.test(text)) continue;
      if (!grounded(text, report)) {
        dropped.push(text);
        continue;
      }
      if (covered(text, seen)) continue;
      seen.push(text);
      const label = sentence(it.label ?? "").replace(/\.$/, "");
      recs.alternatives.push({ label, text: sentence(text), quote: text });
      cost(label || shortName(text), it.cost, text);
    }
    for (const m of j.medications ?? []) {
      if (!m?.trim() || /^none\b/i.test(m.trim())) continue;
      if (!grounded(m, report)) {
        dropped.push(m);
        continue;
      }
      if (!covered(m, recs.medications)) recs.medications.push(sentence(m));
    }
    for (const f of j.followUp ?? []) {
      if (!f?.trim() || /^none\b/i.test(f.trim())) continue;
      if (!grounded(f, report)) {
        dropped.push(f);
        continue;
      }
      if (!covered(f, recs.followUp)) recs.followUp.push(sentence(f.replace(/^(follow[\s-]?up|return)\s*(in\s+)?/i, (m) => (/in\s*$/i.test(m) ? "In " : ""))));
    }
  }
  // Two items in one region each with a cost: name the item so the costs stay apart.
  const perOwner = new Map<string, number>();
  for (const c of recs.costs) perOwner.set(c.owner, (perOwner.get(c.owner) ?? 0) + 1);
  recs.costs = recs.costs.map((c): RecCost => {
    if ((perOwner.get(c.owner) ?? 0) < 2) return c;
    const item = costItem.get(c);
    return item ? { owner: `${c.owner} (${shortName(item)})`, text: c.text, region: c.owner } : c;
  });
  return { recs, dropped };
}

function shortName(text: string): string {
  const words = text.replace(/\.$/, "").split(/\s+/);
  const out: string[] = [];
  for (const w of words) {
    if (out.length && /^(targeting|at|of|under|with|for|to|in|on|totaling|,)$/i.test(w)) break;
    out.push(w.replace(/,$/, ""));
    if (out.length >= 5) break;
  }
  return out.join(" ").toLowerCase();
}

/**
 * Smart items first (checked against the report), then anything the rules
 * found that the model didn't (unless it repeats a Smart item).
 */
export function mergeRecs(ai: Recommendations, rules: Recommendations | null): Recommendations {
  if (!rules) return ai;
  const all = () => [...out.interventions.map((i) => i.text), ...out.alternatives.map((a) => a.text)];
  const out: Recommendations = {
    interventions: [...ai.interventions],
    alternatives: [...ai.alternatives],
    medications: [...ai.medications],
    followUp: [...ai.followUp],
    costs: [...ai.costs],
    unplaced: [],
  };
  for (const i of rules.interventions) {
    const text = cleanRuleText(i.text);
    if (text && !covered(text, all())) out.interventions.push({ ...i, text });
  }
  for (const a of rules.alternatives) {
    const text = cleanRuleText(a.text);
    if (text && !covered(text, all())) out.alternatives.push({ ...a, text });
  }
  for (const m of rules.medications) {
    const text = cleanRuleText(m);
    if (text && !covered(text, out.medications)) out.medications.push(text);
  }
  for (const f of rules.followUp) if (!covered(f, out.followUp)) out.followUp.push(f);
  // A region that now has several items: name the item a Smart cost belongs to.
  out.costs = out.costs.map((c) => {
    const item = costItem.get(c);
    const n = out.interventions.filter((i) => (i.region || "Other") === c.owner).length;
    return item && n > 1 ? { owner: `${c.owner} (${shortName(item)})`, text: c.text, region: c.owner } : c;
  });
  // A cost the model didn't give (its item came from the rules): keep it, named in the regular way.
  const amounts = (t: string) => t.match(/\$\s?[\d,]+/g)?.map((x) => x.replace(/[\s,]/g, "")) ?? [];
  const have = new Set(out.costs.flatMap((c) => amounts(c.text)));
  for (const c of rules.costs) {
    const parts = c.text.split(/(?<=\.)\s+/).filter((p) => amounts(p).some((a) => !have.has(a)));
    if (!parts.length) continue;
    const owner = cleanRuleText(c.owner).replace(/\.$/, "");
    const short = owner.length > 40 ? `${c.region ?? "Other"} (${shortName(owner)})` : owner;
    out.costs.push({ owner: short, text: sentence(parts.join(" ").replace(/^(?:the\s+)?(?:estimated\s+)?cost\s+(?:is|was|:)?\s*/i, "")), region: c.region });
    parts.forEach((p) => amounts(p).forEach((a) => have.add(a)));
  }
  return out;
}

/** Rules wording → the treatment only: no "Diagnosis (M54.12) comment:", "Given …, I recommend". */
export function cleanRuleText(text: string): string {
  const t = text
    .replace(/^.*?\bcomments?\s*:\s*/i, "")
    .replace(/^(?:given|due to|because of|in light of|considering)\b[^,]*,\s*/i, "")
    .replace(/^(?:i|we|dr\.?\s+\w+)\s+(?:would\s+)?(?:recommend|suggest|advise)(?:s|ed)?\s+/i, "")
    .replace(/^(?:recommend|suggest|advise)(?:s|ed)?\s+(?:that\s+)?(?:the patient\s+(?:undergo|have|receive)\s+)?/i, "")
    .replace(/^(?:an?|the)\s+/i, "");
  return sentence(t);
}
