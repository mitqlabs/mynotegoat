/**
 * Casemate MySQL dump parser.
 *
 * Reads a MySQL dump (.sql) file as a string and extracts structured data
 * from INSERT statements for every CM_* table. Returns typed maps so the
 * admin migration page can render previews and push data to Supabase.
 */

/* ------------------------------------------------------------------ */
/*  Raw row types matching the MySQL schema                           */
/* ------------------------------------------------------------------ */

export interface RawChiro {
  chiro_id: number;
  chiro_name: string;
  chiro_address: string;
  chiro_city: string;
  chiro_state: string;
  chiro_postal_code: string;
  chiro_phone: string;
  chiro_website: string;
  active: string;
}

export interface RawChiroUser {
  chiro_user_id: number;
  chiro_id: number;
  email: string;
  firstname: string;
  lastname: string;
  phone: string;
  active: string;
  owner: string;
}

export interface RawLawyer {
  lawyer_id: number;
  lawyer: string;
  chiro_id: number;
  active: string;
  lawyer_phone: string;
}

export interface RawStatus {
  status_id: number;
  status: string;
  status_color: string;
  active: string;
}

export interface RawLien {
  lien_id: number;
  lien: string;
  active: string;
}

export interface RawPrior {
  prior_id: number;
  prior: string;
  chiro_id: number;
  active: string;
}

export interface RawReview {
  review_id: number;
  review: string;
  active: string;
}

export interface RawXray {
  xray_id: number;
  xray: string;
  chiro_id: number;
  active: string;
}

export interface RawSpecialist {
  specialist_id: number;
  specialist: string;
  chiro_id: number;
  active: string;
}

export interface RawPatient {
  patient_id: number;
  chiro_user_id: number;
  chiro_id: number;
  lawyer_id: number;
  initial_exam: string;
  date_of_loss: string;
  patient_dob: string;
  lien_id: number;
  prior_id: number;
  status_id: number;
  xray_sent_date: string;
  xray_id: number;
  xray_done: string;
  xray_received: string;
  xray_reviewed: string;
  mri_sent_date: string;
  mri_id: number;
  mri_scheduled: string;
  mri_received: string;
  mri_reviewed: string;
  discharge_date: string;
  rb_sent: string;
  billed: string;
  paid_date: string;
  paid_amount: string;
  notes: string;
  review_id: number;
  patient_added: string;
  mri_done: string;
  patient_last_date: string;
  active: string;
  patient_attorney_phone: string;
  xray_sent: string;
  xray_received_checked: string;
  xray_reviewed_checked: string;
  mri_sent: string;
  mri_received_checked: string;
  mri_reviewed_checked: string;
  patient_firstname: string;
  patient_lastname: string;
}

export interface RawPatientContact {
  contact_id: number;
  patient_id: number;
  patient_email: string;
  patient_phone: string;
  active: string;
}

export interface RawPatientReexam {
  reexam_id: number;
  patient_id: number;
  reexam: string;
  active: string;
}

export interface RawPatientRelated {
  patient_id: number;
  related_id: number;
}

export interface RawPatientSpecialist {
  patient_specialist_id: number;
  patient_id: number;
  specialist_id: number;
  specialist_sent: string;
  specialist_scheduled: string;
  active: string;
  report_received: string;
}

export interface RawRolodex {
  rolodex_id: number;
  chiro_id: number;
  rolodex_category: string;
  rolodex_name: string;
  rolodex_phone: string;
  rolodex_fax: string;
  rolodex_email: string;
  rolodex_notes: string;
  active: string;
}

/* ------------------------------------------------------------------ */
/*  Parsed output                                                     */
/* ------------------------------------------------------------------ */

export interface CasemateData {
  chiros: RawChiro[];
  chiroUsers: RawChiroUser[];
  lawyers: RawLawyer[];
  statuses: RawStatus[];
  liens: RawLien[];
  priors: RawPrior[];
  reviews: RawReview[];
  xrays: RawXray[];
  specialists: RawSpecialist[];
  patients: RawPatient[];
  patientContacts: RawPatientContact[];
  patientReexams: RawPatientReexam[];
  patientRelated: RawPatientRelated[];
  patientSpecialists: RawPatientSpecialist[];
  rolodex: RawRolodex[];
}

