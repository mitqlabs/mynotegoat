"use client";

import { useEffect, useState } from "react";
import { GoatMailBoard, useGoatMail } from "@/components/goat-mail-board";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { onLocalChange } from "@/lib/local-sync";
import { patients, PATIENTS_STORAGE_KEY } from "@/lib/mock-data";

export default function GoatMailPage() {
  const { officeSettings } = useOfficeSettings();
  const { scheduleAppointments } = useScheduleAppointments();
  const [listVersion, setListVersion] = useState(0);
  useEffect(() => onLocalChange(PATIENTS_STORAGE_KEY, () => setListVersion((v) => v + 1)), []);
  const mail = useGoatMail({
    patients,
    appointments: scheduleAppointments,
    claimDocument: officeSettings.claimDocument,
    listVersion,
  });
  return (
    <GoatMailBoard
      notice={mail.notice}
      onAnswer={mail.answer}
      onConnect={() => void mail.connect()}
      onDisconnect={() => void mail.disconnect()}
      onResolve={mail.resolve}
      rows={mail.rows}
      status={mail.status}
      variant="page"
    />
  );
}
