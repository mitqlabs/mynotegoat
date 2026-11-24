/**
 * Fake chiropractic personal-injury office. Every name, address, and
 * message is made up. Phones are 555 numbers. Emails are @example.com.
 * Dates are counted from `now` so the office still looks current after a reset.
 */
import { brandFrom } from "@/lib/brand";
import { normalizeEntries } from "@/lib/case-note-entries";
import { getDefaultCaseStatusSettings, normalizeCaseStatusSettings } from "@/lib/case-statuses";
import { normalizeContactDirectory } from "@/lib/contact-directory";
import type { EncounterNoteRecord } from "@/lib/encounter-notes";
import { normalizeKeyDates } from "@/lib/key-dates";
import { statusOptions, type CaseStatus, type ContactRecord, type PatientRecord } from "@/lib/mock-data";
import { normalizeOfficeSettings, type OfficeSettings } from "@/lib/office-settings";
import { parseDateOnly } from "@/lib/age";
import { summarizeAge, summarizeSex } from "@/lib/patient-demographics";
import { normalizeFolderCloud } from "@/lib/patient-folder-store";
import { groupPatientCases } from "@/lib/patient-folders";
import { isInNewPatientIntake } from "@/lib/patient-list-intake";
import { summarizeLocations } from "@/lib/patient-locations";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { normalizeAppointmentTypes } from "@/lib/schedule-appointment-types";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { normalizeScheduleSettings } from "@/lib/schedule-settings";
import { normalizeSmsTemplates } from "@/lib/sms-template-core";
import { normalizeTasks } from "@/lib/tasks";
import { DEMO_GENERATION_KEY } from "@/lib/demo-office";

export interface DemoSeed {
  generation: string;
  patients: PatientRecord[];
  appointments: ScheduleAppointmentRecord[];
  notes: EncounterNoteRecord[];
  kv: Record<string, unknown>;
}

type City = "Glendale" | "Burbank" | "Pasadena" | "La Crescenta" | "Montrose" | "Eagle Rock";

const ZIPS: Record<City, string> = {
  Glendale: "91206",
  Burbank: "91502",
  Pasadena: "91101",
  "La Crescenta": "91214",
  Montrose: "91020",
  "Eagle Rock": "90041",
};

const HALE = "Hale & Ortega Law Group";
const NGUYEN = "Nguyen Injury Counsel";
const PARK = "Park & Diaz LLP";

type PersonSeed = {
  id: string;
  last: string;
  first: string;
  sex: "Male" | "Female";
  age: number;
  city: City;
  status: CaseStatus;
  attorney: string;
  intake?: boolean;
  cash?: boolean;
  twinOf?: string;
  alert?: string;
  priority?: PatientRecord["priority"];
  marital?: PatientRecord["maritalStatus"];
};

