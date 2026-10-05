"use client";

import { useMemo } from "react";
import { GoatPanel } from "@/components/goat-panel";
import { goatContextFromRecords } from "@/lib/goat-context";
import { useCaseNotes } from "@/hooks/use-case-notes";
import { usePatientDiagnoses } from "@/hooks/use-patient-diagnoses";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { loadPatientPagePrefs } from "@/lib/patient-page-prefs";
import type { PatientRecord } from "@/lib/mock-data";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { EncounterNoteRecord } from "@/lib/encounter-notes";
import type { TreatmentPlan } from "@/lib/treatment-plans";

/**
 * G.O.A.T. in the Encounters side-rail: the same ask engine as the patient
 * page, reading this patient's stored file. Read-only; hidden sections follow
 * the patient page's rules; nothing leaves the app. Answers link to the
 * patient file in a new tab so the encounter being charted stays open.
 */
export function EncounterGoat({
  patient,
  appointments,
  encounters,
  plans,
  billingRecord,
}: {
  patient: PatientRecord;
  appointments: ScheduleAppointmentRecord[];
  encounters: EncounterNoteRecord[];
  plans: TreatmentPlan[];
  /** Stored billing record, if any (usePatientBilling). */
  billingRecord: { billedAmount: number; paidAmount: number; paidDate: string } | null | undefined;
}) {
  const { notes } = useCaseNotes(patient.id, patient.matrix?.notes ?? "");
  const { entries: diagnoses } = usePatientDiagnoses(patient.id);
  const { macroLibrary } = useMacroTemplates();
  const { sectionHidden, canView } = useWorkspaceAccess();
  const sectionModes = useMemo(() => loadPatientPagePrefs().mode as Record<string, string | undefined>, []);

  const context = useMemo(() => {
    const chargesTotal = encounters.reduce(
      (sum, e) => sum + e.charges.reduce((s, c) => s + c.unitPrice * c.units, 0),
      0,
    );
    // Same rule as the patient page: encounter charges when there are any,
    // else the billing record, else the legacy matrix figures.
    const matrix = (patient.matrix ?? {}) as Record<string, string | undefined>;
    const fromMatrix = (v: string | undefined) => Number.parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")) || 0;
    const storedBilled = billingRecord ? billingRecord.billedAmount : fromMatrix(matrix.billed);
    const paid = billingRecord ? billingRecord.paidAmount : fromMatrix(matrix.paidAmount);
    const billed = chargesTotal > 0 ? chargesTotal : storedBilled;
    return goatContextFromRecords({
      patient,
      appointments,
      encounters,
      notes,
      diagnoses,
      plans,
      macroName: (id) => macroLibrary.templates.find((t) => t.id === id)?.buttonName ?? "",
      billing: {
        billed: billed ? billed.toFixed(2) : "",
        paid: paid ? paid.toFixed(2) : "",
        paidDate: billingRecord?.paidDate ?? matrix.paidDate ?? "",
      },
      isHidden: (key) => sectionModes[key] === "hide" || sectionHidden(key),
      canViewEncounters: canView("encounters"),
    });
  }, [patient, appointments, encounters, notes, diagnoses, plans, macroLibrary.templates, billingRecord, sectionModes, sectionHidden, canView]);

  return <GoatPanel context={context} fileHref={`/patients/${encodeURIComponent(patient.id)}`} scope="file" />;
}
