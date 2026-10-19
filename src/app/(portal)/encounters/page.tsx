import { EncounterWorkspace } from "@/components/encounter-workspace";

type PageProps = {
  searchParams: Promise<{
    patientId?: string;
    encounterId?: string;
    appointmentId?: string;
    questionnaire?: string;
  }>;
};

export default async function EncountersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const initialPatientId =
    typeof params.patientId === "string" && params.patientId.trim()
      ? params.patientId.trim()
      : undefined;
  const initialEncounterId =
    typeof params.encounterId === "string" && params.encounterId.trim()
      ? params.encounterId.trim()
      : undefined;

  // Handoff from the patient page's "+ Encounter". The patient page does NOT
  // create the encounter itself: it would have to navigate away immediately
  // afterwards, and the new record only lives in that page's React state, so
  // it dies on navigation and this page opens on an id that exists nowhere.
  // Instead it sends the appointment here and the workspace creates it in the
  // same state it then renders from — the path the on-page button already uses.
  const initialAppointmentId =
    typeof params.appointmentId === "string" && params.appointmentId.trim()
      ? params.appointmentId.trim()
      : undefined;

  // Patient file → "Insert into Objective": which questionnaire to put first.
  const initialQuestionnaireId =
    typeof params.questionnaire === "string" && /^[0-9a-f-]{36}$/i.test(params.questionnaire.trim())
      ? params.questionnaire.trim()
      : undefined;

  return (
    <EncounterWorkspace
      initialAppointmentId={initialAppointmentId}
      initialEncounterId={initialEncounterId}
      initialPatientId={initialPatientId}
      initialQuestionnaireId={initialQuestionnaireId}
    />
  );
}
