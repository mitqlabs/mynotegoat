/**
 * Builds the GoatContext snapshot (see goat.ts) from stored records, for
 * places outside the patient page (the Encounters side-rail). The patient page
 * builds its own from live, unsaved form state, but shares these helpers so the
 * two read the data the same way.
 *
 * Privacy: `isHidden(key)` uses the same patient-page section keys and rules as
 * the patient page (office "hide" setting or hidden for this team member);
 * anything hidden is passed as null and never read. SOAP text also needs
 * Encounters access.
 */

import type { GoatContext, GoatImaging, GoatPlan } from "@/lib/goat";
import type { PatientRecord } from "@/lib/mock-data";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { EncounterNoteRecord } from "@/lib/encounter-notes";
import type { TreatmentPlan } from "@/lib/treatment-plans";
import type { PatientDiagnosisEntry } from "@/lib/patient-diagnoses";
import { normalizeReviewStatus } from "@/lib/review-status";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function goatToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** MM/DD/YYYY for ISO input; anything else passes through. */
function usDate(value: string | undefined): string {
  const s = (value ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : s;
}

type ImagingLike = {
  modalityLabel?: string;
  center?: string;
  regions?: string[];
  sentDate?: string;
  scheduledDate?: string;
  doneDate?: string;
  reportReceivedDate?: string;
  reportReviewedDate?: string;
  findings?: string;
  patientRefused?: boolean;
};

export function imagingToGoat(r: ImagingLike, fallbackModality: string): GoatImaging {
  return {
    modality: r.modalityLabel || fallbackModality,
    center: r.center ?? "",
    regions: Array.isArray(r.regions) ? r.regions : [],
    sentDate: r.sentDate ?? "",
    scheduledDate: r.scheduledDate ?? "",
    doneDate: r.doneDate ?? "",
    reportReceivedDate: r.reportReceivedDate ?? "",
    reportReviewedDate: r.reportReviewedDate ?? "",
    findings: r.findings ?? "",
    refused: r.patientRefused === true,
  };
}

export function planToGoat(plan: TreatmentPlan, macroName: (id: string) => string): GoatPlan {
  return {
    startDate: plan.startDate,
    endDate: plan.endDate,
    active: plan.active,
    weekdays: Object.entries(plan.days)
      .filter(([, regions]) => regions.length > 0)
      .map(([day]) => WEEKDAYS[Number(day)] ?? "")
      .filter(Boolean),
    regions: [
      ...new Set(
        [
          ...Object.values(plan.days).flat().map((r) => macroName(r.macroId)),
          plan.decompression?.region ? macroName(plan.decompression.region.macroId) : "",
        ].filter(Boolean),
      ),
    ],
  };
}

export function encounterToGoat(e: EncounterNoteRecord) {
  return {
    date: e.encounterDate,
    type: e.appointmentType,
    signed: e.signed,
    soap: {
      subjective: e.soap.subjective ?? "",
      objective: e.soap.objective ?? "",
      assessment: e.soap.assessment ?? "",
      plan: e.soap.plan ?? "",
    },
  };
}

type SpecialistLike = {
  specialist?: string;
  sentDate?: string;
  scheduledDate?: string;
  completedDate?: string;
  reportReceivedDate?: string;
  reportReviewedDate?: string;
  recommendations?: string;
  patientRefused?: boolean;
};

export function specialistToGoat(r: SpecialistLike) {
  return {
    name: r.specialist ?? "",
    sentDate: r.sentDate ?? "",
    scheduledDate: r.scheduledDate ?? "",
    completedDate: r.completedDate ?? "",
    reportReceivedDate: r.reportReceivedDate ?? "",
    reportReviewedDate: r.reportReviewedDate ?? "",
    recommendations: r.recommendations ?? "",
    refused: r.patientRefused === true,
  };
}

export function goatContextFromRecords(input: {
  patient: PatientRecord;
  appointments: ScheduleAppointmentRecord[];
  encounters: EncounterNoteRecord[];
  notes: string;
  diagnoses: PatientDiagnosisEntry[];
  plans: TreatmentPlan[];
  macroName: (id: string) => string;
  /** Same rule as the patient page: billed = encounter charges when any, else the stored figure. */
  billing: { billed: string; paid: string; paidDate: string };
  isHidden: (sectionKey: string) => boolean;
  canViewEncounters: boolean;
}): GoatContext {
  const { patient: p, isHidden } = input;
  const m = (p.matrix ?? {}) as Record<string, string | undefined>;
  const asList = (v: unknown) => (Array.isArray(v) ? (v as ImagingLike[]) : []);
  return {
    today: goatToday(),
    patientName: p.fullName,
    dob: usDate(p.dob),
    phone: p.phone ?? "",
    email: p.email ?? "",
    address: p.address ?? "",
    alerts: p.alerts ?? [],
    attorney: p.attorney ?? "",
    caseStatus: p.caseStatus ?? "",
    lien: m.lien ?? "",
    review: normalizeReviewStatus(m.review),
    isCashPatient: Boolean(p.isCashPatient),
    doi: usDate(p.dateOfLoss),
    initialExam: usDate(m.initialExam),
    priorCare: m.priorCare ?? "",
    xrayFindings: m.xrayFindings ?? "",
    mriFindings: m.mriCtFindings ?? "",
    specialistRecommendations: m.specialistRecommendations ?? "",
    imaging: [
      ...asList(p.xrayReferrals).map((r) => imagingToGoat(r, "X-Ray")),
      ...asList(p.mriReferrals).map((r) => imagingToGoat(r, "MRI")),
    ],
    specialists: (Array.isArray(p.specialistReferrals) ? (p.specialistReferrals as SpecialistLike[]) : []).map(
      specialistToGoat,
    ),
    notes: isHidden("notes") ? null : input.notes,
    appointments: isHidden("appointments")
      ? null
      : input.appointments.map((a) => ({ date: a.date, startTime: a.startTime, type: a.appointmentType, status: a.status })),
    encounters: isHidden("appointments") || !input.canViewEncounters ? null : input.encounters.map(encounterToGoat),
    plans: isHidden("treatmentPlan") ? null : input.plans.map((plan) => planToGoat(plan, input.macroName)),
    diagnoses: isHidden("diagnosis") ? null : input.diagnoses.map((d) => ({ code: d.code, description: d.description })),
    details: isHidden("additionalDetails") ? null : { discharge: usDate(m.discharge) },
    billing:
      isHidden("additionalDetails") || isHidden("billingFigures")
        ? null
        : { ...input.billing, rbSent: usDate(m.rbSent) },
  };
}