/* ------------------------------------------------------------------ */
/*  MySQL INSERT value parser                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse a MySQL INSERT statement and return an array of value tuples.
 * Each tuple is an array of raw string values (unquoted).
 *
 * Handles:
 *  - Single-quoted strings with escaped quotes (\' and '')
 *  - Numeric values
 *  - NULL
 *  - Multi-row inserts: VALUES (...),(...);
 */
function parseInsertValues(sql: string): string[][] {
  // Find the VALUES portion
  // Accept both " VALUES " and "VALUES " (findInsertBlock omits leading space)
  let valuesIdx = sql.indexOf(" VALUES ");
  let offset = 8; // length of " VALUES "
  if (valuesIdx === -1) {
    valuesIdx = sql.indexOf("VALUES ");
    offset = 7; // length of "VALUES "
  }
  if (valuesIdx === -1) return [];
  const body = sql.slice(valuesIdx + offset).replace(/;\s*$/, "");

  const rows: string[][] = [];
  let i = 0;

  while (i < body.length) {
    // Find start of next tuple
    const openParen = body.indexOf("(", i);
    if (openParen === -1) break;

    i = openParen + 1;
    const values: string[] = [];
    let current = "";
    let inQuote = false;

    while (i < body.length) {
      const ch = body[i];

      if (inQuote) {
        if (ch === "\\") {
          // Escaped char
          i++;
          if (i < body.length) current += body[i];
          i++;
          continue;
        }
        if (ch === "'") {
          // Check for doubled quote ''
          if (i + 1 < body.length && body[i + 1] === "'") {
            current += "'";
            i += 2;
            continue;
          }
          // End of quoted string
          inQuote = false;
          i++;
          continue;
        }
        current += ch;
        i++;
        continue;
      }

      // Not in quote
      if (ch === "'") {
        inQuote = true;
        i++;
        continue;
      }
      if (ch === ",") {
        values.push(current.trim());
        current = "";
        i++;
        continue;
      }
      if (ch === ")") {
        values.push(current.trim());
        rows.push(values);
        i++;
        break;
      }
      current += ch;
      i++;
    }
  }

  return rows;
}

function toNum(val: string): number {
  if (val === "NULL" || val === "") return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function toStr(val: string): string {
  return val === "NULL" ? "" : val;
}

/* ------------------------------------------------------------------ */
/*  Table-specific parsers                                            */
/* ------------------------------------------------------------------ */

function findInsertBlock(sql: string, table: string): string | null {
  // Search for the exact INSERT INTO `table` VALUES marker.
  // Uses indexOf instead of regex to avoid backtick escaping issues
  // across different JS runtimes / bundlers.
  const marker = "INSERT INTO `" + table + "` VALUES ";
  const start = sql.indexOf(marker);
  if (start === -1) return null;

  // Extract from VALUES to the next semicolon that ends the statement.
  // The INSERT data may contain semicolons inside quoted strings, so we
  // need to be aware of quoting — but MySQL dumps always end the INSERT
  // on a single line with ");", so finding ");" is safe.
  const valuesStart = start + marker.length;
  const endMarker = ");";
  const endIdx = sql.indexOf(endMarker, valuesStart);
  if (endIdx === -1) return null;

  return "VALUES " + sql.slice(valuesStart, endIdx + 1) + ";";
}

function parseChiros(sql: string): RawChiro[] {
  const block = findInsertBlock(sql, "CM_chiro");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    chiro_id: toNum(r[0]),
    chiro_name: toStr(r[1]),
    chiro_address: toStr(r[2]),
    chiro_city: toStr(r[3]),
    chiro_state: toStr(r[4]),
    chiro_postal_code: toStr(r[5]),
    chiro_phone: toStr(r[6]),
    chiro_website: toStr(r[7]),
    active: toStr(r[9]),
  }));
}

