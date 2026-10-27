/**
 * Case number format.
 *
 * Today's case number is built from the date of injury and the patient's name:
 * 071826SMJO = 07/18/26 (MMDDYY) + first 2 letters of the last name (SM) +
 * first 2 letters of the first name (JO). That stays the default, exactly.
 *
 * An office can change the format in Settings → Office → Case number format
 * using simple tokens. A new format applies to NEW patients only: the format
 * (and counter) in force is stamped on the patient when they're created
 * (matrix.caseNumberFormat / matrix.caseSeq), and a patient with no stamp keeps
 * the original format forever. So editing the format can never rename an
 * existing case, its files, or its folder.
 */

export const DEFAULT_CASE_NUMBER_FORMAT = "{MMDDYY}{LAST2}{FIRST2}";

export interface CaseNumberToken {
  token: string;
  meaning: string;
}

export const CASE_NUMBER_TOKENS: CaseNumberToken[] = [
  { token: "{MMDDYY}", meaning: "Date of injury, e.g. 071826" },
  { token: "{MMDDYYYY}", meaning: "Date of injury, e.g. 07182026" },
  { token: "{YYYY}", meaning: "Injury year, e.g. 2026" },
  { token: "{YY}", meaning: "Injury year, e.g. 26" },
  { token: "{MM}", meaning: "Injury month, e.g. 07" },
  { token: "{DD}", meaning: "Injury day, e.g. 18" },
  { token: "{LAST1}", meaning: "First letter of last name" },
  { token: "{LAST2}", meaning: "First 2 letters of last name" },
  { token: "{LAST3}", meaning: "First 3 letters of last name" },
  { token: "{LAST}", meaning: "Whole last name (letters only)" },
  { token: "{FIRST1}", meaning: "First letter of first name" },
  { token: "{FIRST2}", meaning: "First 2 letters of first name" },
  { token: "{FIRST3}", meaning: "First 3 letters of first name" },
  { token: "{FIRST}", meaning: "Whole first name (letters only)" },
  { token: "{N}", meaning: "Counter: 1, 2, 3… (next new patient)" },
  { token: "{N3}", meaning: "Counter, 3 digits: 001, 002…" },
  { token: "{N4}", meaning: "Counter, 4 digits: 0001, 0002…" },
];

const KNOWN = new Set(CASE_NUMBER_TOKENS.map((t) => t.token.slice(1, -1)));
const DATE_TOKENS = new Set(["MMDDYY", "MMDDYYYY", "YYYY", "YY", "MM", "DD"]);
const COUNTER_TOKENS = new Set(["N", "N3", "N4"]);
// Case numbers end up in file and folder names, so literals are limited to safe characters.
const SAFE_LITERAL = /^[A-Za-z0-9\-_.#]*$/;
const MAX_LEN = 40;

export interface CaseNumberParts {
  /** From the date of injury; absent when it isn't filled in yet. */
  mm?: string;
  dd?: string;
  yyyy?: string;
  lastName: string;
  firstName: string;
  seq?: number;
}

function letters(value: string): string {
  return value.replace(/[^a-zA-Z]/g, "").toUpperCase();
}

/** Split a format into tokens and literal text. */
function parse(format: string): { tokens: string[]; literals: string[]; bad: string[] } {
  const tokens: string[] = [];
  const literals: string[] = [];
  const bad: string[] = [];
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(format))) {
    literals.push(format.slice(last, m.index));
    const name = m[1].trim().toUpperCase();
    if (KNOWN.has(name)) tokens.push(name);
    else bad.push(m[0]);
    last = m.index + m[0].length;
  }
  literals.push(format.slice(last));
  return { tokens, literals, bad };
}

export interface CaseNumberFormatCheck {
  ok: boolean;
  error?: string;
  usesCounter: boolean;
  usesDate: boolean;
}

