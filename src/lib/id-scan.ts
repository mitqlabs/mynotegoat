/**
 * Driver's license / state ID reading — pure helpers (no browser APIs).
 *
 * From a license we take ONLY last name, first name, DOB, sex and address.
 * License number, height, eyes and expiry are never put on the patient.
 *
 * 1. Back of the card: the PDF417 barcode is an AAMVA record (exact).
 * 2. No barcode: OCR text from the front, parsed field by field.
 * Nothing here calls a network or an AI API.
 */
import { composeAddressParts, parseAddressString } from "@/lib/address-parts";

export type IdField = "lastName" | "firstName" | "dob" | "sex" | "street" | "unit" | "city" | "state" | "zip";
export const ID_FIELDS: IdField[] = ["lastName", "firstName", "dob", "sex", "street", "unit", "city", "state", "zip"];
export const ID_FIELD_LABEL: Record<IdField, string> = {
  lastName: "Last name",
  firstName: "First name",
  dob: "DOB",
  sex: "Sex",
  street: "Street",
  unit: "Unit",
  city: "City",
  state: "State",
  zip: "ZIP",
};

/** "exact" = barcode; "read" = OCR with a clear label; "check" = OCR guess. */
export type IdConfidence = "exact" | "read" | "check";
export interface IdValue {
  value: string;
  confidence: IdConfidence;
}
export interface IdRead {
  source: "barcode" | "ocr";
  fields: Partial<Record<IdField, IdValue>>;
  notes: string[];
}

export interface IdFormValues {
  lastName: string;
  firstName: string;
  /** MM/DD/YYYY */
  dob: string;
  sex: "" | "Male" | "Female" | "Other";
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
}

export interface IdPatientLike {
  id: string;
  fullName: string;
  dob?: string;
  sex?: string;
  address?: string;
  deleted?: boolean;
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, c: string) => `Mc${c.toUpperCase()}`)
    .trim();
const streetCase = (s: string) => titleCase(s).replace(/\b(Ne|Nw|Se|Sw|Po)\b/g, (x) => x.toUpperCase());

function validMdy(mm: number, dd: number, yyyy: number): boolean {
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yyyy >= 1900 && yyyy <= 2100)) return false;
  const d = new Date(yyyy, mm - 1, dd);
  return d.getMonth() === mm - 1 && d.getDate() === dd;
}
const mdy = (mm: number, dd: number, yyyy: number) => `${String(mm).padStart(2, "0")}/${String(dd).padStart(2, "0")}/${yyyy}`;

/** AAMVA 8-digit date: MMDDCCYY (US) or CCYYMMDD (Canada). */
export function aamvaDate(raw: string, canada = false): string {
  const s = raw.replace(/\D/g, "");
  if (s.length !== 8) return "";
  const us = { mm: +s.slice(0, 2), dd: +s.slice(2, 4), y: +s.slice(4) };
  const ca = { y: +s.slice(0, 4), mm: +s.slice(4, 6), dd: +s.slice(6) };
  const order = canada ? [ca, us] : [us, ca];
  for (const o of order) if (validMdy(o.mm, o.dd, o.y)) return mdy(o.mm, o.dd, o.y);
  return "";
}

export function isAamva(text: string): boolean {
  return /ANSI\s*\d{6}|AAMVA/.test(text) || (/\bDCS/.test(text) && /\bDBB/.test(text));
}