function parseChiroUsers(sql: string): RawChiroUser[] {
  const block = findInsertBlock(sql, "CM_chiro_user");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    chiro_user_id: toNum(r[0]),
    chiro_id: toNum(r[1]),
    email: toStr(r[2]),
    firstname: toStr(r[3]),
    lastname: toStr(r[4]),
    phone: toStr(r[5]),
    active: toStr(r[7]),
    owner: toStr(r[8]),
  }));
}

function parseLawyers(sql: string): RawLawyer[] {
  const block = findInsertBlock(sql, "CM_lawyer");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    lawyer_id: toNum(r[0]),
    lawyer: toStr(r[1]),
    chiro_id: toNum(r[4]),
    active: toStr(r[5]),
    lawyer_phone: toStr(r[7]),
  }));
}

function parseStatuses(sql: string): RawStatus[] {
  const block = findInsertBlock(sql, "CM_status");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    status_id: toNum(r[0]),
    status: toStr(r[1]),
    status_color: toStr(r[2]),
    active: toStr(r[4]),
  }));
}

function parseLiens(sql: string): RawLien[] {
  const block = findInsertBlock(sql, "CM_lien");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    lien_id: toNum(r[0]),
    lien: toStr(r[1]),
    active: toStr(r[3]),
  }));
}

function parsePriors(sql: string): RawPrior[] {
  const block = findInsertBlock(sql, "CM_prior");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    prior_id: toNum(r[0]),
    prior: toStr(r[1]),
    chiro_id: toNum(r[3]),
    active: toStr(r[4]),
  }));
}

function parseReviews(sql: string): RawReview[] {
  const block = findInsertBlock(sql, "CM_review");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    review_id: toNum(r[0]),
    review: toStr(r[1]),
    active: toStr(r[3]),
  }));
}

function parseXrays(sql: string): RawXray[] {
  const block = findInsertBlock(sql, "CM_xray");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    xray_id: toNum(r[0]),
    xray: toStr(r[1]),
    chiro_id: toNum(r[3]),
    active: toStr(r[4]),
  }));
}

function parseSpecialists(sql: string): RawSpecialist[] {
  const block = findInsertBlock(sql, "CM_specialist");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    specialist_id: toNum(r[0]),
    specialist: toStr(r[1]),
    chiro_id: toNum(r[3]),
    active: toStr(r[4]),
  }));
}

function parsePatients(sql: string): RawPatient[] {
  const block = findInsertBlock(sql, "CM_patient");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    patient_id: toNum(r[0]),
    chiro_user_id: toNum(r[1]),
    chiro_id: toNum(r[2]),
    lawyer_id: toNum(r[3]),
    initial_exam: toStr(r[4]),
    date_of_loss: toStr(r[5]),
    patient_dob: toStr(r[6]),
    lien_id: toNum(r[7]),
    prior_id: toNum(r[8]),
    status_id: toNum(r[9]),
    xray_sent_date: toStr(r[10]),
    xray_id: toNum(r[11]),
    xray_done: toStr(r[12]),
    xray_received: toStr(r[13]),
    xray_reviewed: toStr(r[14]),
    mri_sent_date: toStr(r[15]),
    mri_id: toNum(r[16]),
    mri_scheduled: toStr(r[17]),
    mri_received: toStr(r[18]),
    mri_reviewed: toStr(r[19]),
    discharge_date: toStr(r[20]),
    rb_sent: toStr(r[21]),
    billed: toStr(r[22]),
    paid_date: toStr(r[23]),
    paid_amount: toStr(r[24]),
    notes: toStr(r[25]),
    review_id: toNum(r[26]),
    patient_added: toStr(r[27]),
    mri_done: toStr(r[28]),
    patient_last_date: toStr(r[29]),
    active: toStr(r[30]),
    patient_attorney_phone: toStr(r[31]),
    xray_sent: toStr(r[32]),
    xray_received_checked: toStr(r[33]),
    xray_reviewed_checked: toStr(r[34]),
    mri_sent: toStr(r[35]),
    mri_received_checked: toStr(r[36]),
    mri_reviewed_checked: toStr(r[37]),
    patient_firstname: toStr(r[38]),
    patient_lastname: toStr(r[39]),
  }));
}

