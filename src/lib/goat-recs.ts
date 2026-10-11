/**
 * G.O.A.T. — a doctor's recommendations read out of a report's Plan (pure, no I/O).
 *
 * Output is copy-paste ready for the Specialist box, in a fixed shape:
 *
 *   Cervical
 *   - Right C6-C7 interlaminar epidural injection with leukocyte poor platelet rich plasma.
 *
 *   Right Shoulder
 *   - Ultrasound guided right subacromial bursa PRP injection.
 *
 *   Alternatives
 *   - Alternative to Injection Therapy: Four sessions of … (PENS).
 *
 *   Medications / Follow up / Costs   (only when present)
 *
 * One bullet per distinct planned intervention (repeats under "Planned
 * Intervention" are dropped). Anything offered as an alternative / option /
 * "candidate for" goes under Alternatives, whatever the doctor's wording.
 * The report's own words are kept; nothing is invented.
 */

import { joinWrapped, levelsIn, regionOfLevel, regionsNamedIn, type BodyRegion } from "@/lib/goat-regions";

export interface RecItem {
  /** "Cervical", "Lumbar", "Right Shoulder", "Cervical and Lumbar", or "" when the text never says. */
  region: string;
  text: string;
  /** The sentence it was read from. */
  quote: string;
  /** Name its fees go under ("Cervical (thermal radiofrequency ablation)"); otherwise worked out from the text. */
  costLabel?: string;
}

export interface RecAlternative {
  /** "Alternative to Injection Therapy", or "" when the report gives no "alternative to …". */
  label: string;
  text: string;
  quote: string;
}

export interface RecCost {
  /** What the cost belongs to ("Cervical", "Alternative to Injection Therapy", "Trigger point injection"). */
  owner: string;
  text: string;
  /** Region of the intervention it belongs to, for ordering when the owner is the procedure's name. */
  region?: string;
}

export interface Recommendations {
  interventions: RecItem[];
  alternatives: RecAlternative[];
  medications: string[];
  followUp: string[];
  costs: RecCost[];
  /** Plan sentences the rules didn't place (not obviously a description) — for Smart mode to look at. */
  unplaced: string[];
}

export const DEFAULT_REC_REGION_ORDER = ["Cervical", "Thoracic", "Lumbar", "Sacrum", "Shoulder", "Elbow", "Wrist/Hand", "Hip", "Knee", "Ankle/Foot"];

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** "alternative", "option", "candidate for", "may also consider", "could also benefit", "in lieu of", "instead of" … */
export const ALTERNATIVE_RE =
  /\b(alternatives?|(?:another|other|an|additional|further|treatment|conservative|non-?surgical|surgical)\s+options?|options?\s+(?:is|are|include|would be|of)|candidate for|may (?:also )?(?:consider|benefit)|could (?:also )?(?:consider|benefit)|can (?:also )?consider|might (?:also )?benefit|would (?:also )?benefit|in lieu of|instead of|in place of)\b/i;

const RECOMMEND_RE = /\b(recommend(?:s|ed|ing|ation)?|advis(?:e|ed)|suggest(?:s|ed)?|proceed with|plan(?:ned)? (?:to|for)|schedul(?:e|ed) (?:for|the patient for)|will (?:undergo|proceed|schedule|perform)|refer(?:red)? (?:to|for))\b/i;
/** "Patient may require up to 3 epidurals …" — a note on the intervention before it. */
const MAY_REQUIRE_RE = /^(?:the\s+)?(?:patient|pt|he|she|they)\s+(may|might|will likely|will probably|could)\s+(require|need)\s+(.+?)(?:\s+(?:to|in order to)\s+(?:optimize|achieve|maximize|improve|obtain|get)\b.*)?\.?$/i;
/** Plan comments that aren't recommendations: imaging findings, causation / medico-legal opinion, history. */
const NOT_A_REC_RE =
  /\b(mri findings|x-?ray findings|disc (?:bulge|protrusion|herniation) (?:measur|of \d)|\d(?:\.\d)?\s*mm\b|it is my (?:medical )?opinion|reasonable degree of medical (?:certainty|probability)|precipitating cause|causation|causally related|has failed conservative|failed conservative|risks and benefits)\b/i;
