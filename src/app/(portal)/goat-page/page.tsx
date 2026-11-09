"use client";

import { useEffect, useMemo, useState } from "react";
import { GoatMailBoard, useGoatMail } from "@/components/goat-mail-board";
import { GoatPageView } from "@/components/goat-page-view";
import { GoatCloseout } from "@/components/goat-closeout";
import { GoatHandoff } from "@/components/goat-handoff";
import { UntouchedItems } from "@/components/untouched-items";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { useEncounterNotes } from "@/hooks/use-encounter-notes";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { useTasks } from "@/hooks/use-tasks";
import { buildCloseout } from "@/lib/goat-closeout";
import { buildHandoff } from "@/lib/goat-handoff";
import { to12hLabel } from "@/lib/time-12h";
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
import { patients, PATIENTS_STORAGE_KEY, updatePatientRecordById } from "@/lib/mock-data";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

export default function GoatPage() {
  const { roleTier } = useWorkspaceAccess();
  const { scheduleAppointments } = useScheduleAppointments();
  const { officeSettings } = useOfficeSettings();
  const { caseStatuses } = useCaseStatuses();
  const { tasks } = useTasks();
  const { encountersByNewest } = useEncounterNotes();
  const { scheduleSettings } = useScheduleSettings();
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
    <GoatPageView
      isAdmin={isAdminTier(roleTier)}
      model={{ ...model, mailNeedingAction: mail.actionCount, questions: mail.questionCount }}
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
      questions={
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
      onMoveIntake={(id) => updatePatientRecordById(id, { onPatientList: true })}
      todos={
        <UntouchedItems
          items={untouched}
          onHandled={(id) => {
            const next = markHandled(handled, id, "", new Date().toISOString());
            setHandled(next);
            void saveHandledMarks(next);
          }}
        />
      }
      closeout={<GoatCloseout model={closeout} />}
      handoff={
        <GoatHandoff
          {...buildHandoff({
            officeName: model.officeName,
            dateLabel: model.dateLabel,
            seen: scheduleAppointments.filter((a) => a.date === iso && a.status === "Check Out").length,
            noShows: scheduleAppointments
              .filter((a) => a.date === iso && a.status === "No Show")
              .map((a) => ({ name: a.patientName })),
            intake: patients.filter((p) => model.intake.some((row) => row.id === p.id)).map((p) => ({
              name: p.fullName,
              missing: [
                !(p.phone && p.phone !== "-") ? "phone" : "",
                !p.dateOfLoss ? "date of injury" : "",
                !(p.attorney && p.attorney !== "Self") ? "attorney" : "",
              ].filter(Boolean),
            })),
            waiting: untouched,
            openings: closeout.openings,
            tomorrowClosed: closeout.tomorrowClosed,
            rebooks: scheduleAppointments
              .filter((a) => a.status === "Reschedule" && a.date >= iso)
              .map((a) => ({ name: a.patientName, when: `${a.date} ${to12hLabel(a.startTime)}` })),
          })}
        />
      }
    />
  );
}