/** Is this a usable format? Never throws. */
export function checkCaseNumberFormat(format: string): CaseNumberFormatCheck {
  const f = (format ?? "").trim();
  const { tokens, literals, bad } = parse(f);
  const usesCounter = tokens.some((t) => COUNTER_TOKENS.has(t));
  const usesDate = tokens.some((t) => DATE_TOKENS.has(t));
  const fail = (error: string) => ({ ok: false, error, usesCounter, usesDate });
  if (!f) return fail("Enter a format, or reset to the default.");
  if (bad.length) return fail(`Unknown token ${bad[0]}. Use the tokens listed below.`);
  if (/[{}]/.test(literals.join(""))) return fail("Unmatched { or }.");
  if (!SAFE_LITERAL.test(literals.join(""))) return fail("Use only letters, numbers, - _ . # between tokens (no spaces or slashes).");
  if (!tokens.length) return fail("Add at least one token, like {MMDDYY} or {LAST2}.");
  if (f.length > MAX_LEN) return fail(`Keep the format under ${MAX_LEN} characters.`);
  return { ok: true, usesCounter, usesDate };
}

/** A saved/typed format that's valid, or the default. */
export function normalizeCaseNumberFormat(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CASE_NUMBER_FORMAT;
  const f = value.trim();
  return checkCaseNumberFormat(f).ok ? f : DEFAULT_CASE_NUMBER_FORMAT;
}

export function isDefaultCaseNumberFormat(value: unknown): boolean {
  return normalizeCaseNumberFormat(value) === DEFAULT_CASE_NUMBER_FORMAT;
}

/**
 * Render a format. Returns "" when the format uses the date and the date of
 * injury isn't filled in (same as today), or uses the counter with no number.
 */
export function renderCaseNumber(format: string, parts: CaseNumberParts): string {
  const f = normalizeCaseNumberFormat(format);
  const { tokens, literals } = parse(f);
  const needsDate = tokens.some((t) => DATE_TOKENS.has(t));
  if (needsDate && !(parts.mm && parts.dd && parts.yyyy)) return "";
  if (tokens.some((t) => COUNTER_TOKENS.has(t)) && !(parts.seq && parts.seq > 0)) return "";
  const last = letters(parts.lastName);
  const first = letters(parts.firstName);
  const value = (t: string): string => {
    switch (t) {
      case "MMDDYY": return `${parts.mm}${parts.dd}${(parts.yyyy ?? "").slice(-2)}`;
      case "MMDDYYYY": return `${parts.mm}${parts.dd}${parts.yyyy}`;
      case "YYYY": return parts.yyyy ?? "";
      case "YY": return (parts.yyyy ?? "").slice(-2);
      case "MM": return parts.mm ?? "";
      case "DD": return parts.dd ?? "";
      case "LAST1": return last.slice(0, 1);
      case "LAST2": return last.slice(0, 2);
      case "LAST3": return last.slice(0, 3);
      case "LAST": return last;
      case "FIRST1": return first.slice(0, 1);
      case "FIRST2": return first.slice(0, 2);
      case "FIRST3": return first.slice(0, 3);
      case "FIRST": return first;
      case "N": return String(parts.seq);
      case "N3": return String(parts.seq).padStart(3, "0");
      case "N4": return String(parts.seq).padStart(4, "0");
      default: return "";
    }
  };
  let out = literals[0] ?? "";
  tokens.forEach((t, i) => {
    out += value(t) + (literals[i + 1] ?? "");
  });
  return out;
}

/** The format + counter stamped on a patient at creation (undefined = original format). */
export function caseNumberStampFor(
  format: unknown,
  existingSeqs: Array<string | number | undefined>,
): { caseNumberFormat?: string; caseSeq?: string } {
  const f = normalizeCaseNumberFormat(format);
  if (f === DEFAULT_CASE_NUMBER_FORMAT) return {};
  const stamp: { caseNumberFormat?: string; caseSeq?: string } = { caseNumberFormat: f };
  if (checkCaseNumberFormat(f).usesCounter) {
    const max = existingSeqs.reduce<number>((acc, v) => {
      const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) && n > acc ? n : acc;
    }, 0);
    stamp.caseSeq = String(max + 1);
  }
  return stamp;
}

/** Example for the Settings preview, with a mock patient. Counter shows the next number. */
export function exampleCaseNumber(format: string, nextSeq = 1): string {
  return renderCaseNumber(format, {
    mm: "07", dd: "18", yyyy: "2026", lastName: "Smith", firstName: "John", seq: nextSeq,
  });
}