/** "Cervical Radiculopathy [M.54.12]" / "Myofascial Pain [M79.18] comment:" — a numbered Plan diagnosis (One Touch EMR and similar). */
const DIAG_HEAD_RE = /^(.{3,120}?)\s*\[\s*[A-Z]\.?\d{1,2}[\w.]*\s*\](?:\s*(?:comments?|note)\s*:)?\s*/;
const PROCEDURE_RE =
  /\b(injection|block|ablation|radiofrequency|rfa|epidural|esi|prp|platelet|stem cell|surgery|surgical|fusion|discectomy|laminectomy|decompression|arthroscop\w*|therapy|physical therapy|chiropractic|acupuncture|brace|tens|pens|stimulation|mri|ct|x-?rays?|emg|ncv|ncs|medication|naproxen|ibuprofen|gabapentin|cyclobenzaprine|tramadol|meloxicam)\b/i;
const SECTION_RE = /^(medications?|meds|imaging|diagnostics?|referrals?|follow[\s-]?up|return(?: to clinic| visit)?|rtc|disposition)\b\s*[:\-–]?\s*(.*)$/i;
const NONE_RE = /^(none|n\/?a|no(?:ne)? (?:at this time|new)?|nil|-+|\.)?\.?$/i;
const SIGNATURE_RE = /\s*(?:\b[A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z'-]+)+,?\s*(?:M\.?D|D\.?O|D\.?C|PA-?C|NP|DPM)\.?)\s*$/;
// "signed by" only where it ends the report, never inside a per-page "E-signed by Dr. … on 05/30/2026" footer.
const END_RE = /\b(electronically signed|(?<![-\w])signed by|dictated by|cc:|this report was|thank you for (?:the|this) referral|thank you for (?:allowing|letting) me|please do not hesitate|sincerely)\b/i;
/** "[Page 5 of 6] E-signed by …", "Page 2 of 6", "This page was generated at …": printed on every page. */
const PAGE_MARK_RE = /^\s*(?:\[?\s*page\s+\d+\s+(?:of|\/)\s+\d+\s*\]?|this page was (?:generated|printed|created)\b)/i;

/**
 * A follow-on treatment that depends on the first one working:
 * "If the diagnostic injection provides >80% relief, then a thermal radiofrequency ablation ensues with a cost estimate of …".
 * The condition has to be about the result (relief / response / improvement …), so
 * "If performed in a surgical center then fees are …" is not one.
 */
const CONDITIONAL_RE =
  /^(?:if|should|once|when)\s+(?:the\s+)?([^,]{3,120}?\b(?:relief|response|responds?|improvement|improves?|benefit|positive|successful|effective|helps?|fails?|failed)\b[^,]{0,60}?)\s*,\s*(?:then\s+)?(?:(?:we|i)\s+(?:would|will|can|may|could)\s+(?:recommend|proceed with|consider|perform|schedule)\s+|(?:the patient|patient|he|she|they)\s+(?:would|will|may|could|can)\s+(?:be (?:a )?candidates? for|undergo|proceed with|receive|need)\s+|(?:i |we )?recommend\s+)?(?:a|an|the)?\s*(.+)$/i;
/** Where the procedure's name ends in that sentence ("… ablation ensues with a cost estimate …" → "… ablation"). */
const CONDITIONAL_END_RE =
  /\s+(?:ensues|follows|will|would|can|may|could|should|is|are|to be|was|were|be|with (?:a|an)?\s*(?:estimated )?(?:cost|fee|price)|at (?:a|an)?\s*(?:estimated )?(?:cost|fee)|for (?:a|an)?\s*(?:estimated )?(?:cost|fee)|costing)\b|\s*[,;]|\.\s*$/i;
/** Never a recommendation: "No specific intervention mentioned.", "Not documented.", "N/A". */
const FILLER_RE =
  /^(?:(?:no|none)\b.{0,60}\b(?:mentioned|specified|noted|documented|indicated|stated|given|provided|listed|found|available)|not (?:mentioned|specified|documented|stated|provided|available)|n\/a|unknown|unspecified)\b[.\s]*$/i;
/** "Medications Prescribed  SIG  PRN?  Indication": the prescription table EMRs print after the signature. */
const PRESCRIBED_HEAD_RE = /^\s*(?:medications?|meds|prescriptions?)\s+(?:prescribed|ordered|e-?prescribed)\b/i;
const DRUG_LINE_RE = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|%|units?)\b|\b(?:tablets?|tabs?|capsules?|caps|cream|gel|patch|ointment|solution)\b/i;

const SMALL_WORDS = new Set(["and", "or", "of", "to", "the", "for", "in", "on", "a", "an", "with"]);

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : /^[A-Z0-9/()-]{2,}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function sentenceCase(s: string): string {
  const t = s.trim().replace(/^[-–•*,;:\s]+/, "").replace(/\s+/g, " ");
  if (!t) return "";
  const withCap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?)]$/.test(withCap) ? (withCap.endsWith(")") ? `${withCap}.` : withCap) : `${withCap}.`;
}

