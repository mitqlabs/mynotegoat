/**
 * GOAT Page numbers from records the app already has: today's schedule,
 * patients without case info, and case counts. Mail, questions, and
 * to-dos are passed in later; they start at zero.
 */
import { isNewPatientAppointmentType } from "@/lib/initial-exam-date";
import { lienFollowUpStage } from "@/lib/follow-up-queue";
import { isInNewPatientIntake } from "@/lib/patient-list-intake";
import { to12hLabel } from "@/lib/time-12h";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";

export type GoatPagePatient = {
  id: string;
  fullName: string;
  caseStatus: string;
  dateOfLoss?: string;
  isCashPatient?: boolean;
  deleted?: boolean;
  onPatientList?: boolean;
  phone?: string;
  attorney?: string;
  matrix?: { lien?: string; rbSent?: string };
};

export type GoatPageScheduleRow = {
  id: string;
  time: string;
  name: string;
  detail: string;
  href: string;
  badge: string;
  tone: "next" | "confirmed" | "in" | "new" | "risk" | "canceled" | "done";
};

export type GoatPageModel = {
  greeting: string;
  dateLabel: string;
  officeName: string;
  appointments: number;
  mailNeedingAction: number;
  questions: number;
  intake: Array<{ id: string; name: string; detail: string; href: string }>;
  schedule: {
    confirmed: number;
    checkedIn: number;
    noShow: number;
    newPatients: number;
    rows: GoatPageScheduleRow[];
  };
  snapshot: {
    openCases: number;
    awaitingRb: number;
    missingLien: number;
    inIntake: number;
  };
};

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function goatPageDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function todayIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function minutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function buildGoatPageModel(input: {
  now: Date;
  officeName: string;
  patients: GoatPagePatient[];
  appointments: ScheduleAppointmentRecord[];
  closedStatuses: string[];
  mailNeedingAction?: number;
  questions?: number;
}): GoatPageModel {
  const iso = todayIso(input.now);
  const nowMin = input.now.getHours() * 60 + input.now.getMinutes();
  const closed = new Set(input.closedStatuses.map((s) => s.toLowerCase()));
  const livePatients = input.patients.filter((p) => !p.deleted);
  const intake = livePatients.filter((p) => isInNewPatientIntake(p));
  const day = input.appointments
    .filter((a) => a.date === iso)
    .slice()
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const active = day.filter((a) => a.status !== "Canceled");
  let nextId = "";
  for (const a of active) {
    if (a.status === "Scheduled" && minutes(a.startTime) >= nowMin) {
      nextId = a.id;
      break;
    }
  }
  const rows: GoatPageScheduleRow[] = day.map((a) => {
    const isNew = isNewPatientAppointmentType(a.appointmentType);
    let tone: GoatPageScheduleRow["tone"] = "confirmed";
    let badge = "Confirmed";
    if (a.status === "Canceled") {
      tone = "canceled";
      badge = "Canceled";
    } else if (a.status === "No Show") {
      tone = "risk";
      badge = "No-show";
    } else if (a.status === "Check In") {
      tone = "in";
      badge = "Checked in";
    } else if (a.status === "Check Out") {
      tone = "done";
      badge = "Checked out";
    } else if (a.id === nextId) {
      tone = "next";
      badge = "Arriving soon";
    } else if (isNew) {
      tone = "new";
      badge = "New Pt";
    }
    const label = to12hLabel(a.startTime);
    const [clock, mer] = label.split(" ");
    return {
      id: a.id,
      time: mer ? `${clock.replace(":00", "")} ${mer}` : label,
      name: a.patientName,
      detail: a.appointmentType || "Visit",
      href: `/patients/${a.patientId}`,
      badge,
      tone,
    };
  });
  const openCases = livePatients.filter(
    (p) => !p.isCashPatient && !closed.has(p.caseStatus.toLowerCase()) && !isInNewPatientIntake(p),
  );
  return {
    greeting: greeting(input.now.getHours()),
    dateLabel: goatPageDateLabel(input.now),
    officeName: input.officeName.trim() || "the office",
    appointments: active.length,
    mailNeedingAction: input.mailNeedingAction ?? 0,
    questions: input.questions ?? 0,
    intake: intake.map((p) => ({
      id: p.id,
      name: p.fullName,
      detail: p.phone?.trim() ? p.phone : "No phone yet",
      href: `/patients/${p.id}`,
    })),
    schedule: {
      confirmed: active.filter((a) => a.status === "Scheduled" || a.status === "Reschedule").length,
      checkedIn: active.filter((a) => a.status === "Check In").length,
      noShow: active.filter((a) => a.status === "No Show").length,
      newPatients: active.filter((a) => isNewPatientAppointmentType(a.appointmentType)).length,
      rows,
    },
    snapshot: {
      openCases: openCases.length,
      awaitingRb: openCases.filter((p) => {
        const status = p.caseStatus.toLowerCase();
        return status === "discharged" || status === "ready to submit";
      }).length,
      missingLien: openCases.filter((p) => lienFollowUpStage(p.matrix?.lien ?? "") === "Not sent yet").length,
      inIntake: intake.length,
    },
  };
}
