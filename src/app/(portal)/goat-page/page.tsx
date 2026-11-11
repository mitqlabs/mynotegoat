"use client";

import { useEffect, useMemo, useState } from "react";
import { GoatBriefingBoard } from "@/components/goat-briefing-board";
import { GoatMailBoard, GoatMailSecretNotice, useGoatMail } from "@/components/goat-mail-board";
import { GoatPageView } from "@/components/goat-page-view";
import { UntouchedItems } from "@/components/untouched-items";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { useEncounterNotes } from "@/hooks/use-encounter-notes";
import { useKeyDates } from "@/hooks/use-key-dates";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { useTasks } from "@/hooks/use-tasks";
import { buildCloseout } from "@/lib/goat-closeout";
import { isAdminTier } from "@/lib/admin-access";
import { buildGoatPageModel } from "@/lib/goat-page-model";
import {
  listUntouchedItems,
  loadHandledMarks,
  markHandled,
  saveHandledMarks,
  GOAT_UNTOUCHED_KEY,
  type HandledMark,
} from "@/lib/goat-untouched";
import { onLocalChange } from "@/lib/local-sync";
import { patients, PATIENTS_STORAGE_KEY } from "@/lib/mock-data";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

export default function GoatPage() {
  const { roleTier } = useWorkspaceAccess();
  const { scheduleAppointments } = useScheduleAppointments();
  const { officeSettings } = useOfficeSettings();
  const { caseStatuses } = useCaseStatuses();
  const { tasks } = useTasks();
  const { encountersByNewest } = useEncounterNotes();
  const { scheduleSettings } = useScheduleSettings();
  const { keyDates } = useKeyDates();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const [listVersion, setListVersion] = useState(0);
  const [handled, setHandled] = useState<HandledMark[]>([]);
  useEffect(() => onLocalChange(PATIENTS_STORAGE_KEY, () => setListVersion((v) => v + 1)), []);
  useEffect(() => {
    setHandled(loadHandledMarks());
    return onLocalChange(GOAT_UNTOUCHED_KEY, () => setHandled(loadHandledMarks()));
  }, []);
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
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const untouched = useMemo(
    () =>
      listUntouchedItems({
        todayIso: iso,
        patients,
        appointments: scheduleAppointments,
        tasks,
        handled,
      }),
    [iso, scheduleAppointments, tasks, handled, listVersion],
  );
  const mail = useGoatMail({
    patients,
    appointments: scheduleAppointments,
    claimDocument: officeSettings.claimDocument,
    listVersion,
  });
  const closeout = useMemo(
    () =>
      buildCloseout({
        todayIso: iso,
        appointments: scheduleAppointments,
        notes: encountersByNewest,
        settings: scheduleSettings,
      }),
    [iso, scheduleAppointments, encountersByNewest, scheduleSettings],
  );
  return (
    <GoatPageView model={{ ...model, mailNeedingAction: mail.actionCount, questions: mail.questionCount }}>
      <GoatBriefingBoard
        answers={
          <GoatMailBoard
            notice={mail.notice}
            onAnswer={mail.answer}
            onConnect={() => void mail.connect()}
            onDisconnect={() => void mail.disconnect()}
            onResolve={mail.resolve}
            rows={mail.rows}
            status={mail.status}
            variant="questions"
          />
        }
        appointments={scheduleAppointments}
        caseStatuses={caseStatuses}
        closeout={closeout}
        appointmentTypes={appointmentTypes.map((row) => row.name)}
        isAdmin={isAdminTier(roleTier)}
        keyDates={keyDates}
        mail={
          <GoatMailBoard
            notice={mail.notice}
            onAnswer={mail.answer}
            onConnect={() => void mail.connect()}
            onDisconnect={() => void mail.disconnect()}
            onResolve={mail.resolve}
            rows={mail.rows}
            status={mail.status}
            variant="triage"
          />
        }
        model={model}
        patients={patients}
        scheduleSettings={scheduleSettings}
        todayIso={iso}
        todos={
          <>
            <GoatMailSecretNotice expiresOn={mail.status?.secretExpiresOn} />
            <UntouchedItems
              items={untouched}
              onHandled={(id) => {
                const next = markHandled(handled, id, "", new Date().toISOString());
                setHandled(next);
                void saveHandledMarks(next);
              }}
            />
          </>
        }
      />
    </GoatPageView>
  );
}