/** Comparable form for de-duplication. */
export function recKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(recommend(?:s|ed)?|planned intervention|the patient|patient'?s?|is a candidate for|candidate for|a|an|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameItem(a: string, b: string): boolean {
  const x = recKey(a);
  const y = recKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 20 && long.includes(short);
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

const EXTRA_REGION: Array<[BodyRegion, RegExp]> = [
  ["Shoulder", /\b(subacromial|glenohumeral|acromioclavicular|rotator cuff|bursa of the shoulder)\b/i],
  ["Sacrum", /\b(si joint|sacroiliac)\b/i],
  ["Knee", /\b(genicular|patell\w+|menisc\w+)\b/i],
  ["Wrist", /\bcarpal tunnel\b/i],
];

function headingOf(region: BodyRegion): string {
  return region === "Wrist" || region === "Hand" ? "Wrist/Hand" : region === "Ankle" || region === "Foot" ? "Ankle/Foot" : region;
}

const LIMB = new Set(["Shoulder", "Elbow", "Wrist/Hand", "Hip", "Knee", "Ankle/Foot", "Humerus", "Forearm", "Femur", "Tibia/Fibula"]);

/** Region heading for an item: "Cervical", "Right Shoulder", "Cervical and Lumbar", or "". */
export function regionForRec(text: string, context = ""): string {
  const find = (s: string): string[] => {
    const found: BodyRegion[] = [...levelsIn(s).map(regionOfLevel).filter((r): r is BodyRegion => r !== null), ...regionsNamedIn(s)];
    for (const [r, re] of EXTRA_REGION) if (re.test(s)) found.push(r);
    return [...new Set(found.filter((r) => r !== "Brain" && r !== "Chest").map(headingOf))];
  };
  let regions = find(text);
  if (!regions.length) regions = find(context);
  if (!regions.length) return "";
  const named = (r: string) => {
    if (!LIMB.has(r)) return r;
    const side = /\bbilateral\b/i.test(text) ? "Bilateral" : /\bright\b/i.test(text) ? "Right" : /\bleft\b/i.test(text) ? "Left" : /\bright\b/i.test(context) ? "Right" : /\bleft\b/i.test(context) ? "Left" : "";
    return side ? `${side} ${r}` : r;
  };
  const order = (r: string) => {
    const i = DEFAULT_REC_REGION_ORDER.indexOf(r);
    return i < 0 ? 99 : i;
  };
  const sorted = regions.sort((a, b) => order(a) - order(b)).map(named);
  return sorted.length > 1 ? `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}` : sorted[0];
}

// ---------------------------------------------------------------------------
// Reading the Plan
// ---------------------------------------------------------------------------

const PLAN_HEAD = /\b(plan\s*\/\s*orders|plan of care|plan and recommendations|treatment plan|treatment recommendations|recommendations?|plan)\s*:/i;
/**
 * A heading on its own line, with or without a colon, as EMRs print them:
 * "Plan", "Assessment and Plan", "A/P", "Impression/Plan", "Treatment Plan",
 * "Recommendations", "Orders".
 */
const PLAN_LINE =
  /^[ \t]*(?:\d{1,2}[.)]\s*)?(assessment\s*(?:and|&|\/)\s*plan|a\s*\/\s*p|a\s*&\s*p|impression\s*(?:and|&|\/)\s*plan|plan\s*\/\s*orders|plan of care|plan and recommendations|treatment plan|treatment recommendations|recommendations?|orders|plan)[ \t]*:?[ \t]*$/im;

/** "C6 - C7" / "C6 – 7" → "C6-C7" so a spaced level isn't read as a dash bullet. */
export function normalizeLevels(text: string): string {
  return (text ?? "").replace(/\b([CTLS])(\d{1,2})\s*[-–]\s*([CTLS]?)(\d{1,2})\b/g, (_m, a: string, n1: string, b: string, n2: string) => `${a}${n1}-${b || a}${n2}`);
}

/**
 * Take out what an EMR prints on every page (letterhead, "Patient: … DOB: …",
 * "[Page 5 of 6] E-signed by …"). A PDF reader puts it in the middle of the
 * text wherever a page breaks, which used to cut a Plan off after its first item.
 * Only lines right before a page mark that repeat on most pages are dropped,
 * so a sentence the doctor wrote twice (two identical fee lines) stays.
 */