/** Parse the AAMVA text from a PDF417 barcode. */
export function parseAamva(text: string): IdRead | null {
  if (!isAamva(text)) return null;
  const canada = /ANSI\s*(6043|6046|6047|6048|6049|6050|6051|6052|6053|6054|6055|6056|6057|6058|6059|6060|6061)/.test(text);
  const el = new Map<string, string>();
  const body = text.replace(/<(LF|CR|RS|GS)>/g, "\n").replace(/\r\n?/g, "\n").replace(/[\x1d\x1e]/g, "\n");
  for (const rawLine of body.split("\n")) {
    let line = rawLine.trim();
    const sub = /(?:^|[^A-Z])(?:DL|ID)(D[A-Z]{2}.*)$/.exec(line);
    if (sub && !/^D[A-Z]{2}/.test(line)) line = sub[1];
    const m = /^(D[A-Z]{2})(.*)$/.exec(line);
    if (m && !el.has(m[1])) el.set(m[1], m[2].trim());
  }
  const v = (k: string) => {
    const x = (el.get(k) ?? "").trim();
    return /^(NONE|UNAVL|UNAVAIL|N\/A)$/i.test(x) ? "" : x;
  };
  let last = v("DCS") || v("DAB");
  let first = v("DAC") || v("DCT");
  if (!last && v("DAA")) {
    const parts = v("DAA").split(/[,$]/).map((x) => x.trim()).filter(Boolean);
    last = parts[0] ?? "";
    first = first || parts[1] || "";
  }
  first = first.split(/[,$]/)[0].trim();
  if (/\s/.test(first) && !v("DAC")) first = first.split(/\s+/)[0];
  const fields: IdRead["fields"] = {};
  const put = (k: IdField, val: string) => {
    if (val) fields[k] = { value: val, confidence: "exact" };
  };
  put("lastName", titleCase(last));
  put("firstName", titleCase(first));
  put("dob", aamvaDate(v("DBB"), canada));
  const sex = v("DBC");
  put("sex", sex === "1" || /^M/i.test(sex) ? "Male" : sex === "2" || /^F/i.test(sex) ? "Female" : sex === "9" ? "Other" : "");
  put("street", streetCase(v("DAG")));
  put("unit", streetCase(v("DAH")));
  put("city", titleCase(v("DAI")));
  put("state", v("DAJ").toUpperCase().slice(0, 2));
  const zip = v("DAK").replace(/[^0-9]/g, "");
  put("zip", zip.slice(0, 5));
  const notes = ID_FIELDS.filter((k) => k !== "unit" && !fields[k]).map((k) => `${ID_FIELD_LABEL[k]} wasn't in the barcode. Type it in.`);
  return { source: "barcode", fields, notes };
}

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));

