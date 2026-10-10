"use client";

import { useMemo } from "react";
import type { GoatContext } from "@/lib/goat";
import { goatContextFromRecords, goatPeople } from "@/lib/goat-context";
import { buildDischargeIndex } from "@/lib/discharge-date";
import { useGoatTerms } from "@/hooks/use-goat-terms";
import { useGoatFiles, type GoatFilesController } from "@/hooks/use-goat-files";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { useCaseNotes } from "@/hooks/use-case-notes";
import { usePatientDiagnoses } from "@/hooks/use-patient-diagnoses";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useEncounterNotes } from "@/hooks/use-encounter-notes";
import { useTreatmentPlans } from "@/hooks/use-treatment-plans";
import { usePatientBilling } from "@/hooks/use-patient-billing";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { loadPatientPagePrefs } from "@/lib/patient-page-prefs";
import type { PatientRecord } from "@/lib/mock-data";

/**
 * One patient's G.O.A.T. context for the global G.O.A.T. popup: the same
 * stored records, the same hidden-section / permission rules and the same
 * Patient Files reader as the Encounters G.O.A.T. (see encounter-goat.tsx).
 * Read-only; nothing leaves the browser.
 */
export function useGoatPatientContext(patient: PatientRecord): { context: GoatContext; files: GoatFilesController } {
  const { scheduleAppointments } = useScheduleAppointments();
  const { encounters: allEncounters } = useEncounterNotes();
  const { getPlansForPatient } = useTreatmentPlans();
  const { getRecord } = usePatientBilling();
  const { notes } = useCaseNotes(patient.id, patient.matrix?.notes ?? "");
  const { entries: diagnoses } = usePatientDiagnoses(patient.id);
  const { macroLibrary } = useMacroTemplates();
  const { sectionHidden, canView } = useWorkspaceAccess();
  const sectionModes = useMemo(() => loadPatientPagePrefs().mode as Record<string, string | undefined>, []);
  const { groups: termGroups } = useGoatTerms();
  const { contacts } = useContactDirectory();
  const filesHidden = sectionModes.patientFiles === "hide" || sectionHidden("patientFiles");
  const files = useGoatFiles(patient.id, !filesHidden);
  const canSeeContacts = canView("contacts");
  const appointments = useMemo(() => scheduleAppointments.filter((a) => a.patientId === patient.id), [scheduleAppointments, patient.id]);
  const encounters = useMemo(() => allEncounters.filter((e) => e.patientId === patient.id), [allEncounters, patient.id]);
  const dischargeIndex = useMemo(() => buildDischargeIndex(scheduleAppointments), [scheduleAppointments]);
  const plans = getPlansForPatient(patient.id);
  const billingRecord = getRecord(patient.id);

  const context = useMemo(() => {
    const chargesTotal = encounters.reduce((sum, e) => sum + e.charges.reduce((s, c) => s + c.unitPrice * c.units, 0), 0);
    const matrix = (patient.matrix ?? {}) as Record<string, string | undefined>;
    const fromMatrix = (v: string | undefined) => Number.parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")) || 0;
    const storedBilled = billingRecord ? billingRecord.billedAmount : fromMatrix(matrix.billed);
    const paid = billingRecord ? billingRecord.paidAmount : fromMatrix(matrix.paidAmount);
    const billed = chargesTotal > 0 ? chargesTotal : storedBilled;
    const base = goatContextFromRecords({
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
      dischargeIndex,
    });
    return {
      ...base,
      termGroups,
      people: goatPeople(base.specialists.map((s) => ({ name: s.name, sentDate: s.sentDate })), canSeeContacts ? contacts : []),
      files: files.enabled ? files.files : null,
    };
  }, [patient, appointments, dischargeIndex, encounters, notes, diagnoses, plans, macroLibrary.templates, billingRecord, sectionModes, sectionHidden, canView, termGroups, contacts, canSeeContacts, files.enabled, files.files]);

  return { context, files };
}
