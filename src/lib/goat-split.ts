import { to12hLabel } from "@/lib/time-12h";
import type { GoatContext } from "@/lib/goat";
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

// ---------------------------------------------------------------------------
// "when was his PM appt" / "XR date" / "ortho appt": only that kind's dates,
// not every visit. Reads the specialist / imaging panels, the patient's
// appointments of that type, and report files of that kind.
// ---------------------------------------------------------------------------

const WHEN = /\b(when|date|dates|appt|appts|appointment|appointments|visit|visits|seen|done|scheduled|went)\b/i;

interface Kind {
  label: string;
  /** Imaging modality or specialist specialty / name. */
  match: RegExp;
  imaging: boolean;
}

function kindOf(question: string): Kind | null {
  const d = docTerm(question);
  switch (d) {
    case "x-ray":
      return { label: "X-ray", match: /x-?ray|(^|[^a-z])xr([^a-z]|$)|radiograph/i, imaging: true };
    case "MRI":
      return { label: "MRI", match: /(^|[^a-z])mri([^a-z]|$)/i, imaging: true };
    case "CT":
      return { label: "CT", match: /(^|[^a-z])ct([^a-z]|$)/i, imaging: true };
    case "pain management":
      return { label: "Pain management", match: /pain|(^|[^a-z])pm([^a-z]|$)/i, imaging: false };
    case "orthopedic":
      return { label: "Orthopedic", match: /ortho/i, imaging: false };
    case "neurology":
      return { label: "Neurology", match: /neuro/i, imaging: false };
    default:
      return null;
  }
}

/** Is this a "when was the <kind> appointment / date" question (not about the report's content)? */
export function isTypedDateQuestion(question: string): boolean {
  return Boolean(kindOf(question)) && WHEN.test(question) && !DOC_CONTENT.test(question);
}

function usDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/** A report file's own date (Date of Service / Exam Date, else the date in its name). */
function fileDate(name: string, firstPage: string): string {
  const m = /(?:date of (?:service|exam|visit)|exam date|dos)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(firstPage) ?? /(\d{2})[-_.](\d{2})[-_.](\d{4})/.exec(name);
  if (!m) return "";
  return m.length > 3 ? `${m[1]}/${m[2]}/${m[3]}` : m[1];
}

/** Lines answering only that kind's dates, or null when this isn't such a question. */
export function typedDateAnswer(ctx: GoatContext, question: string): string | null {
  if (!isTypedDateQuestion(question)) return null;
  const kind = kindOf(question)!;
  const lines: string[] = [];
  const add = (label: string, v: string) => v && lines.push(`- ${label}: ${v}`);
  if (kind.imaging) {
    for (const im of ctx.imaging.filter((i) => kind.match.test(i.modality))) {
      lines.push(`${im.modality}${im.center ? ` (${im.center}` : ""}${im.regions.length ? `${im.center ? " · " : " ("}${im.regions.join(", ")}` : ""}${im.center || im.regions.length ? ")" : ""}`);
      add("Ordered", im.sentDate);
      add("Scheduled", im.scheduledDate);
      add("Done", im.doneDate);
      add("Report received", im.reportReceivedDate);
      add("Report reviewed", im.reportReviewedDate);
      if (im.refused) lines.push("- Patient refused.");
    }
  } else {
    const specialtyOf = (name: string) => ctx.people?.find((p) => name.toLowerCase().includes(p.name.toLowerCase()))?.specialty ?? "";
    for (const sp of ctx.specialists.filter((s) => kind.match.test(s.name) || kind.match.test(specialtyOf(s.name)))) {
      lines.push(sp.name);
      add("Referral sent", sp.sentDate);
      add("Appointment", sp.scheduledDate);
      add("Seen", sp.completedDate);
      add("Report received", sp.reportReceivedDate);
      add("Report reviewed", sp.reportReviewedDate);
      if (sp.refused) lines.push("- Patient refused.");
    }
  }
  // Office appointments of that type (e.g. "X-Ray" visits in the schedule).
  const appts = (ctx.appointments ?? []).filter((a) => kind.match.test(a.type));
  if (appts.length) {
    lines.push(`${kind.label} appointments in the schedule`);
    for (const a of appts.slice(-6)) lines.push(`- ${usDay(a.date)}${a.startTime ? ` ${to12hLabel(a.startTime)}` : ""}: ${a.type} (${a.status})`);
  }
  // Report files of that kind and their own dates.
  const files = (ctx.files ?? []).filter((f) => kind.match.test(f.name) || (kind.imaging ? false : kind.match.test(f.folder) && kind.match.test(f.pages?.[0] ?? "")));
  const dated = files.map((f) => ({ f, d: fileDate(f.name, f.pages?.[0] ?? "") })).filter((x) => x.d);
  if (dated.length) {
    lines.push(`${kind.label} reports in Patient Files`);
    for (const { f, d } of dated.slice(0, 4)) lines.push(`- ${d}: ${f.name}`);
  }
  return lines.length ? `${kind.label} dates\n${lines.join("\n")}` : `I couldn't find a ${kind.label.toLowerCase()} appointment or report date in this patient's file.`;
}