export function looksLikeIdFront(text: string): boolean {
  const t = text.toUpperCase();
  let score = 0;
  if (/DRIVER'?S?\s*LICEN[CS]E|IDENTIFICATION\s*CARD|\bID\s*CARD\b|\bREAL\s*ID\b/.test(t)) score += 2;
  if (/\bDOB\b|DATE OF BIRTH/.test(t)) score += 1;
  if (/\b(LN|FN)\b/.test(t)) score += 1;
  if (/\bEXP\b|\bISS\b|\bCLASS\b|\bHGT\b|\bEYES\b/.test(t)) score += 1;
  if (/\bSEX\s*[:.]?\s*[MF]\b/.test(t)) score += 1;
  return score >= 2;
}

/** Parse front-of-ID OCR text. Labeled fields are "read"; positional guesses are "check". */
export function parseIdFront(text: string): IdRead {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const up = lines.map((l) => l.toUpperCase());
  const fields: IdRead["fields"] = {};
  const put = (k: IdField, value: string, confidence: IdConfidence) => {
    if (value && !fields[k]) fields[k] = { value, confidence };
  };
  const NAME = "([A-Z][A-Z'’ -]{0,40}?)";
  const lnIdx = up.findIndex((l) => new RegExp(`^(?:\\d\\s*)?LN\\b[:. ]*${NAME}$`).test(l));
  const fnIdx = up.findIndex((l) => new RegExp(`^(?:\\d\\s*)?FN\\b[:. ]*${NAME}$`).test(l));
  if (lnIdx >= 0) put("lastName", titleCase(up[lnIdx].replace(/^(?:\d\s*)?LN\b[:. ]*/, "")), "read");
  if (fnIdx >= 0) put("firstName", titleCase(up[fnIdx].replace(/^(?:\d\s*)?FN\b[:. ]*/, "").split(" ")[0]), "read");
  const dob = /(?:DOB|DATE OF BIRTH|BIRTH)\b[:. ]*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(up.join("\n"));
  if (dob && validMdy(+dob[1], +dob[2], +dob[3])) put("dob", mdy(+dob[1], +dob[2], +dob[3]), "read");
  const sex = /\bSEX\b[:. ]*([MFX])\b/.exec(up.join("\n"));
  if (sex) put("sex", sex[1] === "M" ? "Male" : sex[1] === "F" ? "Female" : "Other", "read");
  const cityRe = /^([A-Z][A-Z .'-]{1,30}?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/;
  const cIdx = up.findIndex((l) => {
    const m = cityRe.exec(l);
    return Boolean(m && US_STATES.has(m[2]));
  });
  if (cIdx >= 0) {
    const m = cityRe.exec(up[cIdx])!;
    put("city", titleCase(m[1]), "check");
    put("state", m[2], "check");
    put("zip", m[3], "check");
    const prev = up[cIdx - 1] ?? "";
    if (/^\d+\s+[A-Z0-9]/.test(prev)) {
      const unit = /\s+((?:APT|UNIT|STE|SUITE|#)\s*\S+)$/.exec(prev);
      put("street", streetCase(unit ? prev.slice(0, unit.index) : prev), "check");
      if (unit) put("unit", streetCase(unit[1]), "check");
    }
  }
  if (!fields.lastName) {
    const nm = up.map((l) => /^([A-Z'’-]{2,}),\s*([A-Z'’-]{2,})(?:\s+[A-Z.]+)?$/.exec(l)).find(Boolean);
    if (nm) {
      put("lastName", titleCase(nm[1]), "check");
      put("firstName", titleCase(nm[2]), "check");
    }
  }
  const notes: string[] = [];
  if (!looksLikeIdFront(text)) notes.push("No barcode, and this doesn't look like the front of an ID. Check every field.");
  const missing = ID_FIELDS.filter((k) => k !== "unit" && !fields[k]);
  if (missing.length) notes.push(`Couldn't read: ${missing.map((k) => ID_FIELD_LABEL[k]).join(", ")}.`);
  if (Object.values(fields).some((f) => f?.confidence === "check")) notes.push("Check the fields before you confirm.");
  return { source: "ocr", fields, notes };
}

export const mdyIso = (v: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
};
const isoMdy = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
};

export function idAddress(f: Partial<Record<IdField, string>>): string {
  return composeAddressParts({ address1: f.street ?? "", address2: f.unit ?? "", city: f.city ?? "", state: f.state ?? "", zip: f.zip ?? "" });
}

export function valuesFromRead(read: IdRead): IdFormValues {
  const v = (k: IdField) => read.fields[k]?.value ?? "";
  const sex = v("sex");
  return {
    lastName: v("lastName"),
    firstName: v("firstName"),
    dob: v("dob"),
    sex: sex === "Male" || sex === "Female" || sex === "Other" ? sex : "",
    street: v("street"),
    unit: v("unit"),
    city: v("city"),
    state: v("state"),
    zip: v("zip"),
  };
}

export function addressFromValues(v: IdFormValues): string {
  return idAddress({ street: v.street, unit: v.unit, city: v.city, state: v.state, zip: v.zip });
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Last AND first must match. When both have a DOB, it must match too. */
export function matchIdPatients<T extends IdPatientLike>(f: Partial<Record<IdField, string>>, patients: T[]): T[] {
  const last = normName(f.lastName ?? "");
  const first = normName(f.firstName ?? "");
  if (!last || !first) return [];
  const dob = mdyIso(f.dob ?? "");
  return patients.filter((p) => {
    if (p.deleted) return false;
    const [pl = "", pf = ""] = p.fullName.split(",").map((x) => x.trim());
    if (normName(pl) !== last) return false;
    const pfn = normName(pf.split(/\s+/)[0] ?? "");
    if (pfn !== first) return false;
    return !(dob && p.dob && p.dob.slice(0, 10) !== dob);
  });
}

export type IdPatchKey = "dob" | "sex" | "address";
export interface IdUpdatePlan {
  fills: Array<{ key: IdPatchKey; label: string; value: string }>;
  conflicts: Array<{ key: IdPatchKey; label: string; current: string; fromId: string }>;
  same: IdPatchKey[];
}

/** Fill blanks. Differences are conflicts; the caller decides. Never overwrite silently. */
export function planIdUpdate(p: IdPatientLike, f: Partial<Record<IdField, string>>): IdUpdatePlan {
  const plan: IdUpdatePlan = { fills: [], conflicts: [], same: [] };
  const consider = (key: IdPatchKey, label: string, current: string, fromId: string, eq: (a: string, b: string) => boolean) => {
    if (!fromId) return;
    if (!current.trim() || current.trim() === "-") plan.fills.push({ key, label, value: fromId });
    else if (eq(current, fromId)) plan.same.push(key);
    else plan.conflicts.push({ key, label, current, fromId });
  };
  consider("dob", "DOB", isoMdy(p.dob ?? "") || (/^\d{2}\/\d{2}\/\d{4}$/.test(p.dob ?? "") ? p.dob! : ""), f.dob ?? "", (a, b) => a === b);
  consider("sex", "Sex", p.sex ?? "", f.sex ?? "", (a, b) => a.toLowerCase() === b.toLowerCase());
  const addr = idAddress(f);
  const addrKey = (s: string) => {
    const a = parseAddressString(s);
    return `${a.address1}|${a.zip}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
  };
  consider("address", "Address", p.address ?? "", addr, (a, b) => addrKey(a) === addrKey(b));
  return plan;
}

export interface IdWrite {
  fullName?: string;
  dob?: string;
  sex?: "Male" | "Female" | "Other";
  address?: string;
}

/** What to write on Confirm. Fills always apply. Conflicts apply only when useId is true. */
export function idWrite(plan: IdUpdatePlan, useId: Partial<Record<IdPatchKey, boolean>>): IdWrite {
  const out: IdWrite = {};
  const set = (k: IdPatchKey, v: string) => {
    if (k === "dob") {
      const iso = mdyIso(v);
      if (iso) out.dob = iso;
    } else if (k === "sex" && (v === "Male" || v === "Female" || v === "Other")) out.sex = v;
    else if (k === "address") out.address = v;
  };
  for (const f of plan.fills) set(f.key, f.value);
  for (const c of plan.conflicts) if (useId[c.key]) set(c.key, c.fromId);
  return out;
}

/** Different name on the chart vs the ID. Null when they match or the ID has no name. */
export function nameConflict(patientName: string, last: string, first: string): { current: string; fromId: string } | null {
  if (!last.trim() || !first.trim()) return null;
  const fromId = `${last.trim()}, ${first.trim()}`;
  if (normName(patientName) === normName(fromId)) return null;
  return { current: patientName.trim(), fromId };
}

export function idImageName(side: "front" | "back", last: string, first: string): string {
  const who = [last, first]
    .map((s) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
  return `ID (${side}) - ${who || "patient"}.jpg`;
}

/** Session handoff into the New Patient form. The picture itself stays in memory. */
export const ID_SCAN_PREFILL_KEY = "casemate.id-scan-prefill.v1";

export function stashIdScanPrefill(values: IdFormValues) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ID_SCAN_PREFILL_KEY, JSON.stringify({ values, at: Date.now() }));
}

export function takeIdScanPrefill(): IdFormValues | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(ID_SCAN_PREFILL_KEY);
  window.sessionStorage.removeItem(ID_SCAN_PREFILL_KEY);
  try {
    const v = raw ? (JSON.parse(raw) as { values?: IdFormValues; at?: number }) : null;
    if (!v?.values || !v.at || Date.now() - v.at >= 10 * 60_000) return null;
    return v.values;
  } catch {
    return null;
  }
}