function parsePatientContacts(sql: string): RawPatientContact[] {
  const block = findInsertBlock(sql, "CM_patient_contact");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    contact_id: toNum(r[0]),
    patient_id: toNum(r[1]),
    patient_email: toStr(r[2]),
    patient_phone: toStr(r[3]),
    active: toStr(r[4]),
  }));
}

function parsePatientReexams(sql: string): RawPatientReexam[] {
  const block = findInsertBlock(sql, "CM_patient_reexam");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    reexam_id: toNum(r[0]),
    patient_id: toNum(r[1]),
    reexam: toStr(r[2]),
    active: toStr(r[3]),
  }));
}

function parsePatientRelated(sql: string): RawPatientRelated[] {
  const block = findInsertBlock(sql, "CM_patient_related");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    patient_id: toNum(r[0]),
    related_id: toNum(r[1]),
  }));
}

function parsePatientSpecialists(sql: string): RawPatientSpecialist[] {
  const block = findInsertBlock(sql, "CM_patient_specialist");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    patient_specialist_id: toNum(r[0]),
    patient_id: toNum(r[1]),
    specialist_id: toNum(r[2]),
    specialist_sent: toStr(r[3]),
    specialist_scheduled: toStr(r[4]),
    active: toStr(r[5]),
    report_received: toStr(r[6]),
  }));
}

function parseRolodex(sql: string): RawRolodex[] {
  const block = findInsertBlock(sql, "CM_rolodex");
  if (!block) return [];
  return parseInsertValues(block).map((r) => ({
    rolodex_id: toNum(r[0]),
    chiro_id: toNum(r[1]),
    rolodex_category: toStr(r[2]),
    rolodex_name: toStr(r[3]),
    rolodex_phone: toStr(r[4]),
    rolodex_fax: toStr(r[5]),
    rolodex_email: toStr(r[6]),
    rolodex_notes: toStr(r[7]),
    active: toStr(r[8]),
  }));
}

/* ------------------------------------------------------------------ */
/*  Main entry                                                        */
/* ------------------------------------------------------------------ */

export function parseCasemateSql(sql: string): CasemateData {
  return {
    chiros: parseChiros(sql),
    chiroUsers: parseChiroUsers(sql),
    lawyers: parseLawyers(sql),
    statuses: parseStatuses(sql),
    liens: parseLiens(sql),
    priors: parsePriors(sql),
    reviews: parseReviews(sql),
    xrays: parseXrays(sql),
    specialists: parseSpecialists(sql),
    patients: parsePatients(sql),
    patientContacts: parsePatientContacts(sql),
    patientReexams: parsePatientReexams(sql),
    patientRelated: parsePatientRelated(sql),
    patientSpecialists: parsePatientSpecialists(sql),
    rolodex: parseRolodex(sql),
  };
}

/* ------------------------------------------------------------------ */
/*  Data mapper: old Casemate rows → My Note Goat records             */
/* ------------------------------------------------------------------ */

/** Legacy MySQL rolodex category → new-schema { category, subCategory }.
 *  In My Note Goat 2026+, every contact has one of three fixed top-level
 *  categories (Attorney, Imaging Center, Specialist) plus an optional
 *  sub-category label. */
const ROLODEX_CATEGORY_MAP: Record<
  string,
  { category: "Attorney" | "Imaging Center" | "Specialist"; subCategory?: string }
> = {
  A: { category: "Attorney" },
  P: { category: "Specialist", subCategory: "Pain Management" },
  O: { category: "Specialist", subCategory: "Orthopedic" },
  N: { category: "Specialist", subCategory: "Neurologist" },
  H: { category: "Specialist", subCategory: "Hospital/ER" },
};

function isEmptyDate(d: string): boolean {
  return !d || d === "0000-00-00" || d === "NULL";
}

