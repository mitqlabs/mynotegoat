/**
 * Patient-as-folder grouping. Pure: it never writes, and it never mutates
 * the case rows it is given.
 *
 * A folder is created only for an exact person match: same normalized name
 * and the same date of birth. Phone and address must not disagree (a blank
 * does not disagree with a value). Anything else — conflicting phone or
 * address, same name with a different date of birth, a middle initial, a
 * swapped first/last name — stays as its own folder and is listed for a
 * person to check. Close matches are never auto-grouped.
 *
 * Dashboard numbers are counted from case rows (status, billing, imaging).
 * Grouping does not drop, merge, or rewrite those fields, so the totals
 * before and after are the same numbers.
 */
import { parseDateOnly } from "@/lib/age";

export type FolderCaseInput = {
  id: string;
  fullName: string;
  dob?: string;
  phone?: string;
  email?: string;
  address?: string;
  sex?: string;
  maritalStatus?: string;
  alerts?: string[];
  caseStatus?: string;
  /** Resolved billed dollars (billing record, else the case matrix). */
  billed?: number;
  /** Resolved paid dollars. */
  paid?: number;
  xrayStudies?: number;
  mriStudies?: number;
};

export type FolderPerson = {
  fullName: string;
  firstName: string;
  lastName: string;
  dob: string;
  phone: string;
  email: string;
  address: string;
  sex: string;
  maritalStatus: string;
  alerts: string[];
};

export type PatientFolder = {
  /** Stable for a group: "pf-" plus the lowest case id in the group. */
  id: string;
  caseIds: string[];
  person: FolderPerson;
  /** Non-blocking differences inside an auto-group (email, sex, marital). */
  warnings: string[];
};

export type ReviewGroup = {
  reason: string;
  /** Cases that were NOT merged. */
  caseIds: string[];
  /** Names as stored, for a person to recognize the rows. */
  names: string[];
  dob: string;
};

export type FolderGrouping = {
  folders: PatientFolder[];
  /** Same name + DOB, but phone or address disagrees. Not auto-grouped. */
  conflicts: ReviewGroup[];
  /** Close, but not exact. Not auto-grouped. */
  closeMatches: ReviewGroup[];
  /** A phone sitting on more than four different names. Not a person match. */
  sharedPhones: { phone: string; caseIds: string[]; names: string[] }[];
};

const ADDRESS_WORD: Record<string, string> = {
  avenue: "ave",
  street: "st",
  road: "rd",
  drive: "dr",
  boulevard: "blvd",
  lane: "ln",
  court: "ct",
  place: "pl",
  apartment: "apt",
  apt: "apt",
  suite: "apt",
  ste: "apt",
  unit: "apt",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
};