export function stripPageFurniture(text: string): string {
  const lines = (text ?? "").replace(/\r/g, "").split("\n");
  const norm = (l: string) => l.replace(/\s+/g, " ").trim().toLowerCase();
  const marks = lines.map((l, i) => (PAGE_MARK_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!marks.length) return text ?? "";
  const counts = new Map<string, number>();
  for (const l of lines) {
    const k = norm(l);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const pages = marks.filter((i) => /page\s+\d/i.test(lines[i])).length || marks.length;
  const minRepeat = Math.max(2, Math.ceil(pages * 0.6));
  const drop = new Set<number>(marks);
  for (const m of marks) {
    // The header block sits just before the mark: walk back over lines that repeat on most pages.
    for (let i = m - 1, seen = 0; i >= 0 && seen < 8; i--) {
      const k = norm(lines[i]);
      if (!k) continue;
      if (drop.has(i)) continue;
      if ((counts.get(k) ?? 0) < minRepeat) break;
      drop.add(i);
      seen++;
    }
  }
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

/** The Plan / Recommendations part of a report (whole text when there's no such heading). */
export function planSection(text: string): string {
  const flat = normalizeLevels(stripPageFurniture(text).replace(/\r/g, ""));
  const m = PLAN_HEAD.exec(flat);
  const line = PLAN_LINE.exec(flat);
  const start = [m ? { i: m.index, len: m[0].length } : null, line ? { i: line.index, len: line[0].length } : null]
    .filter((x): x is { i: number; len: number } => x !== null)
    .sort((a, b) => a.i - b.i)[0];
  let out = start ? flat.slice(start.i + start.len) : flat;
  const end = END_RE.exec(out);
  if (end) out = out.slice(0, end.index);
  return out;
}

/** Whole report minus the signature block (for the fallback scan). */
function wholeReport(text: string): string {
  const flat = normalizeLevels(stripPageFurniture(text).replace(/\r/g, ""));
  // A closing line near the top ("Thank you for allowing me to see …") isn't the end of the report.
  const re = new RegExp(END_RE.source, "gi");
  let end: RegExpExecArray | null;
  while ((end = re.exec(flat))) if (end.index >= flat.length * 0.4) return flat.slice(0, end.index);
  return flat;
}

function segments(plan: string): string[] {
  // Lines first (wrapped lines joined back into sentences), then items within a line.
  // A line that starts lower-case continues the previous one ("-For the patients cervical" / "radiculopathy: …").
  const lines = plan.replace(/([^.:;!?\n])\s*\n\s*(?=[a-z])/g, "$1 ").split(/\n/);
  return joinWrapped(lines)
    .flatMap((line) =>
      line
        // numbered items "1. Planned intervention:" "2. Medications None"
        .split(/(?:^|\s)\(?\d{1,2}[.)]\s+(?=[A-Z])/)
        // dash bullets "-For the patient's …" (not "C6-C7", "2-4")
        .flatMap((s) => s.split(/(?<![A-Za-z0-9])[-–•]\s*(?=[A-Z])/))
        // "… injection. Planned Intervention: …" run together on one line
        .flatMap((s) => s.split(/\s+(?=Planned Interventions?\s*:)/i)),
    )
    .map((s) => s.trim())
    .filter(Boolean);
}

function sentences(s: string): string[] {
  return s
    .split(/(?<=[.!?])\s+(?=[A-Z(])(?<!\b(?:Dr|Mr|Mrs|Ms|vs|approx|e\.g|i\.e)\.\s+)/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** "Considering MRI findings …, recommend X" → ["Considering MRI findings …", "recommend X"]. */
function splitLeadIn(s: string): { lead: string; rest: string } {
  const m = /^([^.]{6,200}?),\s*(?=(?:i |we )?(?:would |also |strongly |therefore )*(?:recommend(?:s|ed)?|advise[sd]?|suggest(?:s|ed)?)\b)/i.exec(s);
  return m ? { lead: m[1], rest: s.slice(m[0].length) } : { lead: "", rest: s };
}

function cleanIntervention(s: string): string {
  let t = splitLeadIn(s)
    .rest.replace(/^(?:planned interventions?|interventions?|procedures?)\s*:\s*/i, "")
    .replace(/^(?:for (?:the )?(?:patient'?s'?|pt'?s|his|her|their)\s+[^:]{2,80}:\s*)/i, "")
    .replace(/^(?:at this time,?\s*)?(?:i |we )?(?:would |also |strongly |therefore )*(?:recommend(?:s|ed)?|advise[sd]?|suggest(?:s|ed)?)\s+(?:that\s+)?(?:the patient\s+(?:undergo(?:es)?|receive|have|proceed with|get)\s+|(?:he|she|they)\s+(?:undergo|receive|have)\s+)?/i, "");
  t = t.replace(/^(?:a|an)\s+(?=[a-z])/i, "");
  // "… totaling 3 muscle groups for myofascial pain treatment." → the diagnosis is the heading's job.
  t = t.replace(/\s+for\s+(?:the\s+)?(?:treatment of\s+)?(?:his|her|their|the patient'?s\s+)?[a-z][a-z\s/-]{2,40}?\s+(?:treatment|management)\.?$/i, "");
  return sentenceCase(t);
}

/** "Trigger point injection of upper neck …" → "Trigger point injection". */
function shortName(text: string): string {
  return text
    .replace(/\.$/, "")
    .replace(/\s*\([^)]*\)/g, "")
    .split(/\s+(?:of|targeting|with|to|at|in|for|under)\s+|,/)[0]
    .trim();
}

function altParts(s: string, carriedLabel: string): { label: string; text: string } {
  const lab = /\b(?:as an? |an? )?alternatives? (?:to|for) ([^,.:;]{2,60}?)(?:,|:|\s+(?=the patient|patient|he|she|we|i)\b)/i.exec(s) ?? /\b(?:in lieu of|instead of|in place of) ([^,.:;]{2,60}?)(?:,|:)/i.exec(s);
  let label = carriedLabel;
  let rest = s;
  if (lab) {
    const what = lab[1].replace(/\s+(?:procedures?|options?|treatments?|modalities)$/i, "").trim();
    label = `Alternative to ${titleCase(what)}`;
    rest = s.slice((lab.index ?? 0) + lab[0].length);
  }
  rest = rest.replace(/^\s*[,:]\s*/, "");
  const lead =
    /\b(?:is|are|was|were|would be|may be|could be)?\s*(?:also\s+)?(?:a\s+)?(?:good\s+)?candidates? for\s+(.+)$/i.exec(rest) ??
    /\b(?:may|could|can|might|would)\s+(?:also\s+)?(?:consider|benefit from|try)\s+(.+)$/i.exec(rest) ??
    /\b(?:another |other |an |additional |further )?options?\s+(?:is|are|include[sd]?|would be|of)\s+(.+)$/i.exec(rest);
  let text = lead ? lead[1] : rest;
  text = text.replace(/\s+(?:was|were|is|are|has been|have been|can be|could be|may be|will be|would be)\s+(?:discussed|considered|offered|recommended|reviewed|explained|mentioned|presented)\b.*$/i, "");
  text = text.replace(/^(?:the patient|patient)\s+(?:is|was)\s+(?:also\s+)?/i, "");
  return { label, text: sentenceCase(text) };
}

/**
 * Read a report's Plan into recommendations.
 */
export function extractRecommendations(reportText: string): Recommendations {
  const fromPlan = readRecommendations(planSection(reportText));
  let recs = fromPlan;
  if (!fromPlan.interventions.length && !fromPlan.alternatives.length) {
    // No Plan heading, or a Plan the rules couldn't read: any recommendation sentence anywhere in the report.
    const whole = readRecommendations(wholeReport(reportText));
    if (whole.interventions.length || whole.alternatives.length) recs = whole;
  }
  // The Plan names no medication: the report's own prescription table ("Medications Prescribed  SIG …"), if it has one.
  if (!recs.medications.length) recs.medications = prescribedMedications(reportText);
  return withoutFiller(recs);
}

/** Drop anything that only says there's nothing ("No specific intervention mentioned."). */
function withoutFiller(recs: Recommendations): Recommendations {
  const real = (t: string) => !FILLER_RE.test(t.trim());
  return {
    ...recs,
    interventions: recs.interventions.filter((i) => real(i.text)),
    alternatives: recs.alternatives.filter((a) => real(a.text)),
    medications: recs.medications.filter(real),
    followUp: recs.followUp.filter(real),
  };
}

/**
 * Rows of a "Medications Prescribed  SIG  PRN?  Indication" table:
 * "methocarbamol 500 mg tablet One tablet TID" / "PRN No" → "Methocarbamol 500 mg tablet One tablet TID."
 */
export function prescribedMedications(reportText: string): string[] {
  const lines = stripPageFurniture(reportText ?? "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!PRESCRIBED_HEAD_RE.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length && j <= i + 12; j++) {
      const line = lines[j].replace(/\s+/g, " ").trim();
      if (!line) break;
      // The PRN? / Indication columns wrapped onto their own line.
      if (/^(?:prn\??\s*)?(?:yes|no|y|n)$/i.test(line)) continue;
      // The next table or section.
      if (/^(?:type\s+code|icd|cpt|allerg|vitals?|diagnos|procedures?|orders?|plan|assessment)\b/i.test(line) || /^[A-Z][A-Za-z ]{2,40}:\s*$/.test(line)) break;
      if (!DRUG_LINE_RE.test(line)) continue;
      const med = sentenceCase(line.replace(/\s+(?:prn\??\s+)?(?:yes|no)$/i, ""));
      if (med && !out.some((m) => recKey(m) === recKey(med))) out.push(med);
    }
  }
  return out;
}

function readRecommendations(plan: string): Recommendations {
  const out: Recommendations = { interventions: [], alternatives: [], medications: [], followUp: [], costs: [], unplaced: [] };
  let lastOwner = "";
  let lastItem: RecItem | null = null;
  let diagnosis = "";
  // "2. Medications:" with the drug on the next line(s): those lines belong to it until the next heading.
  let openSection: "med" | "follow" | null = null;

  const addIntervention = (text: string, context: string, quote: string) => {
    if (!text || text.length < 6) return;
    const dup = out.interventions.find((x) => sameItem(x.text, text));
    const region = regionForRec(text, context);
    if (dup) {
      if (!dup.region && region) dup.region = region;
      lastOwner = dup.region || lastOwner;
      lastItem = dup;
      return;
    }
    if (out.alternatives.some((a) => sameItem(a.text, text))) return;
    const item = { region, text, quote };
    out.interventions.push(item);
    lastOwner = region || "Recommendation";
    lastItem = item;
  };
  const addNote = (note: string) => {
    if (!lastItem) return false;
    const n = note.replace(/\.$/, "").trim();
    if (!n || lastItem.text.toLowerCase().includes(n.toLowerCase())) return true;
    lastItem.text = `${lastItem.text.replace(/\.$/, "")} (${n}).`;
    return true;
  };
  const addAlternative = (label: string, text: string, quote: string) => {
    if (!text || text.length < 4) return;
    const dup = out.alternatives.find((x) => sameItem(x.text, text));
    if (dup) {
      if (!dup.label && label) dup.label = label;
      lastOwner = dup.label || "Alternative";
      return;
    }
    // Offered as an alternative after all: take it out of the interventions.
    out.interventions = out.interventions.filter((x) => !sameItem(x.text, text));
    out.alternatives.push({ label, text, quote });
    lastOwner = label || "Alternative";
    lastItem = null;
  };
  const addCost = (text: string) => {
    let owner = lastOwner || "Costs";
    let body = text;
    let region: string | undefined = lastItem?.region || undefined;
    // "Professional fee for cervical epidural steroid injection is $7000 per injection."
    const named = /\b(?:fees?|costs?|charges?|expenses?)\s+(?:for|of)\s+(?:the\s+|an?\s+)?([a-z][^$.]{3,80}?)\s+(?:is|are|will be|would be|runs?)\s+(.*\$.*)$/i.exec(text);
    if (named) {
      owner = sentenceCase(named[1]).replace(/\.$/, "");
      body = named[2];
      const match = out.interventions.find((i) => recKey(i.text).includes(recKey(named[1])));
      region = match?.region || regionForRec(named[1]) || region;
    } else if (lastItem && lastItem.region && out.interventions.filter((i) => i.region === lastItem!.region).length > 1) {
      // Two procedures under one region: say which one the fee is for.
      owner = shortName(lastItem.text);
    }
    if (!named && lastItem?.costLabel) owner = lastItem.costLabel;
    const prev = out.costs.find((c) => c.owner === owner);
    const t = sentenceCase(body);
    if (prev) {
      if (!prev.text.includes(t)) prev.text = `${prev.text} ${t}`;
    } else out.costs.push({ owner, text: t, ...(region && owner !== region ? { region } : {}) });
  };

  for (const rawSeg of segments(plan)) {
    let seg = rawSeg.replace(SIGNATURE_RE, "").trim();
    if (!seg) continue;
    // "Cervical Radiculopathy [M.54.12] comment: …": the diagnosis gives the items under it their region.
    const diag = DIAG_HEAD_RE.exec(seg);
    if (diag) {
      diagnosis = diag[1].trim();
      lastItem = null;
      seg = seg.slice(diag[0].length).trim();
      if (!seg) continue;
    }
    seg = seg.replace(/^(?:comments?|note)\s*:\s*/i, "");
    if (!seg) continue;
    // Medications / Imaging / Referrals / Follow up
    const sec = SECTION_RE.exec(seg);
    if (!sec && openSection && !/^(?:planned interventions?|interventions?|procedures? planned)\s*:/i.test(seg) && !/\$\s?\d/.test(seg) && !RECOMMEND_RE.test(seg)) {
      // The line under "Medications:" / "Follow up:".
      const t = seg.replace(/^(?:comments?|note)\s*:\s*/i, "").trim();
      if (!NONE_RE.test(t)) {
        if (openSection === "med") out.medications.push(...t.split(/;\s*/).map(sentenceCase).filter(Boolean));
        else out.followUp.push(sentenceCase(t));
      }
      continue;
    }
    openSection = null;
    if (sec) {
      const kind = sec[1].toLowerCase();
      const rest = sec[2].replace(SIGNATURE_RE, "").trim();
      if (/^med/.test(kind)) {
        if (!rest) openSection = "med";
        else if (!NONE_RE.test(rest)) out.medications.push(...rest.split(/;\s*|,\s+(?=[A-Z])/).map(sentenceCase).filter(Boolean));
        continue;
      }
      if (/^(follow|return|rtc)/.test(kind)) {
        const t = rest.replace(/^(?:in|within|after)\s+/i, (m) => m);
        if (!t) openSection = "follow";
        else if (!NONE_RE.test(t)) out.followUp.push(sentenceCase(t));
        continue;
      }
      // Imaging / Referrals "None": nothing to show; anything else is read as a recommendation below.
      if (NONE_RE.test(rest)) continue;
      seg = rest;
    }
    let planned = false;
    let context = "";
    let carriedAlt = "";
    const plannedHead = /^(?:planned interventions?|interventions?|procedures? planned)\s*:\s*/i.exec(seg);
    if (plannedHead) {
      planned = true;
      seg = seg.slice(plannedHead[0].length);
    }
    const forHead = /^for (?:the )?(?:patient'?s'?|pt'?s|his|her|their)\s+([^:]{2,80}):\s*/i.exec(seg);
    if (forHead) {
      context = forHead[1];
      seg = seg.slice(forHead[0].length);
    } else if (diagnosis) context = diagnosis;
    const altHead = /^(alternatives?(?:\s+(?:to|for)\s+[^:]{2,60})?)\s*:\s*/i.exec(seg);
    if (altHead) {
      const what = /(?:to|for)\s+(.+)$/i.exec(altHead[1]);
      carriedAlt = what ? `Alternative to ${titleCase(what[1].replace(/\s+(?:procedures?|options?|treatments?)$/i, ""))}` : "";
      seg = seg.slice(altHead[0].length);
    }
    const ss = sentences(seg);
    let placedInSeg = false;
    for (const s of ss) {
      // "… Medications: Naproxen 500 mg. Return to clinic in 4 weeks." inside one paragraph.
      const inSec = SECTION_RE.exec(s);
      if (inSec && /^(med|follow|return|rtc)/i.test(inSec[1])) {
        const rest = inSec[2].replace(SIGNATURE_RE, "").trim();
        if (!NONE_RE.test(rest)) (/^med/i.test(inSec[1]) ? out.medications : out.followUp).push(sentenceCase(rest));
        continue;
      }
      // "If the diagnostic injection provides >80% relief, then a thermal radiofrequency ablation ensues …":
      // its own bullet under the same region, with the condition, and its fee under its name.
      const cond = CONDITIONAL_RE.exec(s);
      if (cond) {
        const what = cond[2].split(CONDITIONAL_END_RE)[0].trim();
        if (what.length >= 6 && PROCEDURE_RE.test(what) && !/\$/.test(what)) {
          const region = regionForRec(what, lastItem?.region || context || diagnosis);
          const condition = cond[1].replace(/\s+/g, " ").trim();
          const text = `${sentenceCase(what).replace(/\.$/, "")} (if ${condition}).`;
          let item = out.interventions.find((x) => x.region === region && recKey(x.text) === recKey(text)) ?? null;
          if (!item) {
            item = { region, text, quote: s, costLabel: region ? `${region} (${what.charAt(0).toLowerCase()}${what.slice(1)})` : sentenceCase(what).replace(/\.$/, "") };
            out.interventions.push(item);
          }
          lastItem = item;
          lastOwner = region || "Recommendation";
          const fee = /\b(?:(?:with|at|for)\s+(?:a|an)\s+)?((?:estimated\s+)?(?:cost|fee|price|charge)s?\b.*\$.*)$/i.exec(s);
          if (fee) addCost(fee[1]);
          placedInSeg = true;
          continue;
        }
      }
      if (/\$\s?\d/.test(s) || /\b(fees?|cost|expenses?|charges?)\b.*\b\d[\d,]{2,}\b/i.test(s)) {
        addCost(s);
        continue;
      }
      const may = MAY_REQUIRE_RE.exec(s);
      if (may && !ALTERNATIVE_RE.test(s)) {
        const note = `${may[1].toLowerCase()} ${may[2].toLowerCase()} ${may[3]}`;
        if (addNote(note)) continue;
      }
      const altHere = ALTERNATIVE_RE.test(s);
      if (altHead || altHere) {
        // Under an "Alternative to …:" label only the first sentence names it; the rest describe it.
        if (!placedInSeg || (altHere && !altHead)) {
          const { label, text } = altParts(s, carriedAlt);
          addAlternative(label, text, s);
          placedInSeg = true;
        }
        continue;
      }
      if (planned || RECOMMEND_RE.test(s) || may) {
        if (!placedInSeg || RECOMMEND_RE.test(s) || may) {
          const lead = splitLeadIn(s).lead;
          addIntervention(cleanIntervention(s), [context, lead].filter(Boolean).join(" "), s);
          placedInSeg = true;
        }
        continue;
      }
      if (NOT_A_REC_RE.test(s)) continue;
      if (!placedInSeg && PROCEDURE_RE.test(s)) out.unplaced.push(s);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface RecFormatOptions {
  /** Region order (Settings → G.O.A.T. in Smart mode); defaults to head-to-toe. */
  regionOrder?: string[];
  showCosts?: boolean;
}

export interface RecBlock {
  heading: string;
  items: string[];
}

function regionRank(heading: string, order: string[]): number {
  const base = heading.replace(/^(?:Right|Left|Bilateral)\s+/, "").split(/,| and /)[0].trim();
  const i = order.findIndex((o) => o.toLowerCase() === base.toLowerCase() || o.split("/").some((p) => p.toLowerCase() === base.toLowerCase()));
  return i < 0 ? 98 : i;
}

/** Recommendations → headed blocks in the fixed order: regions, Alternatives, Medications, Follow up, Costs. */
export function recommendationBlocksFrom(recs: Recommendations, opts: RecFormatOptions = {}): RecBlock[] {
  let order = opts.regionOrder?.length ? opts.regionOrder : DEFAULT_REC_REGION_ORDER;
  // The office's order (Settings → G.O.A.T.) has no Sacrum (SI joint): keep it right after Lumbar.
  if (!order.some((o) => o.toLowerCase() === "sacrum")) {
    const at = order.findIndex((o) => o.toLowerCase() === "lumbar");
    order = at >= 0 ? [...order.slice(0, at + 1), "Sacrum", ...order.slice(at + 1)] : order;
  }
  const byRegion = new Map<string, string[]>();
  for (const it of recs.interventions) {
    const h = it.region || "Other";
    byRegion.set(h, [...(byRegion.get(h) ?? []), it.text]);
  }
  const blocks: RecBlock[] = [...byRegion.entries()]
    .sort((a, b) => (a[0] === "Other" ? 99 : regionRank(a[0], order)) - (b[0] === "Other" ? 99 : regionRank(b[0], order)))
    .map(([heading, items]) => ({ heading, items }));
  if (recs.alternatives.length) blocks.push({ heading: "Alternatives", items: recs.alternatives.map((a) => (a.label ? `${a.label}: ${a.text}` : a.text)) });
  if (recs.medications.length) blocks.push({ heading: "Medications", items: recs.medications });
  if (recs.followUp.length) blocks.push({ heading: "Follow up", items: recs.followUp });
  if (opts.showCosts !== false && recs.costs.length) {
    // Same order as above: regions, then alternatives, then anything else.
    const rank = (c: RecCost) => {
      const r = blocks.findIndex((b) => b.heading === c.owner || (c.region !== undefined && b.heading === c.region) || c.owner.startsWith(`${b.heading} (`));
      if (r >= 0) return r;
      const a = recs.alternatives.findIndex((x) => x.label === c.owner);
      return a >= 0 ? 100 + a : 200;
    };
    const costs = [...recs.costs].sort((a, b) => rank(a) - rank(b));
    blocks.push({ heading: "Costs", items: costs.map((c) => `${c.owner}: ${c.text}`) });
  }
  return blocks;
}

/** Plain text, copy-paste ready for the Specialist box. */
export function recommendationsText(blocks: RecBlock[]): string {
  return blocks.map((b) => `${b.heading}\n${b.items.map((i) => `- ${i}`).join("\n")}`).join("\n\n");
}