const PEOPLE: PersonSeed[] = [
  { id: "demo-p-01", last: "Alvarez", first: "Maya", sex: "Female", age: 34, city: "Glendale", status: "Active", attorney: HALE, marital: "Single", priority: "Normal" },
  { id: "demo-p-02", last: "Bennett", first: "Owen", sex: "Male", age: 41, city: "Burbank", status: "Active", attorney: NGUYEN, marital: "Married" },
  { id: "demo-p-03", last: "Cho", first: "Hannah", sex: "Female", age: 29, city: "Pasadena", status: "Active", attorney: PARK, marital: "Single", alert: "Second collision during care" },
  { id: "demo-p-03b", last: "Cho", first: "Hannah", sex: "Female", age: 29, city: "Pasadena", status: "Active", attorney: PARK, marital: "Single", twinOf: "demo-p-03" },
  { id: "demo-p-04", last: "Diaz", first: "Luis", sex: "Male", age: 52, city: "Glendale", status: "Ready To Submit", attorney: HALE, marital: "Married" },
  { id: "demo-p-05", last: "Ellis", first: "Nora", sex: "Female", age: 67, city: "Burbank", status: "Submitted", attorney: NGUYEN, marital: "Widowed" },
  { id: "demo-p-06", last: "Flores", first: "Andre", sex: "Male", age: 23, city: "Pasadena", status: "Paid", attorney: PARK, marital: "Single" },
  { id: "demo-p-07", last: "Grant", first: "Priya", sex: "Female", age: 45, city: "La Crescenta", status: "Dropped", attorney: HALE, marital: "Divorced", alert: "Stopped care after four visits" },
  { id: "demo-p-08", last: "Hassan", first: "Omar", sex: "Male", age: 38, city: "Montrose", status: "Active", attorney: NGUYEN, marital: "Married", priority: "MRI Due", alert: "Lumbar MRI still out" },
  { id: "demo-p-09", last: "Ibarra", first: "Sofia", sex: "Female", age: 16, city: "Glendale", status: "Active", attorney: PARK, marital: "Single" },
  { id: "demo-p-10", last: "Jensen", first: "Cole", sex: "Male", age: 71, city: "Pasadena", status: "Paid", attorney: HALE, marital: "Married" },
  { id: "demo-p-11", last: "Khan", first: "Leila", sex: "Female", age: 33, city: "Burbank", status: "Ready To Submit", attorney: NGUYEN, marital: "Married" },
  { id: "demo-p-12", last: "Lopez", first: "Mateo", sex: "Male", age: 58, city: "Eagle Rock", status: "Submitted", attorney: PARK, marital: "Married" },
  { id: "demo-p-13", last: "Morales", first: "Elena", sex: "Female", age: 27, city: "Glendale", status: "Active", attorney: "Self", marital: "Single" },
  { id: "demo-p-14", last: "Nguyen", first: "Brian", sex: "Male", age: 44, city: "Pasadena", status: "Discharged", attorney: HALE, marital: "Married" },
  { id: "demo-p-15", last: "Ortiz", first: "Camille", sex: "Female", age: 36, city: "Burbank", status: "Ready To Submit", attorney: PARK, marital: "Domestic Partner" },
  { id: "demo-p-16", last: "Patel", first: "Rohan", sex: "Male", age: 49, city: "Glendale", status: "Submitted", attorney: NGUYEN, marital: "Married" },
  { id: "demo-p-17", last: "Quinn", first: "Jade", sex: "Female", age: 22, city: "Pasadena", status: "Paid", attorney: "Self", marital: "Single" },
  { id: "demo-p-18", last: "Reyes", first: "Marco", sex: "Male", age: 63, city: "La Crescenta", status: "Dropped", attorney: HALE, marital: "Married" },
  { id: "demo-p-19", last: "Santos", first: "Amina", sex: "Female", age: 31, city: "Montrose", status: "Active", attorney: PARK, marital: "Single" },
  { id: "demo-p-20", last: "Tran", first: "Derek", sex: "Male", age: 19, city: "Burbank", status: "Active", attorney: NGUYEN, marital: "Single" },
  { id: "demo-p-21", last: "Unger", first: "Ruth", sex: "Female", age: 76, city: "Eagle Rock", status: "Paid", attorney: HALE, marital: "Widowed" },
  { id: "demo-p-22", last: "Walsh", first: "Irene", sex: "Female", age: 55, city: "Pasadena", status: "Active", attorney: HALE, marital: "Divorced", priority: "No Recent Update" },
  { id: "demo-p-23", last: "Brooks", first: "Calvin", sex: "Male", age: 40, city: "Glendale", status: "Active", attorney: "Self", cash: true, marital: "Married" },
  { id: "demo-p-24", last: "Young", first: "Caleb", sex: "Male", age: 28, city: "Burbank", status: "Active", attorney: "", intake: true, marital: "Single" },
  { id: "demo-p-25", last: "Zimmer", first: "Paige", sex: "Female", age: 39, city: "Glendale", status: "Active", attorney: "", intake: true, marital: "Married" },
  { id: "demo-p-26", last: "Okonkwo", first: "Ada", sex: "Female", age: 47, city: "Pasadena", status: "Active", attorney: "", intake: true, marital: "Single" },
];

const OFFICE_HOURS = [
  { dayOfWeek: 0, enabled: false, start: "08:00", end: "17:00" },
  { dayOfWeek: 1, enabled: true, start: "08:00", end: "18:00" },
  { dayOfWeek: 2, enabled: true, start: "08:00", end: "18:00" },
  { dayOfWeek: 3, enabled: true, start: "08:00", end: "18:00" },
  { dayOfWeek: 4, enabled: true, start: "08:00", end: "18:00" },
  { dayOfWeek: 5, enabled: false, start: "08:00", end: "17:00" },
  { dayOfWeek: 6, enabled: false, start: "09:00", end: "13:00" },
];

function atMidnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(now: Date, days: number): Date {
  const next = atMidnight(now);
  next.setDate(next.getDate() + days);
  return next;
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function us(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

function dobFor(now: Date, age: number, index: number): string {
  const month = index % 12;
  const day = 4 + (index % 24);
  return us(new Date(now.getFullYear() - age, month, day));
}

function phoneFor(index: number): string {
  return formatUsPhoneInput(`555010${String(index + 1).padStart(4, "0")}`);
}

function closedFriday(date: Date): boolean {
  return date.getDay() === 5 || date.getDay() === 0 || date.getDay() === 6;
}

function officeFor(city: City): string {
  if (city === "Burbank") return "Burbank";
  if (city === "Pasadena" || city === "Montrose") return "Pasadena";
  return "Glendale";
}

function locationId(city: City): string {
  const name = officeFor(city);
  return `loc-${name.toLowerCase()}`;
}

function matrixFor(person: PersonSeed, now: Date, index: number): PatientRecord["matrix"] {
  if (person.intake || person.cash) return { contact: us(addDays(now, -2)) };
  const matrix: NonNullable<PatientRecord["matrix"]> = {
    contact: us(addDays(now, -30 - index)),
    initialExam: us(addDays(now, -18 - (index % 5))),
    lien: person.status === "Paid" || person.status === "Submitted" ? "Received" : "Requested",
  };
  if (person.priority === "MRI Due") {
    matrix.mriSent = us(addDays(now, -12));
    matrix.mriScheduled = us(addDays(now, 3));
  }
  if (person.status === "Ready To Submit" || person.status === "Submitted" || person.status === "Paid" || person.status === "Discharged") {
    matrix.reExam1 = us(addDays(now, -12));
    matrix.discharge = us(addDays(now, -6));
  }
  if (person.status === "Submitted" || person.status === "Paid") {
    matrix.rbSent = us(addDays(now, -4));
    matrix.billed = person.status === "Paid" ? "5120" : "4680";
  }
  if (person.status === "Paid") {
    matrix.paidDate = us(addDays(now, -1));
    matrix.paidAmount = "5120";
    matrix.billPercent = "100";
  }
  if (person.status === "Dropped") matrix.notes = "Patient discontinued care. Chart kept open for the file.";
  return matrix;
}

function buildPatients(now: Date): PatientRecord[] {
  return PEOPLE.map((person, index) => {
    const twin = person.twinOf ? PEOPLE.find((row) => row.id === person.twinOf) : undefined;
    const source = twin ?? person;
    const sourceIndex = PEOPLE.findIndex((row) => row.id === source.id);
    const fullName = `${source.last}, ${source.first}`;
    const phone = phoneFor(sourceIndex);
    const email = `${source.first}.${source.last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.com";
    const address = `${1200 + sourceIndex * 18} Demo Ave, ${source.city}, CA ${ZIPS[source.city]}`;
    return {
      id: person.id,
      fullName,
      dob: dobFor(now, source.age, sourceIndex),
      sex: source.sex,
      maritalStatus: source.marital,
      phone,
      email,
      address,
      attorney: person.intake ? "" : person.attorney,
      caseStatus: person.status,
      dateOfLoss: person.cash ? "" : us(addDays(now, person.twinOf ? -12 : -40 - sourceIndex)),
      lastUpdate: us(now),
      priority: person.priority ?? "Normal",
      matrix: matrixFor(person, now, index),
      alerts: person.alert ? [person.alert] : undefined,
      isCashPatient: person.cash === true,
      locationId: locationId(source.city),
    };
  });
}

function openDays(now: Date): Date[] {
  // Last week (so SOAP notes and check-outs exist), this week, and next week.
  const sunday = addDays(now, -now.getDay() - 7);
  const days: Date[] = [];
  for (let offset = 0; offset < 21; offset += 1) {
    const day = addDays(sunday, offset);
    if (!closedFriday(day)) days.push(day);
  }
  return days;
}

const VISIT_TIMES = ["09:00", "10:30", "13:00", "14:30", "16:00"];
const VISIT_TYPES = ["Personal Injury Office Visit", "Personal Injury Re-Exam", "Spinal Decompression - L/S", "Personal Injury Office Visit"];

function buildAppointments(now: Date, patients: PatientRecord[]): ScheduleAppointmentRecord[] {
  const bookable = patients.filter((patient) => patient.attorney && !patient.isCashPatient);
  const days = openDays(now);
  const today = iso(now);
  const rows: ScheduleAppointmentRecord[] = [];
  days.forEach((day, dayIndex) => {
    const slots = dayIndex % 2 === 0 ? 3 : 2;
    for (let slot = 0; slot < slots; slot += 1) {
      const patient = bookable[(dayIndex * 3 + slot) % bookable.length];
      const date = iso(day);
      let status: ScheduleAppointmentRecord["status"] = "Scheduled";
      if (date < today) status = "Check Out";
      else if (date === today && slot === 0) status = "Check In";
      rows.push({
        id: `demo-a-${rows.length + 1}`,
        patientId: patient.id,
        patientName: patient.fullName,
        provider: "Dr. Elena Reyes",
        location: patient.locationId === "loc-burbank" ? "Burbank" : patient.locationId === "loc-pasadena" ? "Pasadena" : "Glendale",
        appointmentType: VISIT_TYPES[(dayIndex + slot) % VISIT_TYPES.length],
        caseLabel: "Personal Injury",
        room: slot % 2 === 0 ? "Room 1" : "Room 2",
        date,
        startTime: VISIT_TIMES[slot % VISIT_TIMES.length],
        durationMin: 30,
        status,
        note: "",
        overrideOfficeHours: false,
      });
    }
  });
  const cash = patients.find((patient) => patient.isCashPatient);
  if (cash) {
    const nextOpen = days.find((day) => iso(day) >= today) ?? days[0];
    rows.push({
      id: "demo-a-cash",
      patientId: cash.id,
      patientName: cash.fullName,
      provider: "Dr. Elena Reyes",
      location: "Glendale",
      appointmentType: "Cash Office Visit",
      caseLabel: "Cash",
      room: "Room 1",
      date: iso(nextOpen),
      startTime: "11:15",
      durationMin: 30,
      status: iso(nextOpen) === today ? "Scheduled" : "Scheduled",
      note: "",
      overrideOfficeHours: false,
    });
  }
  return rows;
}

const SOAP = [
  {
    subjective: "Neck and low back pain after a rear-end collision. Pain is 6/10 today. No new numbness, weakness, or bowel changes.",
    objective: "Cervical rotation is limited. Lumbar flexion is mildly limited. Tender at C5-C6 and L4-L5. Screen for red flags is negative.",
    assessment: "Cervical and lumbar sprain, consistent with the reported collision. Improving slowly with care.",
    plan: "Chiropractic manipulation and soft tissue work today. Home stretches. Recheck in one week.",
  },
  {
    subjective: "Headaches are less frequent. Mid-back stiffness is the main complaint. Sleep is fair. Pain 4/10.",
    objective: "Thoracic motion is restricted. Cervical motion is improved from the last visit. Neurologic screen remains intact.",
    assessment: "Thoracic strain with improving cervical sprain. No new injury reported.",
    plan: "Continue the current plan. Adjust the thoracic spine. Recheck symptoms next visit.",
  },
  {
    subjective: "Low back pain increased after sitting at work. No radiating pain past the knee today.",
    objective: "Lumbar extension is limited. Straight leg raise is negative. Paraspinal spasm on the right.",
    assessment: "Lumbar sprain, flared by sitting. Still appropriate for conservative care.",
    plan: "Manipulation, decompression, and a short walking break each hour. Follow the attorney's records request.",
  },
];

function buildNotes(now: Date, appointments: ScheduleAppointmentRecord[]): EncounterNoteRecord[] {
  const today = iso(now);
  return appointments
    .filter((visit) => visit.date < today && visit.appointmentType !== "Cash Office Visit")
    .slice(0, 12)
    .map((visit, index) => {
      const soap = SOAP[index % SOAP.length];
      const [year, month, day] = visit.date.split("-");
      const stamp = new Date(`${visit.date}T${visit.startTime}:00`).toISOString();
      return {
        id: `demo-n-${index + 1}`,
        patientId: visit.patientId,
        patientName: visit.patientName,
        provider: visit.provider,
        appointmentType: visit.appointmentType,
        encounterDate: `${month}/${day}/${year}`,
        startTime: visit.startTime,
        appointmentId: visit.id,
        soap: { ...soap },
        macroRuns: [],
        diagnoses: [
          { id: `demo-dx-${index + 1}`, code: index % 2 === 0 ? "M54.2" : "M54.50", description: index % 2 === 0 ? "Cervicalgia" : "Low back pain, unspecified", source: "Manual" },
        ],
        charges: [
          { id: `demo-ch-${index + 1}`, name: "Chiropractic manipulative treatment", procedureCode: "98941", unitPrice: 85, units: 1 },
        ],
        signed: true,
        signedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      };
    });
}

function officeSettings(now: Date): OfficeSettings {
  const hours = OFFICE_HOURS.map((row) => ({ ...row }));
  return normalizeOfficeSettings({
    officeName: "Summit Ridge Chiropractic",
    phone: "555-010-0190",
    fax: "555-010-0191",
    email: "office@example.com",
    address: "1800 Demo Ave, Glendale, CA 91206",
    doctorName: "Dr. Elena Reyes",
    logoDataUrl: "",
    deletePassword: "",
    multiLocation: true,
    doctors: [{ id: "doc-reyes", name: "Dr. Elena Reyes" }],
    locations: [
      { id: "loc-glendale", name: "Summit Ridge Chiropractic", nickname: "Glendale", address: "1800 Demo Ave, Glendale, CA 91206", addr1: "1800 Demo Ave", addr2: "", city: "Glendale", state: "CA", zip: "91206", phone: "555-010-0190", fax: "555-010-0191", email: "office@example.com", doctorIds: ["doc-reyes"], officeHours: hours },
      { id: "loc-burbank", name: "Summit Ridge Chiropractic", nickname: "Burbank", address: "420 Demo Blvd, Burbank, CA 91502", addr1: "420 Demo Blvd", addr2: "", city: "Burbank", state: "CA", zip: "91502", phone: "555-010-0192", fax: "555-010-0193", email: "burbank@example.com", doctorIds: ["doc-reyes"], officeHours: hours },
      { id: "loc-pasadena", name: "Summit Ridge Chiropractic", nickname: "Pasadena", address: "88 Demo St, Pasadena, CA 91101", addr1: "88 Demo St", addr2: "", city: "Pasadena", state: "CA", zip: "91101", phone: "555-010-0194", fax: "555-010-0195", email: "pasadena@example.com", doctorIds: ["doc-reyes"], officeHours: hours },
    ],
    caseNumberFormat: "{MMDDYY}{LAST2}{FIRST2}",
    claimDocument: "lien",
    savedAt: now.getTime(),
  });
}

function contacts(): ContactRecord[] {
  const rows: ContactRecord[] = [
    { id: "demo-c-hale", name: HALE, category: "Attorney", phone: "555-010-0201", email: "frontdesk.hale@example.com", address: "10 Counsel Row, Glendale, CA 91206" },
    { id: "demo-c-nguyen", name: NGUYEN, category: "Attorney", phone: "555-010-0202", email: "intake.nguyen@example.com", address: "22 Counsel Row, Burbank, CA 91502" },
    { id: "demo-c-park", name: PARK, category: "Attorney", phone: "555-010-0203", email: "records.park@example.com", address: "5 Counsel Row, Pasadena, CA 91101" },
    { id: "demo-c-mri", name: "Vega Open MRI", category: "Imaging Center", phone: "555-010-0210", email: "scheduling.vega@example.com", address: "700 Scan Way, Glendale, CA 91206" },
    { id: "demo-c-xray", name: "Foothill Imaging", category: "Imaging Center", phone: "555-010-0211", email: "films.foothill@example.com", address: "12 Scan Way, Pasadena, CA 91101" },
    { id: "demo-c-ortho", name: "Dr. Priya Shah Orthopedics", category: "Specialist", subCategory: "Orthopedic", phone: "555-010-0220", email: "referrals.shah@example.com", address: "40 Specialist Ct, Glendale, CA 91206" },
    { id: "demo-c-pain", name: "Dr. Luis Ortega Pain Management", category: "Specialist", subCategory: "Pain Management", phone: "555-010-0221", email: "clinic.ortega@example.com", address: "41 Specialist Ct, Burbank, CA 91502" },
    { id: "demo-c-urgent", name: "Verdugo Urgent Care", category: "Acute Care", phone: "555-010-0230", email: "records.verdugo@example.com", address: "9 Urgent Ln, Glendale, CA 91206" },
    { id: "demo-c-agent", name: "Mina Cho, State Farm", category: "Insurance Agent", subCategory: "State Farm", phone: "555-010-0240", email: "mina.cho.agent@example.com", address: "3 Agency Pl, Pasadena, CA 91101" },
  ];
  return normalizeContactDirectory(rows);
}

function billingMap(patients: PatientRecord[], now: Date): Record<string, unknown> {
  const stamp = now.toISOString();
  const map: Record<string, unknown> = {};
  for (const patient of patients) {
    if (patient.caseStatus !== "Submitted" && patient.caseStatus !== "Paid") continue;
    const paid = patient.caseStatus === "Paid";
    map[patient.id] = {
      patientId: patient.id,
      billedAmount: paid ? 5120 : 4680,
      paidAmount: paid ? 5120 : 0,
      paidDate: paid ? us(addDays(now, -1)) : "",
      adjustments: paid ? [] : [{ id: `demo-adj-${patient.id}`, label: "Pending reduction", amount: 0, note: "Waiting on the attorney.", createdAt: stamp, updatedAt: stamp }],
      createdAt: stamp,
      updatedAt: stamp,
    };
  }
  return map;
}

export function buildDemoSeed(now: Date = new Date()): DemoSeed {
  const patients = buildPatients(now);
  const appointments = buildAppointments(now, patients);
  const notes = buildNotes(now, appointments);
  const generation = now.toISOString();
  const stamp = generation;
  const training = addDays(now, 9);
  while (training.getDay() === 5 || training.getDay() === 0 || training.getDay() === 6) training.setDate(training.getDate() + 1);
  const covered = addDays(now, 2);
  while (covered.getDay() === 5 || covered.getDay() === 0 || covered.getDay() === 6) covered.setDate(covered.getDate() + 1);
  const twin = patients.find((patient) => patient.id === "demo-p-03");
  const kv: Record<string, unknown> = {
    [DEMO_GENERATION_KEY]: generation,
    "casemate.brand.v1": { theme: "blue" },
    "casemate.office-settings.v1": officeSettings(now),
    "casemate.schedule-settings.v1": normalizeScheduleSettings({
      enforceOfficeHours: true,
      allowOverride: true,
      appointmentIntervalMin: 15,
      maxAppointmentsPerSlot: 3,
      officeHours: OFFICE_HOURS,
    }),
    "casemate.schedule-appointment-types.v1": normalizeAppointmentTypes([
      { id: "demo-type-ov", name: "Personal Injury Office Visit", color: "#ef7984", durationMin: 30, isDefault: true, patientTypes: { pi: true, cash: false } },
      { id: "demo-type-np", name: "Personal Injury New Patient", color: "#e4e64a", durationMin: 60, isDefault: false, patientTypes: { pi: true, cash: false } },
      { id: "demo-type-re", name: "Personal Injury Re-Exam", color: "#f39a1f", durationMin: 45, isDefault: false, patientTypes: { pi: true, cash: false } },
      { id: "demo-type-dc", name: "Spinal Decompression - L/S", color: "#1f66e5", durationMin: 30, isDefault: false, patientTypes: { pi: true, cash: true } },
      { id: "demo-type-cash", name: "Cash Office Visit", color: "#84cd15", durationMin: 30, isDefault: false, patientTypes: { pi: false, cash: true } },
    ]),
    "casemate.contact-directory.v1": contacts(),
    "casemate.key-dates.v1": normalizeKeyDates([
      { id: "demo-kd-training", startDate: iso(training), endDate: iso(training), officeStatus: "Closed", reason: "Staff in-service" },
      { id: "demo-kd-cover", startDate: iso(covered), endDate: iso(covered), officeStatus: "Covered", reason: "Dr. Andre Walsh covering" },
    ]),
    "casemate.tasks.v1": normalizeTasks([
      { id: "demo-task-1", title: "Call Hale & Ortega about Maya Alvarez records", priority: "High", done: false, dueDate: iso(now), createdAt: stamp, updatedAt: stamp, patientId: "demo-p-01", patientName: "Alvarez, Maya", assignee: "Dr. Elena Reyes" },
      { id: "demo-task-2", title: "Check whether Omar Hassan's MRI report arrived", priority: "Urgent", done: false, dueDate: iso(addDays(now, -1)), createdAt: stamp, updatedAt: stamp, patientId: "demo-p-08", patientName: "Hassan, Omar" },
      { id: "demo-task-3", title: "Send Luis Diaz's packet — ready to submit", priority: "High", done: false, dueDate: iso(addDays(now, 1)), createdAt: stamp, updatedAt: stamp, patientId: "demo-p-04", patientName: "Diaz, Luis" },
      { id: "demo-task-4", title: "Confirm Camille Ortiz discharge note is signed", priority: "Medium", done: false, dueDate: iso(addDays(now, 2)), createdAt: stamp, updatedAt: stamp, patientId: "demo-p-15", patientName: "Ortiz, Camille" },
      { id: "demo-task-5", title: "Welcome call for new patient intakes", priority: "Medium", done: false, dueDate: iso(now), createdAt: stamp, updatedAt: stamp },
    ]),
    "casemate.patient-billing.v1": billingMap(patients, now),
    "casemate.case-statuses.v1": getDefaultCaseStatusSettings(),
    "casemate.onboarding.v1": { skippedSteps: [], completedAt: stamp },
    "casemate.case-note-entries.v1": normalizeEntries([
      { id: "demo-note-1", patientId: "demo-p-01", text: "Spoke with the law office. They will send the crash report this week.", date: iso(addDays(now, -1)), author: "Dr. Elena Reyes", authorUserId: "", createdAt: stamp, updatedAt: stamp },
      { id: "demo-note-2", patientId: "demo-p-08", text: "MRI facility said the report is with the radiologist.", date: iso(now), author: "Dr. Elena Reyes", authorUserId: "", createdAt: stamp, updatedAt: stamp },
      { id: "demo-note-3", patientId: "demo-p-04", text: "Final visit done. Packet is ready for the attorney.", date: iso(addDays(now, -2)), author: "Dr. Elena Reyes", authorUserId: "", createdAt: stamp, updatedAt: stamp },
    ]),
    "casemate.patient-folders.v1": normalizeFolderCloud({
      people: twin
        ? {
            "pf-demo-p-03": {
              folderId: "pf-demo-p-03",
              fullName: twin.fullName,
              dob: twin.dob,
              phone: twin.phone,
              email: twin.email ?? "",
              address: twin.address ?? "",
              sex: twin.sex ?? "",
              maritalStatus: twin.maritalStatus ?? "",
              alerts: ["Two open collisions"],
              updatedAt: stamp,
            },
          }
        : {},
      notes: twin
        ? [{ id: "demo-fn-1", folderId: "pf-demo-p-03", text: "Same person, two collisions. Keep the files separate.", date: iso(now), author: "Dr. Elena Reyes", authorUserId: "", createdAt: stamp, updatedAt: stamp }]
        : [],
      todos: twin
        ? [{ id: "demo-ft-1", folderId: "pf-demo-p-03", title: "Ask which collision the next visit is for", dueDate: iso(now), done: false, updatedAt: stamp }]
        : [],
    }),
    "casemate.sms-templates.v1": normalizeSmsTemplates([
      { id: "demo-sms-1", name: "Visit reminder", body: "Hello {{FIRST_NAME}}, this is Summit Ridge Chiropractic. Reminder for your visit on {{APPT_DATE}} at {{TIME}}.", createdAt: stamp, updatedAt: stamp },
      { id: "demo-sms-2", name: "Records follow up", body: "Hello {{FIRST_NAME}}, please call Summit Ridge Chiropractic when you can. We have a question about your file.", createdAt: stamp, updatedAt: stamp },
    ]),
  };
  return { generation, patients, appointments, notes, kv };
}

/** Problems the app's own normalizers would drop or reject. Empty means the seed is safe to insert. */
export function demoSeedProblems(seed: DemoSeed): string[] {
  const problems: string[] = [];
  const blob = JSON.stringify(seed);
  const emails = blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  if (emails.some((email) => !email.toLowerCase().endsWith("@example.com"))) problems.push("An email is not @example.com.");
  const phones = blob.match(/\d{3}-\d{3}-\d{4}/g) ?? [];
  if (phones.some((phone) => !phone.startsWith("555"))) problems.push("A phone number is not a 555 number.");
  for (const patient of seed.patients) {
    if (!statusOptions.includes(patient.caseStatus)) problems.push(`Bad status ${patient.caseStatus}`);
    if (patient.phone !== formatUsPhoneInput(patient.phone) || !patient.phone.startsWith("555")) problems.push(`Bad phone ${patient.phone}`);
    if (patient.email && !patient.email.endsWith("@example.com")) problems.push(`Bad email ${patient.email}`);
    if (!parseDateOnly(patient.dob)) problems.push(`Bad DOB ${patient.dob}`);
  }
  const contactsOk = normalizeContactDirectory(seed.kv["casemate.contact-directory.v1"]);
  if (contactsOk.length < 6) problems.push("Contacts were dropped by the directory normalizer.");
  const tasksOk = normalizeTasks(seed.kv["casemate.tasks.v1"]);
  if (tasksOk.length < 5) problems.push("To-dos were dropped.");
  const datesOk = normalizeKeyDates(seed.kv["casemate.key-dates.v1"]);
  if (datesOk.length < 2) problems.push("Key dates were dropped.");
  const schedule = normalizeScheduleSettings(seed.kv["casemate.schedule-settings.v1"]);
  if (schedule.officeHours.find((day) => day.dayOfWeek === 5)?.enabled !== false) problems.push("Friday is not closed.");
  const types = normalizeAppointmentTypes(seed.kv["casemate.schedule-appointment-types.v1"]);
  if (types.length < 4) problems.push("Appointment types were dropped.");
  if (brandFrom(seed.kv["casemate.brand.v1"]).theme !== "blue") problems.push("Theme is not NoteGoat Blue.");
  if (normalizeCaseStatusSettings(seed.kv["casemate.case-statuses.v1"]).statuses.length < 5) problems.push("Case statuses were dropped.");
  if (normalizeSmsTemplates(seed.kv["casemate.sms-templates.v1"]).length < 2) problems.push("Text templates were dropped.");
  if (normalizeEntries(seed.kv["casemate.case-note-entries.v1"]).length < 3) problems.push("Case notes were dropped.");
  const folders = normalizeFolderCloud(seed.kv["casemate.patient-folders.v1"]);
  if (!folders.people["pf-demo-p-03"]) problems.push("Patient folder record was dropped.");
  const office = normalizeOfficeSettings(seed.kv["casemate.office-settings.v1"]);
  if (office.officeName !== "Summit Ridge Chiropractic" || office.locations.length < 3) problems.push("Office settings were dropped.");
  const required: Array<PatientRecord["caseStatus"]> = ["Active", "Ready To Submit", "Submitted", "Paid", "Dropped"];
  for (const status of required) {
    if (!seed.patients.some((patient) => patient.caseStatus === status)) problems.push(`Missing status ${status}`);
  }
  const intake = seed.patients.filter((patient) => isInNewPatientIntake(patient, seed.appointments));
  if (intake.length < 3) problems.push("New-patient intake is empty.");
  if (seed.appointments.some((visit) => new Date(`${visit.date}T12:00:00`).getDay() === 5)) problems.push("A visit is booked on Friday.");
  if (seed.notes.some((note) => !note.soap.subjective || !note.soap.objective || !note.soap.assessment || !note.soap.plan)) {
    problems.push("A SOAP note is missing a section.");
  }
  const places = summarizeLocations(seed.patients, "city");
  for (const city of ["Glendale", "Burbank", "Pasadena"]) {
    if (!places.rows.some((row) => row.city === city && row.count > 0)) problems.push(`No patients in ${city}`);
  }
  const sex = summarizeSex(seed.patients);
  if ((sex.rows.find((row) => row.label === "Male")?.count ?? 0) < 5) problems.push("Not enough male patients.");
  if ((sex.rows.find((row) => row.label === "Female")?.count ?? 0) < 5) problems.push("Not enough female patients.");
  const ages = summarizeAge(seed.patients, seed.generation);
  if (ages.rows.filter((row) => row.count > 0).length < 4) problems.push("Ages are not spread out.");
  const grouped = groupPatientCases(seed.patients.map((patient) => ({ id: patient.id, fullName: patient.fullName, dob: patient.dob, phone: patient.phone, address: patient.address })));
  if (!grouped.folders.some((folder) => folder.caseIds.length > 1)) problems.push("No patient has two cases.");
  if (seed.patients.length < 25) problems.push("Fewer than 25 cases.");
  return problems;
}

export function patientSeedRows(patients: PatientRecord[], workspaceId: string) {
  return patients.map((patient) => ({
    id: patient.id,
    workspace_id: workspaceId,
    full_name: patient.fullName,
    dob: patient.dob,
    sex: patient.sex ?? null,
    marital_status: patient.maritalStatus ?? null,
    phone: patient.phone,
    email: patient.email ?? null,
    address: patient.address ?? null,
    attorney: patient.attorney ?? "",
    case_status: patient.caseStatus,
    date_of_loss: patient.dateOfLoss,
    last_update: patient.lastUpdate,
    priority: patient.priority,
    matrix: patient.matrix ?? null,
    related_cases: patient.relatedCases ?? null,
    xray_referrals: patient.xrayReferrals ?? null,
    mri_referrals: patient.mriReferrals ?? null,
    specialist_referrals: patient.specialistReferrals ?? null,
    alerts: patient.alerts ?? null,
    is_cash_patient: patient.isCashPatient === true,
    location_id: patient.locationId ?? null,
    text_reminders_off: false,
  }));
}

export function appointmentSeedRows(appointments: ScheduleAppointmentRecord[], workspaceId: string) {
  return appointments.map((visit) => ({
    id: visit.id,
    workspace_id: workspaceId,
    patient_id: visit.patientId,
    patient_name: visit.patientName,
    provider: visit.provider,
    location: visit.location,
    appointment_type: visit.appointmentType,
    case_label: visit.caseLabel,
    room: visit.room,
    date: visit.date,
    start_time: visit.startTime,
    duration_min: visit.durationMin,
    status: visit.status,
    note: visit.note,
    override_office_hours: false,
    recurring_series_id: null,
  }));
}

export function noteSeedRows(notes: EncounterNoteRecord[], workspaceId: string) {
  return notes.map((note) => ({
    id: note.id,
    workspace_id: workspaceId,
    patient_id: note.patientId,
    patient_name: note.patientName,
    provider: note.provider,
    appointment_type: note.appointmentType,
    encounter_date: note.encounterDate,
    start_time: note.startTime,
    soap: note.soap,
    macro_runs: note.macroRuns,
    diagnoses: note.diagnoses,
    charges: note.charges,
    signed: note.signed,
    signed_at: note.signedAt,
    created_at_record: note.createdAt,
    updated_at_record: note.updatedAt,
  }));
}

export function kvSeedRows(kv: Record<string, unknown>, workspaceId: string) {
  return Object.entries(kv).map(([key, value]) => ({ workspace_id: workspaceId, key, value }));
}
