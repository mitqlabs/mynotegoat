/**
 * Untouched front-desk items. They stay until someone marks them handled
 * or the underlying fact goes away (lien received, R&B sent, visit booked).
 *
 * Handled marks live in workspace_kv (casemate.goat-untouched.v1), union-merged
 * by id so two computers don't wipe each other. The patients table RLS still
 * gates who can read the cases these rows point at.
 */
import { extractLeadingDatePart, lienFollowUpStage, toDateStampFromUs } from "@/lib/follow-up-queue";
import { unionMerge } from "@/lib/kv-merge";
import { isInNewPatientIntake } from "@/lib/patient-list-intake";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { TaskRecord } from "@/lib/tasks";

export const GOAT_UNTOUCHED_KEY = "casemate.goat-untouched.v1";

export type UntouchedKind = "lien" | "rb" | "medicals" | "unbooked";

export type UntouchedItem = {
  id: string;
  kind: UntouchedKind;
  patientId: string;
  patientName: string;
  href: string;
  title: string;
  detail: string;
};

export type HandledMark = {
  id: string;
  handled: boolean;
  by: string;
  updatedAt: string;
};

type PatientLike = {
  id: string;
  fullName: string;
  caseStatus: string;
  dateOfLoss?: string;
  isCashPatient?: boolean;
  deleted?: boolean;
  onPatientList?: boolean;
  matrix?: { lien?: string; rbSent?: string };
};

function isoStamp(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysSinceUs(us: string, todayIso: string): number | null {
  const stamp = toDateStampFromUs(us);
  const today = isoStamp(todayIso);
  if (!stamp || !today) return null;
  return Math.floor((today - stamp) / 86400000);
}

function hasFutureVisit(patientId: string, appointments: ScheduleAppointmentRecord[], todayIso: string): boolean {
  return appointments.some(
    (a) => a.patientId === patientId && a.date >= todayIso && a.status !== "Canceled" && a.status !== "No Show",
  );
}

export function listUntouchedItems(input: {
  todayIso: string;
  patients: PatientLike[];
  appointments: ScheduleAppointmentRecord[];
  tasks?: TaskRecord[];
  handled?: HandledMark[];
}): UntouchedItem[] {
  const hidden = new Set((input.handled ?? []).filter((m) => m.handled).map((m) => m.id));
  const items: UntouchedItem[] = [];
  const push = (item: UntouchedItem) => {
    if (!hidden.has(item.id)) items.push(item);
  };
  for (const patient of input.patients) {
    if (patient.deleted) continue;
    const href = `/patients/${patient.id}`;
    if (isInNewPatientIntake(patient) && !hasFutureVisit(patient.id, input.appointments, input.todayIso)) {
      push({
        id: `unbooked:${patient.id}`,
        kind: "unbooked",
        patientId: patient.id,
        patientName: patient.fullName,
        href,
        title: "Unbooked referral",
        detail: "No visit on the schedule yet",
      });
    }
    if (patient.isCashPatient) continue;
    const lien = patient.matrix?.lien ?? "";
    if (lienFollowUpStage(lien) === "Requested, waiting for received") {
      const days = daysSinceUs(extractLeadingDatePart(lien), input.todayIso);
      if (days !== null && days >= 7) {
        push({
          id: `lien:${patient.id}:7`,
          kind: "lien",
          patientId: patient.id,
          patientName: patient.fullName,
          href,
          title: "Lien/LOP requested, not signed",
          detail: `7-day nudge — ${days} days`,
        });
      } else if (days !== null && days >= 3) {
        push({
          id: `lien:${patient.id}:3`,
          kind: "lien",
          patientId: patient.id,
          patientName: patient.fullName,
          href,
          title: "Lien/LOP requested, not signed",
          detail: `3-day nudge — ${days} days`,
        });
      }
    }
    const status = patient.caseStatus.toLowerCase();
    if ((status === "discharged" || status === "ready to submit") && !(patient.matrix?.rbSent ?? "").trim()) {
      push({
        id: `rb:${patient.id}`,
        kind: "rb",
        patientId: patient.id,
        patientName: patient.fullName,
        href,
        title: "R&B not sent",
        detail: patient.caseStatus,
      });
    }
  }
  for (const task of input.tasks ?? []) {
    if (task.done) continue;
    if (!/\bmedicals?\b|\brecords request\b/i.test(task.title)) continue;
    push({
      id: `medicals:${task.id}`,
      kind: "medicals",
      patientId: task.patientId ?? "",
      patientName: task.patientName || "Office",
      href: task.patientId ? `/patients/${task.patientId}` : "/patients?view=toDo",
      title: "Medicals request not sent",
      detail: task.title,
    });
  }
  return items;
}

function normalizeMarks(value: unknown): HandledMark[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is HandledMark => !!row && typeof row === "object" && typeof (row as HandledMark).id === "string")
    .map((row) => ({
      id: row.id,
      handled: row.handled !== false,
      by: typeof row.by === "string" ? row.by : "",
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
    }));
}

export function loadHandledMarks(): HandledMark[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeMarks(JSON.parse(window.localStorage.getItem(GOAT_UNTOUCHED_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function markHandled(records: HandledMark[], id: string, by: string, now: string): HandledMark[] {
  return [...records.filter((row) => row.id !== id), { id, handled: true, by, updatedAt: now }];
}

export function mergeHandledMarks(local: HandledMark[], cloud: unknown): HandledMark[] {
  return normalizeMarks(unionMerge(local, normalizeMarks(cloud)));
}

/** Save locally, then merge with the cloud row before writing it. */
export async function saveHandledMarks(records: HandledMark[]): Promise<void> {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GOAT_UNTOUCHED_KEY, JSON.stringify(records));
  try {
    const kv = await import("@/lib/kv-cloud");
    const remote = await kv.fetchKvValue<unknown>(GOAT_UNTOUCHED_KEY).catch(() => null);
    const merged = mergeHandledMarks(records, remote);
    window.localStorage.setItem(GOAT_UNTOUCHED_KEY, JSON.stringify(merged));
    await kv.dualWriteKv(GOAT_UNTOUCHED_KEY, "tasks", merged);
  } catch {
    // Local copy stands; the boot merge reconciles later.
  }
}
