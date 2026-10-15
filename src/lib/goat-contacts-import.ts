/**
 * G.O.A.T. bulk contacts from pasted text (rules only, pure). Splits a pasted
 * list into contacts (name, phone, fax, email, address), guesses a category,
 * and flags likely duplicates of existing contacts. Never writes anything.
 */
import type { ContactCategory } from "@/lib/mock-data";

export interface ImportRow {
  key: string;
  name: string;
  phone: string;
  fax: string;
  email: string;
  address: string;
  /** Lines we couldn't place (shown, not saved). */
  extra: string[];
  category: ContactCategory | "";
  checked: boolean;
  /** Why this row starts unchecked (duplicate, missing phone…). */
  flag: string;
}

const PHONE_RE = /(?:\+?1[\s.-]*)?\(?\b(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})\b(?:\s*(?:x|ext\.?)\s*\d+)?/i;
const PHONE_G = new RegExp(PHONE_RE.source, "gi");
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const STATE_ZIP_RE = /\b[A-Z]{2}\.?\s+\d{5}(?:-\d{4})?\b/;
const STREET_RE = /^\s*\d+[A-Z]?\s+[\w.'-]+(?:\s+[\w.'#-]+)*\s+(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|pkwy|parkway|fwy|freeway|hwy|highway|way|ct|court|cir|circle|pl|place|plaza|trl|trail|loop|sq|square|ter|terrace)\b/i;
const LABEL_RE = /^\s*(phone|ph|tel|telephone|office|main|cell|mobile|fax|f|email|e-mail|e|address|addr)\s*[:.#-]\s*/i;

const fmt = (a: string, b: string, c: string) => `${a}-${b}-${c}`;
const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

/** True when a message looks like a pasted contact list (or asks to add contacts with some). */
export function looksLikeContactPaste(text: string): boolean {
  const phones = (text.match(PHONE_G) ?? []).length;
  if (!phones) return false;
  const intent = /\b(add|import|save|create|put)\b[^\n]{0,40}\b(contacts?|directory)\b|\bas contacts?\b/i.test(text);
  if (intent) return true;
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  return lines >= 3 && (phones >= 2 || STATE_ZIP_RE.test(text));
}

/** Category the user named in the request ("add these attorneys as contacts"). */
export function categoryFromRequest(text: string): ContactCategory | "" {
  const head = text.split(/\r?\n/).filter((l) => !PHONE_RE.test(l)).slice(0, 2).join(" ").toLowerCase();
  if (/\b(attorneys?|lawyers?|law firms?)\b/.test(head)) return "Attorney";
  if (/\bimaging|mri|radiology\b/.test(head)) return "Imaging Center";
  if (/\bspecialists?|doctors?|ortho\w*\b/.test(head)) return "Specialist";
  if (/\burgent care|acute|er\b|hospitals?\b/.test(head)) return "Acute Care";
  if (/\binsurance\b|\bagents?\b/.test(head)) return "Insurance Agent";
  return "";
}

export function guessCategory(name: string): ContactCategory | "" {
  const n = name.toLowerCase();
  if (/\b(law|lawyers?|attorneys?|legal|pllc|p\.?\s?c\.?|llp|esq\.?|injury|litigation|counsel|abogados?)\b/.test(n) || /&\s*associates\b/.test(n) || /\bp\.c\.?$/.test(n)) return "Attorney";
  if (/\b(imaging|mri|radiology|diagnostic|x-?ray|open mri)\b/.test(n)) return "Imaging Center";
  if (/\b(urgent care|emergency|er|hospital|medical center|acute)\b/.test(n)) return "Acute Care";
  if (/\b(insurance|state farm|allstate|farmers|geico|progressive)\b/.test(n)) return "Insurance Agent";
  if (/\b(ortho\w*|pain|neuro\w*|spine|surgery|surgical|md|m\.d\.|clinic|physicians?|specialists?)\b/.test(n)) return "Specialist";
  return "";
}

type Kind = "phone" | "fax" | "email" | "address" | "cityline" | "name" | "intent";
function kindOf(line: string): Kind {
  const l = line.trim();
  if (/^(please\s+)?(add|import|save|create|put)\b.*\b(contacts?|directory|these|following|list)\b/i.test(l) && !PHONE_RE.test(l)) return "intent";
  if (/\bas contacts?\b/i.test(l) && !PHONE_RE.test(l)) return "intent";
  if (EMAIL_RE.test(l) && l.replace(EMAIL_RE, "").replace(LABEL_RE, "").trim().length < 3) return "email";
  if (PHONE_RE.test(l)) {
    const rest = l.replace(PHONE_G, "").replace(/\b(phone|ph|tel|telephone|office|main|cell|mobile|fax|f|p|t|o)\b\s*[:.]?/gi, "").replace(/[\s/|,:;()-]/g, "");
    if (rest.length <= 2) return /\bfax\b|^\s*f\s*[:.]/i.test(l) ? "fax" : "phone";
  }
  if (STREET_RE.test(l) || (STATE_ZIP_RE.test(l) && /\d/.test(l.replace(STATE_ZIP_RE, "")))) return "address";
  if (/^[A-Za-z .'-]+,\s*[A-Z]{2}\.?\s+\d{5}(-\d{4})?$/.test(l)) return "cityline";
  if (/^(suite|ste\.?|unit|bldg|building|floor|fl\.?|#)\s*\w+/i.test(l)) return "address";
  return "name";
}

interface Draft { name: string; phone: string; fax: string; email: string; address: string; extra: string[] }
const emptyDraft = (): Draft => ({ name: "", phone: "", fax: "", email: "", address: "", extra: [] });

/** One line holding several fields: "Firm, 817-555-0100, 1 Main St, City, TX 76116". */
function parseSingleLine(line: string): Draft | null {
  const phones = [...line.matchAll(PHONE_G)];
  if (!phones.length) return null;
  const d = emptyDraft();
  let rest = line;
  const email = EMAIL_RE.exec(rest);
  if (email) { d.email = email[0]; rest = rest.replace(email[0], " "); }
  for (const m of phones) {
    const before = line.slice(Math.max(0, (m.index ?? 0) - 6), m.index).toLowerCase();
    const p = fmt(m[1], m[2], m[3]);
    if (/fax|f:\s*$/.test(before) && !d.fax) d.fax = p;
    else if (!d.phone) d.phone = p;
    rest = rest.replace(m[0], " ");
  }
  rest = rest.replace(/\b(phone|ph|tel|fax|email|e-mail)\b\s*[:.]?/gi, " ");
  const parts = rest.split(/\s*[|;•·\t]\s*|\s+[-–—]\s+|\s{2,}/).map((s) => s.trim().replace(/^,|,$/g, "").trim()).filter(Boolean);
  // Address = from the first street-looking part through the state+zip.
  const joined = parts.join(", ");
  const addr = /(\d+[A-Z]?\s+[^,]+(?:,\s*[^,]+)*?,\s*[A-Za-z .'-]+,?\s*[A-Z]{2}\.?\s+\d{5}(?:-\d{4})?)/.exec(joined);
  let nameText = joined;
  if (addr) { d.address = addr[1].trim(); nameText = joined.replace(addr[1], ""); }
  d.name = nameText.replace(/(,\s*)+/g, ", ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
  return d;
}

/** Split pasted text into contact drafts. */
export function parseContactPaste(text: string): Draft[] {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.replace(/\u00a0/g, " ").trim());
  const out: Draft[] = [];
  let cur = emptyDraft();
  let curHasData = false;
  const flush = () => {
    if (cur.name || cur.phone || cur.address) out.push(cur);
    cur = emptyDraft();
    curHasData = false;
  };
  for (const raw of lines) {
    if (!raw) { flush(); continue; }
    const line = raw.replace(/^[-*•\d]+[.)]\s+(?=\D)/, "");
    const kind = kindOf(line);
    if (kind === "intent") continue;
    // A line with a name AND a phone: single-line format.
    if ((kind === "name" || kind === "address" || kind === "cityline") && PHONE_RE.test(line)) {
      flush();
      const d = parseSingleLine(line);
      if (d) out.push(d);
      continue;
    }
    const value = line.replace(LABEL_RE, "").trim();
    if (kind === "name") {
      // Missing blank line: a new name after we already have data starts a new contact.
      if (cur.name && curHasData) flush();
      if (!cur.name) cur.name = value;
      else cur.extra.push(value);
      continue;
    }
    curHasData = true;
    if (kind === "phone") {
      const m = PHONE_RE.exec(value)!;
      const p = fmt(m[1], m[2], m[3]);
      if (!cur.phone) cur.phone = p;
      else if (!cur.fax && /fax/i.test(line)) cur.fax = p;
      else cur.extra.push(line);
    } else if (kind === "fax") {
      const m = PHONE_RE.exec(value)!;
      cur.fax = fmt(m[1], m[2], m[3]);
    } else if (kind === "email") {
      cur.email = EMAIL_RE.exec(value)![0];
    } else {
      cur.address = cur.address ? `${cur.address}, ${value}` : value;
    }
  }
  flush();
  return out;
}

const NAME_NOISE = /\b(the|law|firm|offices?|of|group|pllc|p\.?\s?c|llp|llc|inc|attorneys?|at|and|associates|injury|lawyers?)\b/g;
/** Name key for duplicate checks: lower-case, no punctuation/suffixes/alias. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " ").replace(/[.,'’]/g, "").replace(NAME_NOISE, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export interface ExistingContact { name: string; phone?: string; category?: string }

/** Rows for the review card, with duplicates (vs. existing and within the paste) unchecked. */
export function buildImportRows(drafts: Draft[], existing: ExistingContact[], category: ContactCategory | ""): ImportRow[] {
  const names = new Map<string, string>();
  const phones = new Map<string, string>();
  for (const c of existing) {
    const k = nameKey(c.name);
    if (k) names.set(k, c.name);
    const p = digits(c.phone ?? "");
    if (p.length === 10) phones.set(p, c.name);
  }
  const seenNames = new Set<string>();
  const seenPhones = new Set<string>();
  return drafts.map((d, i) => {
    const k = nameKey(d.name);
    const p = digits(d.phone);
    let flag = "";
    if (k && names.has(k)) flag = `Already in contacts as "${names.get(k)}"`;
    else if (p.length === 10 && phones.has(p)) flag = `Same phone as "${phones.get(p)}"`;
    else if ((k && seenNames.has(k)) || (p.length === 10 && seenPhones.has(p))) flag = "Listed twice in this paste";
    else if (!d.name) flag = "No name";
    else if (p.length !== 10) flag = "No phone (required)";
    if (k) seenNames.add(k);
    if (p.length === 10) seenPhones.add(p);
    return { key: `r${i}`, ...d, category: category || guessCategory(d.name), checked: !flag, flag };
  });
}

/** One category for the batch when the rows agree, else "". */
export function batchCategory(rows: Array<{ name: string }>): ContactCategory | "" {
  const g = rows.map((r) => guessCategory(r.name));
  const known = g.filter(Boolean);
  if (!known.length) return "";
  const top = known.sort((a, b) => known.filter((x) => x === b).length - known.filter((x) => x === a).length)[0];
  return known.filter((x) => x === top).length / rows.length >= 0.6 ? top : "";
}
