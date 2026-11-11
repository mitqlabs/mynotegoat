/**
 * Stopgap until a patient file can hold more than one case.
 * A matching name can copy demographics into a new case. Case facts stay put.
 */
import { isShortTypo, matchNameToken } from "@/lib/goat-name-guard";
import { splitPatientName } from "@/lib/patient-duplicate";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { normalizeMaritalStatus, type MaritalStatus } from "@/lib/marital-status";

export type ReturningPatient = {
  id: string;
  fullName: string;
  dob?: string;
  phone?: string;
  sex?: string;
  maritalStatus?: string;
  email?: string;
  address?: string;
  isCashPatient?: boolean;
  deleted?: boolean;
};

export type ReturningDemographics = {
  phone: string;
  dob: string;
  sex: "" | "Male" | "Female";
  maritalStatus: MaritalStatus | "";
  addressStreet: string;
  addressUnit: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  email: string;
  isCashPatient: boolean;
};

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim();
}

function partHits(typed: string, part: string): boolean {
  const typedName = fold(typed);
  const existing = fold(part);
  if (typedName.length < 2 || existing.length < 2) return false;
  return matchNameToken(typedName, existing) !== null || isShortTypo(typedName, existing);
}

/** Both the last and first name have to match. One name part is not enough. */
export function findReturningPatients<T extends ReturningPatient>(
  patients: T[],
  input: { firstName: string; lastName: string },
): T[] {
  const first = input.firstName.trim();
  const last = input.lastName.trim();
  if (first.length < 2 || last.length < 2) return [];
  return patients.filter((patient) => {
    if (patient.deleted) return false;
    const name = splitPatientName(patient.fullName);
    return partHits(last, name.last) && partHits(first, name.first);
  });
}

export function returningNameKey(firstName: string, lastName: string): string {
  return `${fold(lastName).toLowerCase()}|${fold(firstName).toLowerCase()}`;
}

function formDob(value: string | undefined): string {
  const raw = (value ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  return raw;
}

function formPhone(value: string | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return formatUsPhoneInput(digits);
}

/** Stored "street, unit, City, CA 91205" back into the New Patient boxes. */
export function splitStoredAddress(address: string | undefined): Pick<
  ReturningDemographics,
  "addressStreet" | "addressUnit" | "addressCity" | "addressState" | "addressZip"
> {
  const empty = { addressStreet: "", addressUnit: "", addressCity: "", addressState: "", addressZip: "" };
  const raw = (address ?? "").trim();
  if (!raw || raw === "-") return empty;
  const tail = /^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(raw);
  if (!tail) return { ...empty, addressStreet: raw };
  const head = tail[1].split(",").map((part) => part.trim()).filter(Boolean);
  return {
    addressStreet: head[0] ?? "",
    addressUnit: head.slice(1).join(", "),
    addressCity: tail[2].trim(),
    addressState: tail[3].toUpperCase(),
    addressZip: tail[4],
  };
}

export function demographicsFromPatient(patient: ReturningPatient): ReturningDemographics {
  const sex = patient.sex === "Male" || patient.sex === "Female" ? patient.sex : "";
  const marital = normalizeMaritalStatus(patient.maritalStatus);
  return {
    phone: formPhone(patient.phone),
    dob: formDob(patient.dob),
    sex,
    maritalStatus: marital && marital !== "Other" ? marital : "",
    ...splitStoredAddress(patient.address),
    email: (patient.email ?? "").trim(),
    isCashPatient: patient.isCashPatient === true,
  };
}

function blank(value: string | undefined): boolean {
  const text = (value ?? "").trim();
  return !text || text === "-" || text === "—";
}

function blankPhone(value: string | undefined): boolean {
  return (value ?? "").replace(/\D/g, "").length === 0;
}

type FillableDraft = {
  phone: string;
  dob: string;
  sex?: string;
  maritalStatus?: string;
  addressStreet: string;
  addressUnit: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  email: string;
  isCashPatient: boolean;
};

/** Copy only empty demographic boxes. Attorney, date of loss, notes, and case fields are left untouched. */
export function fillEmptyDemographics<T extends FillableDraft>(draft: T, demo: ReturningDemographics): T {
  const next: T = { ...draft };
  if (blankPhone(next.phone) && demo.phone) next.phone = demo.phone;
  if (blank(next.dob) && demo.dob) next.dob = demo.dob;
  if (blank(next.sex) && demo.sex) next.sex = demo.sex as T["sex"];
  if (blank(next.maritalStatus) && demo.maritalStatus) next.maritalStatus = demo.maritalStatus as T["maritalStatus"];
  if (blank(next.addressStreet) && demo.addressStreet) next.addressStreet = demo.addressStreet;
  if (blank(next.addressUnit) && demo.addressUnit) next.addressUnit = demo.addressUnit;
  if (blank(next.addressCity) && demo.addressCity) next.addressCity = demo.addressCity;
  if (blank(next.addressState) && demo.addressState) next.addressState = demo.addressState;
  if (blank(next.addressZip) && demo.addressZip) next.addressZip = demo.addressZip;
  if (blank(next.email) && demo.email) next.email = demo.email;
  if (!next.isCashPatient && demo.isCashPatient) next.isCashPatient = true;
  return next;
}

export function returningPatientLabel(patient: Pick<ReturningPatient, "fullName" | "dob" | "phone">): string {
  const extra = [formDob(patient.dob), formPhone(patient.phone)].filter(Boolean);
  return extra.length ? `${patient.fullName} (${extra.join(", ")})` : patient.fullName;
}