export function nameKey(fullName: string): string {
  const cleaned = fullName
    .toLowerCase()
    .replace(/[^a-z0-9,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const comma = cleaned.indexOf(",");
  if (comma >= 0) {
    const last = cleaned.slice(0, comma).trim();
    const rest = cleaned.slice(comma + 1).trim();
    return `${last}|${rest}`;
  }
  return cleaned;
}

/** Last name + first token, so "Smith, John A" is close to "Smith, John" but not exact. */
export function closeNameKey(fullName: string): string {
  const exact = nameKey(fullName);
  if (exact.includes("|")) {
    const [last, rest] = exact.split("|");
    const first = (rest ?? "").split(" ")[0] ?? "";
    return `${last}|${first}`;
  }
  const parts = exact.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    return `${last}|${first}`;
  }
  return exact;
}

export function lastNameKey(fullName: string): string {
  const exact = nameKey(fullName);
  if (exact.includes("|")) return exact.split("|")[0] ?? "";
  const parts = exact.split(" ").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : exact;
}

export function dobKey(dob: string | undefined): string {
  const raw = (dob ?? "").trim();
  if (!raw) return "";
  const parsed = parseDateOnly(raw);
  if (!parsed) return `raw:${raw.toLowerCase()}`;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function phoneKey(phone: string | undefined): string {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length > 10) digits = digits.slice(0, 10);
  return digits.length >= 7 ? digits : "";
}

export function addressKey(address: string | undefined): string {
  const cleaned = (address ?? "")
    .toLowerCase()
    .replace(/[#.,]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((word) => ADDRESS_WORD[word] ?? word)
    .join(" ");
}

export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const comma = trimmed.indexOf(",");
  if (comma >= 0) {
    return {
      lastName: trimmed.slice(0, comma).trim(),
      firstName: trimmed.slice(comma + 1).trim(),
    };
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: "", lastName: parts[0] ?? "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function nonEmpty(value: string | undefined): string {
  return (value ?? "").trim();
}

function uniqueFilled(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function firstFilled(cases: FolderCaseInput[], read: (row: FolderCaseInput) => string | undefined): string {
  const ordered = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  for (const row of ordered) {
    const value = nonEmpty(read(row));
    if (value) return value;
  }
  return "";
}

function buildPerson(cases: FolderCaseInput[]): { person: FolderPerson; warnings: string[] } {
  const warnings: string[] = [];
  const fullName = firstFilled(cases, (row) => row.fullName);
  const { firstName, lastName } = splitFullName(fullName);
  const emails = uniqueFilled(cases.map((row) => row.email ?? ""));
  const sexes = uniqueFilled(cases.map((row) => row.sex ?? ""));
  const marital = uniqueFilled(cases.map((row) => row.maritalStatus ?? ""));
  if (emails.length > 1) warnings.push("email differs across these cases");
  if (sexes.length > 1) warnings.push("sex differs across these cases");
  if (marital.length > 1) warnings.push("marital status differs across these cases");
  const alerts = uniqueFilled(cases.flatMap((row) => row.alerts ?? []));
  return {
    warnings,
    person: {
      fullName,
      firstName,
      lastName,
      dob: firstFilled(cases, (row) => row.dob),
      phone: firstFilled(cases, (row) => row.phone),
      email: emails[0] ?? "",
      address: firstFilled(cases, (row) => row.address),
      sex: sexes[0] ?? "",
      maritalStatus: marital[0] ?? "",
      alerts,
    },
  };
}

function folderIdFor(caseIds: string[]): string {
  const canonical = [...caseIds].sort((a, b) => a.localeCompare(b))[0] ?? "unknown";
  return `pf-${canonical}`;
}

function reviewOf(reason: string, rows: FolderCaseInput[]): ReviewGroup {
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return {
    reason,
    caseIds: ordered.map((row) => row.id),
    names: ordered.map((row) => row.fullName),
    dob: firstFilled(ordered, (row) => row.dob),
  };
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const next = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

function keysDisagree(rows: FolderCaseInput[], keyOf: (row: FolderCaseInput) => string): boolean {
  const keys = new Set(rows.map(keyOf).filter(Boolean));
  return keys.size > 1;
}

/**
 * Group case rows into patient folders. Every input id appears in exactly
 * one folder. Conflict and close-match rows stay one folder each.
 */
export function groupPatientCases(cases: readonly FolderCaseInput[]): FolderGrouping {
  const byExact = new Map<string, FolderCaseInput[]>();
  for (const row of cases) {
    const dob = dobKey(row.dob);
    if (!dob || !nameKey(row.fullName)) continue;
    const key = `${nameKey(row.fullName)}::${dob}`;
    const list = byExact.get(key);
    if (list) list.push(row);
    else byExact.set(key, [row]);
  }

  const autoIds = new Set<string>();
  const folders: PatientFolder[] = [];
  const conflicts: ReviewGroup[] = [];

  for (const rows of byExact.values()) {
    if (rows.length < 2) continue;
    const phoneConflict = keysDisagree(rows, (row) => phoneKey(row.phone));
    const addressConflict = keysDisagree(rows, (row) => addressKey(row.address));
    if (phoneConflict || addressConflict) {
      const why = [
        phoneConflict ? "phone disagrees" : "",
        addressConflict ? "address disagrees" : "",
      ]
        .filter(Boolean)
        .join(" and ");
      conflicts.push(reviewOf(`${why} on the same name and date of birth`, rows));
      continue;
    }
    const { person, warnings } = buildPerson(rows);
    const caseIds = rows.map((row) => row.id).sort((a, b) => a.localeCompare(b));
    folders.push({ id: folderIdFor(caseIds), caseIds, person, warnings });
    for (const id of caseIds) autoIds.add(id);
  }

  for (const row of cases) {
    if (autoIds.has(row.id)) continue;
    const { person, warnings } = buildPerson([row]);
    folders.push({ id: folderIdFor([row.id]), caseIds: [row.id], person, warnings });
  }

  folders.sort((a, b) => a.person.fullName.localeCompare(b.person.fullName) || a.id.localeCompare(b.id));

  const folderIdByCase = new Map<string, string>();
  for (const folder of folders) {
    for (const id of folder.caseIds) folderIdByCase.set(id, folder.id);
  }

  const closeMatches: ReviewGroup[] = [];
  const seenClose = new Set<string>();
  const conflictSignatures = new Set(conflicts.map((group) => [...group.caseIds].sort().join(",")));

  const byClose = new Map<string, FolderCaseInput[]>();
  for (const row of cases) {
    const key = closeNameKey(row.fullName);
    if (!key) continue;
    const list = byClose.get(key);
    if (list) list.push(row);
    else byClose.set(key, [row]);
  }
  for (const [key, rows] of byClose) {
    if (rows.length < 2) continue;
    const signature = rows.map((row) => row.id).sort().join(",");
    if (conflictSignatures.has(signature)) continue;
    const folderIds = new Set(rows.map((row) => folderIdByCase.get(row.id)));
    if (folderIds.size < 2) continue;
    seenClose.add(signature);
    closeMatches.push(reviewOf(`same name, not the same exact record (${key})`, rows));
  }

  const byLastDob = new Map<string, FolderCaseInput[]>();
  for (const row of cases) {
    const dob = dobKey(row.dob);
    const last = lastNameKey(row.fullName);
    if (!dob || !last) continue;
    const key = `${last}::${dob}`;
    const list = byLastDob.get(key);
    if (list) list.push(row);
    else byLastDob.set(key, [row]);
  }
  for (const rows of byLastDob.values()) {
    if (rows.length < 2) continue;
    const exact = new Set(rows.map((row) => nameKey(row.fullName)));
    if (exact.size < 2) continue;
    const signature = rows.map((row) => row.id).sort().join(",");
    if (seenClose.has(signature)) continue;
    const folderIds = new Set(rows.map((row) => folderIdByCase.get(row.id)));
    if (folderIds.size < 2) continue;
    const firsts = rows.map((row) => closeNameKey(row.fullName).split("|")[1] ?? "");
    const fuzzy = firsts.some((a, i) =>
      firsts.some((b, j) => {
        if (i === j || !a || !b || a === b) return false;
        if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
        return editDistance(a, b) <= 1;
      }),
    );
    if (!fuzzy && exact.size > 1) {
      closeMatches.push(reviewOf("same last name and date of birth, different first name", rows));
      continue;
    }
    if (fuzzy) closeMatches.push(reviewOf("same last name and date of birth, first name is only close", rows));
  }

  const byPhone = new Map<string, FolderCaseInput[]>();
  for (const row of cases) {
    const phone = phoneKey(row.phone);
    if (phone.length < 10) continue;
    const list = byPhone.get(phone);
    if (list) list.push(row);
    else byPhone.set(phone, [row]);
  }
  const sharedPhones: FolderGrouping["sharedPhones"] = [];
  for (const [phone, rows] of byPhone) {
    const names = new Set(rows.map((row) => nameKey(row.fullName)));
    if (names.size < 2) continue;
    if (names.size > 4) {
      sharedPhones.push({
        phone,
        caseIds: rows.map((row) => row.id).sort(),
        names: uniqueFilled(rows.map((row) => row.fullName)),
      });
      continue;
    }
    const signature = rows.map((row) => row.id).sort().join(",");
    if (seenClose.has(signature)) continue;
    const folderIds = new Set(rows.map((row) => folderIdByCase.get(row.id)));
    if (folderIds.size < 2) continue;
    closeMatches.push(reviewOf("same phone, different name", rows));
  }

  return { folders, conflicts, closeMatches, sharedPhones };
}

export type DashboardCaseNumbers = {
  cases: number;
  byStatus: Record<string, number>;
  billed: number;
  paid: number;
  owed: number;
  casesWithBilled: number;
  casesWithPaid: number;
  xrayStudies: number;
  mriStudies: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The dashboard counts cases, not folders. This is that sum. */
export function dashboardNumbersFromCases(cases: readonly FolderCaseInput[]): DashboardCaseNumbers {
  const byStatus: Record<string, number> = {};
  let billed = 0;
  let paid = 0;
  let casesWithBilled = 0;
  let casesWithPaid = 0;
  let xrayStudies = 0;
  let mriStudies = 0;
  for (const row of cases) {
    const status = (row.caseStatus ?? "").trim() || "Active";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const billedAmount = Number.isFinite(row.billed) ? Number(row.billed) : 0;
    const paidAmount = Number.isFinite(row.paid) ? Number(row.paid) : 0;
    billed += billedAmount;
    paid += paidAmount;
    if (billedAmount > 0) casesWithBilled += 1;
    if (paidAmount > 0) casesWithPaid += 1;
    xrayStudies += row.xrayStudies ?? 0;
    mriStudies += row.mriStudies ?? 0;
  }
  return {
    cases: cases.length,
    byStatus,
    billed: roundMoney(billed),
    paid: roundMoney(paid),
    owed: roundMoney(billed - paid),
    casesWithBilled,
    casesWithPaid,
    xrayStudies,
    mriStudies,
  };
}

export type FolderRollup = {
  folderId: string;
  caseCount: number;
  billed: number;
  paid: number;
  owed: number;
  active: number;
  submitted: number;
  paidCases: number;
};

export function rollupFolders(cases: readonly FolderCaseInput[], grouping: FolderGrouping): FolderRollup[] {
  const byId = new Map(cases.map((row) => [row.id, row]));
  return grouping.folders.map((folder) => {
    let billed = 0;
    let paid = 0;
    let active = 0;
    let submitted = 0;
    let paidCases = 0;
    for (const id of folder.caseIds) {
      const row = byId.get(id);
      if (!row) continue;
      billed += Number(row.billed) || 0;
      paid += Number(row.paid) || 0;
      if (row.caseStatus === "Active") active += 1;
      if (row.caseStatus === "Submitted") submitted += 1;
      if (row.caseStatus === "Paid") paidCases += 1;
    }
    return {
      folderId: folder.id,
      caseCount: folder.caseIds.length,
      billed: roundMoney(billed),
      paid: roundMoney(paid),
      owed: roundMoney(billed - paid),
      active,
      submitted,
      paidCases,
    };
  });
}

export function numbersMatch(left: DashboardCaseNumbers, right: DashboardCaseNumbers): boolean {
  if (left.cases !== right.cases) return false;
  if (left.billed !== right.billed || left.paid !== right.paid || left.owed !== right.owed) return false;
  if (left.casesWithBilled !== right.casesWithBilled || left.casesWithPaid !== right.casesWithPaid) return false;
  if (left.xrayStudies !== right.xrayStudies || left.mriStudies !== right.mriStudies) return false;
  const keys = new Set([...Object.keys(left.byStatus), ...Object.keys(right.byStatus)]);
  for (const key of keys) {
    if ((left.byStatus[key] ?? 0) !== (right.byStatus[key] ?? 0)) return false;
  }
  return true;
}

/**
 * Dry run: group the cases, then count the dashboard off the same case rows.
 * Throws when a case was dropped, duplicated, or its money/status/imaging changed.
 */
export function proveFolderNumbers(cases: readonly FolderCaseInput[]): {
  before: DashboardCaseNumbers;
  after: DashboardCaseNumbers;
  grouping: FolderGrouping;
  multiCasePatients: number;
  folders: number;
} {
  const before = dashboardNumbersFromCases(cases);
  const grouping = groupPatientCases(cases);
  const seen = new Map<string, number>();
  for (const folder of grouping.folders) {
    for (const id of folder.caseIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  if (seen.size !== cases.length) {
    throw new Error(`Folder grouping kept ${seen.size} cases out of ${cases.length}.`);
  }
  for (const [id, count] of seen) {
    if (count !== 1) throw new Error(`Case ${id} landed in ${count} folders.`);
  }
  const after = dashboardNumbersFromCases(cases);
  if (!numbersMatch(before, after)) {
    throw new Error("Dashboard numbers changed after grouping, and grouping does not edit case rows.");
  }
  const rollups = rollupFolders(cases, grouping);
  const rolledBilled = roundMoney(rollups.reduce((sum, row) => sum + row.billed, 0));
  const rolledPaid = roundMoney(rollups.reduce((sum, row) => sum + row.paid, 0));
  if (rolledBilled !== before.billed || rolledPaid !== before.paid) {
    throw new Error(
      `Folder money ${rolledBilled} / ${rolledPaid} does not match case money ${before.billed} / ${before.paid}.`,
    );
  }
  return {
    before,
    after,
    grouping,
    multiCasePatients: grouping.folders.filter((folder) => folder.caseIds.length > 1).length,
    folders: grouping.folders.length,
  };
}

/** Same rule as the dashboard billing snapshot: a positive billing record wins, else the matrix text. */
export function parseDollar(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const match = cleaned.match(/-?[0-9]*\.?[0-9]+/);
  if (!match) return 0;
  const num = Number.parseFloat(match[0]);
  return Number.isFinite(num) ? num : 0;
}

export function resolveCaseMoney(
  billing: { billedAmount?: number; paidAmount?: number } | null | undefined,
  matrix: { billed?: string; paidAmount?: string } | null | undefined,
): { billed: number; paid: number; owed: number } {
  const billed =
    billing && typeof billing.billedAmount === "number" && billing.billedAmount > 0
      ? billing.billedAmount
      : parseDollar(matrix?.billed);
  const paid =
    billing && typeof billing.paidAmount === "number" && billing.paidAmount > 0
      ? billing.paidAmount
      : parseDollar(matrix?.paidAmount);
  return { billed, paid, owed: roundMoney(billed - paid) };
}

/** One study per region; a bilateral region counts as two. Empty regions still count as one. Mirrors the dashboard. */
export function countImagingStudies(referrals: unknown): number {
  if (!Array.isArray(referrals)) return 0;
  let total = 0;
  for (const raw of referrals) {
    if (!raw || typeof raw !== "object") continue;
    const ref = raw as Record<string, unknown>;
    if (ref.isPrior === true) continue;
    const center = typeof ref.center === "string" ? ref.center.trim() : "";
    if (!center) continue;
    const regions = Array.isArray(ref.regions) ? (ref.regions as unknown[]) : [];
    if (!regions.length) {
      total += 1;
      continue;
    }
    const laterality =
      ref.lateralityByRegion && typeof ref.lateralityByRegion === "object"
        ? (ref.lateralityByRegion as Record<string, string>)
        : {};
    for (const region of regions) {
      if (typeof region !== "string") continue;
      total += laterality[region] === "BL" ? 2 : 1;
    }
  }
  return total;
}

export function formatFolderMoney(value: number): string {
  const rounded = roundMoney(value);
  const hasCents = Math.abs(rounded - Math.round(rounded)) > 0.001;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(rounded);
}

export function formatPhoneDisplay(phone: string): string {
  const key = phoneKey(phone);
  if (key.length !== 10) return phone.trim();
  return `(${key.slice(0, 3)}) ${key.slice(3, 6)}-${key.slice(6)}`;
}

export function formatDobDisplay(dob: string): string {
  const key = dobKey(dob);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!iso) return dob.trim();
  return `${iso[2]}/${iso[3]}/${iso[1]}`;
}