function formatDate(d: string): string {
  if (isEmptyDate(d)) return "";
  // Convert MySQL YYYY-MM-DD to US MM/DD/YYYY
  const match = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}/${match[3]}/${match[1]}`;
  return d;
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

export interface ImagingReferralData {
  id: string;
  sentDate: string;
  center: string;
  isCt?: boolean;
  regions: string[];
  lateralityByRegion: Record<string, string>;
  flexExtRegions: string[];
  scheduledDate: string;
  doneDate: string;
  reportReceivedDate: string;
  reportReviewedDate: string;
  findings: string;
  modalityLabel: "X-Ray" | "MRI" | "CT";
}

export interface MappedPatient {
  id: string;
  full_name: string;
  dob: string;
  phone: string;
  email: string | null;
  attorney: string;
  case_status: string;
  date_of_loss: string;
  last_update: string;
  priority: string;
  matrix: Record<string, string>;
  related_cases: { patientId: string; fullName: string; dateOfLoss: string }[] | null;
  specialist_referrals: {
    id: string;
    specialist: string;
    sentDate: string;
    scheduledDate: string;
    completedDate: string;
    reportReceivedDate: string;
    reportReviewedDate: string;
    recommendations: string;
  }[] | null;
  alerts: string[] | null;
  notes: string;
  sex: null;
  marital_status: null;
  address: null;
  xray_referrals: ImagingReferralData[] | null;
  mri_referrals: ImagingReferralData[] | null;
}

export interface MappedContact {
  id: string;
  name: string;
  category: "Attorney" | "Imaging Center" | "Specialist";
  subCategory?: string;
  phone: string;
  email: string;
  fax: string;
  address: string;
}

export interface ChiroMigrationPreview {
  chiro: RawChiro;
  ownerEmail: string;
  patientCount: number;
  contactCount: number;
}

export interface ChiroMigrationPayload {
  chiroId: number;
  patients: MappedPatient[];
  contacts: MappedContact[];
}

export function getChiroPreviews(data: CasemateData): ChiroMigrationPreview[] {
  return data.chiros
    .filter((c) => c.active === "Y")
    .map((chiro) => {
      const owner = data.chiroUsers.find(
        (u) => u.chiro_id === chiro.chiro_id && u.owner === "Y" && u.active === "Y"
      );
      const patientCount = data.patients.filter(
        (p) => p.chiro_id === chiro.chiro_id
      ).length;
      const contactCount = data.rolodex.filter(
        (r) => r.chiro_id === chiro.chiro_id && r.active === "Y"
      ).length;
      return {
        chiro,
        ownerEmail: owner?.email ?? "unknown",
        patientCount,
        contactCount,
      };
    });
}

function buildXrayReferral(
  p: RawPatient,
  facilityName: string
): ImagingReferralData[] | null {
  // Only create a referral if there's any X-ray data
  const hasSent = p.xray_sent === "Y" || !isEmptyDate(p.xray_sent_date);
  const hasDone = !isEmptyDate(p.xray_done);
  const hasReceived = p.xray_received_checked === "Y" || !isEmptyDate(p.xray_received);
  const hasReviewed = p.xray_reviewed_checked === "Y" || !isEmptyDate(p.xray_reviewed);
  if (!hasSent && !hasDone && !hasReceived && !hasReviewed && !facilityName) return null;

  return [
    {
      id: `cm-xray-${p.patient_id}`,
      sentDate: formatDate(p.xray_sent_date),
      center: facilityName,
      regions: [],
      lateralityByRegion: {},
      flexExtRegions: [],
      scheduledDate: "",
      doneDate: formatDate(p.xray_done),
      reportReceivedDate: formatDate(p.xray_received),
      reportReviewedDate: formatDate(p.xray_reviewed),
      findings: "",
      modalityLabel: "X-Ray",
    },
  ];
}

function buildMriReferral(
  p: RawPatient,
  facilityName: string
): ImagingReferralData[] | null {
  const hasSent = p.mri_sent === "Y" || !isEmptyDate(p.mri_sent_date);
  const hasScheduled = !isEmptyDate(p.mri_scheduled);
  const hasDone = !isEmptyDate(p.mri_done);
  const hasReceived = p.mri_received_checked === "Y" || !isEmptyDate(p.mri_received);
  const hasReviewed = p.mri_reviewed_checked === "Y" || !isEmptyDate(p.mri_reviewed);
  if (!hasSent && !hasScheduled && !hasDone && !hasReceived && !hasReviewed && !facilityName) return null;

  return [
    {
      id: `cm-mri-${p.patient_id}`,
      sentDate: formatDate(p.mri_sent_date),
      center: facilityName,
      regions: [],
      lateralityByRegion: {},
      flexExtRegions: [],
      scheduledDate: formatDate(p.mri_scheduled),
      doneDate: formatDate(p.mri_done),
      reportReceivedDate: formatDate(p.mri_received),
      reportReviewedDate: formatDate(p.mri_reviewed),
      findings: "",
      modalityLabel: "MRI",
    },
  ];
}

export function buildMigrationPayload(
  data: CasemateData,
  chiroId: number
): ChiroMigrationPayload {
  // Build lookup maps
  const lawyerMap = new Map<number, RawLawyer>();
  data.lawyers.forEach((l) => lawyerMap.set(l.lawyer_id, l));

  const statusMap = new Map<number, string>();
  data.statuses.forEach((s) => statusMap.set(s.status_id, s.status));

  const lienMap = new Map<number, string>();
  data.liens.forEach((l) => lienMap.set(l.lien_id, l.lien));

  const priorMap = new Map<number, string>();
  data.priors.forEach((p) => priorMap.set(p.prior_id, p.prior));

  const reviewMap = new Map<number, string>();
  data.reviews.forEach((r) => reviewMap.set(r.review_id, r.review));

  const xrayMap = new Map<number, string>();
  data.xrays.forEach((x) => xrayMap.set(x.xray_id, x.xray));

  const specialistMap = new Map<number, string>();
  data.specialists.forEach((s) => specialistMap.set(s.specialist_id, s.specialist));

  // Patient contacts (email/phone)
  const contactsByPatient = new Map<number, RawPatientContact[]>();
  data.patientContacts.forEach((c) => {
    if (c.active !== "Y") return;
    const list = contactsByPatient.get(c.patient_id) ?? [];
    list.push(c);
    contactsByPatient.set(c.patient_id, list);
  });

  // Patient re-exams
  const reexamsByPatient = new Map<number, RawPatientReexam[]>();
  data.patientReexams.forEach((r) => {
    if (r.active !== "Y") return;
    const list = reexamsByPatient.get(r.patient_id) ?? [];
    list.push(r);
    reexamsByPatient.set(r.patient_id, list);
  });

  // Patient specialists
  const specsByPatient = new Map<number, RawPatientSpecialist[]>();
  data.patientSpecialists.forEach((ps) => {
    if (ps.active !== "Y") return;
    const list = specsByPatient.get(ps.patient_id) ?? [];
    list.push(ps);
    specsByPatient.set(ps.patient_id, list);
  });

  // Related cases
  const relatedByPatient = new Map<number, number[]>();
  data.patientRelated.forEach((r) => {
    const list = relatedByPatient.get(r.patient_id) ?? [];
    list.push(r.related_id);
    relatedByPatient.set(r.patient_id, list);
  });

  // Map of patient_id → patient for related case lookups
  const patientById = new Map<number, RawPatient>();
  data.patients.forEach((p) => patientById.set(p.patient_id, p));

  // Status mapping from old Casemate uppercase → My Note Goat title case
  const statusMapping: Record<string, string> = {
    ACTIVE: "Active",
    DISCHARGED: "Discharged",
    "READY TO SUBMIT": "Ready To Submit",
    SUBMITTED: "Submitted",
    DROPPED: "Dropped",
    PAID: "Paid",
  };

  // Filter patients for this chiro
  const chiroPatients = data.patients.filter((p) => p.chiro_id === chiroId);

  const patients: MappedPatient[] = chiroPatients.map((p) => {
    const lawyer = lawyerMap.get(p.lawyer_id);
    const rawStatus = statusMap.get(p.status_id) ?? "ACTIVE";
    const caseStatus = statusMapping[rawStatus.toUpperCase()] ?? "Active";
    const lien = lienMap.get(p.lien_id) ?? "";
    const prior = priorMap.get(p.prior_id) ?? "";
    const review = reviewMap.get(p.review_id) ?? "";
    const xrayFacility = xrayMap.get(p.xray_id) ?? "";
    const mriFacility = xrayMap.get(p.mri_id) ?? "";

    const contacts = contactsByPatient.get(p.patient_id) ?? [];
    const reexams = (reexamsByPatient.get(p.patient_id) ?? [])
      .sort((a, b) => a.reexam.localeCompare(b.reexam));
    const specs = specsByPatient.get(p.patient_id) ?? [];
    const relatedIds = relatedByPatient.get(p.patient_id) ?? [];

    // Build name
    const firstName = toTitleCase(p.patient_firstname.trim());
    const lastName = toTitleCase(p.patient_lastname.trim());
    const fullName = (firstName && lastName ? `${lastName}, ${firstName}` : firstName || lastName).trim() || "Unknown";

    // Contact info from patient_contact table
    const email = contacts.find((c) => c.patient_email)?.patient_email ?? null;
    const phone = contacts.find((c) => c.patient_phone)?.patient_phone ?? "";

    // Build matrix
    const matrix: Record<string, string> = {};
    if (!isEmptyDate(p.initial_exam)) matrix.initialExam = formatDate(p.initial_exam);
    if (lien) matrix.lien = lien;
    if (prior) matrix.priorCare = prior;
    if (p.xray_sent === "Y" || !isEmptyDate(p.xray_sent_date)) {
      matrix.xraySent = formatDate(p.xray_sent_date) || "Y";
    }
    if (!isEmptyDate(p.xray_done)) matrix.xrayDone = formatDate(p.xray_done);
    if (p.xray_received_checked === "Y" || !isEmptyDate(p.xray_received)) {
      matrix.xrayReceived = formatDate(p.xray_received) || "Y";
    }
    if (p.xray_reviewed_checked === "Y" || !isEmptyDate(p.xray_reviewed)) {
      matrix.xrayReviewed = formatDate(p.xray_reviewed) || "Y";
    }
    if (xrayFacility) matrix.xrayFindings = xrayFacility;
    if (p.mri_sent === "Y" || !isEmptyDate(p.mri_sent_date)) {
      matrix.mriSent = formatDate(p.mri_sent_date) || "Y";
    }
    if (!isEmptyDate(p.mri_scheduled)) matrix.mriScheduled = formatDate(p.mri_scheduled);
    if (!isEmptyDate(p.mri_done)) matrix.mriDone = formatDate(p.mri_done);
    if (p.mri_received_checked === "Y" || !isEmptyDate(p.mri_received)) {
      matrix.mriReceived = formatDate(p.mri_received) || "Y";
    }
    if (p.mri_reviewed_checked === "Y" || !isEmptyDate(p.mri_reviewed)) {
      matrix.mriReviewed = formatDate(p.mri_reviewed) || "Y";
    }
    if (mriFacility) matrix.mriCtFindings = mriFacility;

    // Re-exams
    if (reexams[0]) matrix.reExam1 = formatDate(reexams[0].reexam);
    if (reexams[1]) matrix.reExam2 = formatDate(reexams[1].reexam);
    if (reexams[2]) matrix.reExam3 = formatDate(reexams[2].reexam);

    // Specialist aggregation
    if (specs.length > 0) {
      const firstSpec = specs[0];
      if (!isEmptyDate(firstSpec.specialist_sent)) {
        matrix.specialistSent = formatDate(firstSpec.specialist_sent);
      }
      if (!isEmptyDate(firstSpec.specialist_scheduled)) {
        matrix.specialistScheduled = formatDate(firstSpec.specialist_scheduled);
      }
      if (firstSpec.report_received === "Y") {
        matrix.specialistReport = "Received";
      }
    }

    // Discharge/billing
    if (!isEmptyDate(p.discharge_date)) matrix.discharge = formatDate(p.discharge_date);
    if (!isEmptyDate(p.rb_sent)) matrix.rbSent = formatDate(p.rb_sent);
    if (p.billed && p.billed !== "0.00") matrix.billed = `$${p.billed}`;
    if (!isEmptyDate(p.paid_date)) matrix.paidDate = formatDate(p.paid_date);
    if (p.paid_amount && p.paid_amount !== "0.00") matrix.paidAmount = `$${p.paid_amount}`;
    if (review) matrix.review = review;
    if (p.notes) matrix.notes = p.notes;

    // Contact info in matrix
    if (phone || email) {
      const parts: string[] = [];
      if (phone) parts.push(phone);
      if (email) parts.push(email);
      matrix.contact = parts.join(" / ");
    }

    // Related cases
    let relatedCases: MappedPatient["related_cases"] = null;
    if (relatedIds.length > 0) {
      relatedCases = relatedIds
        .map((rid) => {
          const rel = patientById.get(rid);
          if (!rel) return null;
          const rFirst = toTitleCase(rel.patient_firstname.trim());
          const rLast = toTitleCase(rel.patient_lastname.trim());
          return {
            patientId: `cm-patient-${rid}`,
            fullName: `${rFirst} ${rLast}`.trim() || "Unknown",
            dateOfLoss: formatDate(rel.date_of_loss),
          };
        })
        .filter(Boolean) as MappedPatient["related_cases"];
    }

    // Specialist referrals
    let specialistReferrals: MappedPatient["specialist_referrals"] = null;
    if (specs.length > 0) {
      specialistReferrals = specs.map((s, idx) => ({
        id: `cm-spec-${p.patient_id}-${idx}`,
        specialist: specialistMap.get(s.specialist_id) ?? `Specialist #${s.specialist_id}`,
        sentDate: formatDate(s.specialist_sent),
        scheduledDate: formatDate(s.specialist_scheduled),
        completedDate: "",
        reportReceivedDate: s.report_received === "Y" ? formatDate(s.specialist_scheduled) : "",
        reportReviewedDate: "",
        recommendations: "",
      }));
    }

    // Last update: use most recent date we can find
    const dateCandidates = [
      p.patient_last_date,
      p.discharge_date,
      p.paid_date,
      p.rb_sent,
      p.initial_exam,
      p.patient_added,
    ].filter((d) => !isEmptyDate(d));
    const lastUpdate = dateCandidates.sort().pop() ?? formatDate(p.patient_added);

    return {
      id: `cm-patient-${p.patient_id}`,
      full_name: fullName,
      dob: formatDate(p.patient_dob),
      phone,
      email,
      attorney: lawyer ? toTitleCase(lawyer.lawyer) : "",
      case_status: caseStatus,
      date_of_loss: formatDate(p.date_of_loss),
      last_update: lastUpdate,
      priority: "Normal",
      matrix,
      related_cases: relatedCases,
      specialist_referrals: specialistReferrals,
      alerts: null,
      notes: p.notes,
      sex: null,
      marital_status: null,
      address: null,
      xray_referrals: buildXrayReferral(p, xrayFacility),
      mri_referrals: buildMriReferral(p, mriFacility),
    };
  });

  // Rolodex → contacts
  const chiroRolodex = data.rolodex.filter(
    (r) => r.chiro_id === chiroId && r.active === "Y"
  );
  const contacts: MappedContact[] = chiroRolodex.map((r) => {
    const mapping = ROLODEX_CATEGORY_MAP[r.rolodex_category] ?? { category: "Attorney" as const };
    return {
      id: `cm-contact-${r.rolodex_id}`,
      name: r.rolodex_name,
      category: mapping.category,
      ...(mapping.subCategory ? { subCategory: mapping.subCategory } : {}),
      phone: r.rolodex_phone,
      email: r.rolodex_email,
      fax: r.rolodex_fax,
      address: "",
    };
  });

  return { chiroId, patients, contacts };
}
