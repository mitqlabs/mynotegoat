"use client";

import { useEffect, useMemo, useState } from "react";
import { GoatPageView } from "@/components/goat-page-view";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { isAdminTier } from "@/lib/admin-access";
import { buildGoatPageModel } from "@/lib/goat-page-model";
import { onLocalChange } from "@/lib/local-sync";
import { patients, PATIENTS_STORAGE_KEY, updatePatientRecordById } from "@/lib/mock-data";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

export default function GoatPage() {
  const { roleTier } = useWorkspaceAccess();
  const { scheduleAppointments } = useScheduleAppointments();
  const { officeSettings } = useOfficeSettings();
  const { caseStatuses } = useCaseStatuses();
  const [listVersion, setListVersion] = useState(0);
  useEffect(() => onLocalChange(PATIENTS_STORAGE_KEY, () => setListVersion((v) => v + 1)), []);
  const model = useMemo(
    () =>
      buildGoatPageModel({
        now: new Date(),
        officeName: officeSettings.officeName,
        patients,
        appointments: scheduleAppointments,
        closedStatuses: caseStatuses.filter((s) => s.isCaseClosed).map((s) => s.name),
      }),
    [officeSettings.officeName, scheduleAppointments, caseStatuses, listVersion],
  );
  return (
    <GoatPageView
      isAdmin={isAdminTier(roleTier)}
      model={model}
      onMoveIntake={(id) => updatePatientRecordById(id, { onPatientList: true })}
    />
  );
}
