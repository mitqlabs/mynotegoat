"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatCard } from "@/components/stat-card";
import { SetupChecklist } from "@/components/setup-checklist";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { useDashboardWorkspaceSettings } from "@/hooks/use-dashboard-workspace-settings";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { usePatientFollowUpOverrides } from "@/hooks/use-patient-follow-up-overrides";
import { usePriorityCaseRules } from "@/hooks/use-priority-case-rules";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import { withAlpha } from "@/lib/color-utils";
import { buildFollowUpItems, formatUsDateDisplay } from "@/lib/follow-up-queue";
import { appointments, patients } from "@/lib/mock-data";
import {
  buildSmsUrl,
  expandTokens,
  type SmsTemplate,
} from "@/lib/sms-templates";
import { loadTasks, type TaskPriority, type TaskRecord } from "@/lib/tasks";

function parseDateValue(dateValue: string) {
  const trimmed = dateValue.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const slashDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashDate) {
    const month = Number(slashDate[1]);
    const day = Number(slashDate[2]);
    const rawYear = slashDate[3];
    const year = rawYear.length === 2 ? Number(`20${rawYear}`) : Number(rawYear);
    const parsed = new Date(year, month - 1, day);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function daysSince(dateValue: string) {
  const now = new Date();
  const sinceDate = parseDateValue(dateValue);
  if (!sinceDate) {
    return null;
  }
  const diffMs = now.getTime() - sinceDate.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function extractLeadingDate(rawValue?: string) {
  if (!rawValue) {
    return null;
  }
  const match = rawValue.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/);
  return match?.[0] ?? null;
}

function getPriorityBadgeClass(reasons: string[]) {
  if (reasons.some((reason) => reason.toLowerCase().includes("no update") || reason.toLowerCase().includes("send report"))) {
    return "alert";
  }
  if (reasons.some((reason) => reason.toLowerCase().includes("mri"))) {
    return "warning";
  }
  if (reasons.some((reason) => reason.toLowerCase().includes("dropped"))) {
    return "alert";
  }
  if (reasons.some((reason) => reason.toLowerCase().includes("submitted"))) {
    return "warning";
  }
  if (reasons.some((reason) => reason.toLowerCase().includes("payment status") || reason.toLowerCase().includes("status check"))) {
    return "warning";
  }
  return "active";
}

function getTaskPriorityBadgeClass(priority: TaskPriority) {
  if (priority === "Urgent") {
    return "bg-[rgba(201,66,58,0.14)] text-[#b43b34]";
  }
  if (priority === "High") {
    return "bg-[rgba(238,139,42,0.18)] text-[#9a5a00]";
  }
  if (priority === "Medium") {
    return "bg-[rgba(21,123,191,0.14)] text-[#0b5c93]";
  }
  return "bg-[rgba(25,109,58,0.12)] text-[#196d3a]";
}

function compareTasksForDashboard(left: TaskRecord, right: TaskRecord) {
  if (left.done !== right.done) {
    return left.done ? 1 : -1;
  }
  if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
    return left.dueDate.localeCompare(right.dueDate);
  }
  if (left.dueDate && !right.dueDate) {
    return -1;
  }
  if (!left.dueDate && right.dueDate) {
    return 1;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function formatAppointmentTimeDisplay(startTime: string) {
  const match = startTime.match(/^(\d{2}):(\d{2})$/);
  if (!match) return startTime;
  const hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${meridiem}`;
}

function getTomorrowIsoDate() {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pickReminderTemplate(templates: SmsTemplate[]): SmsTemplate | null {
  const byReminder = templates.find((t) =>
    t.name.toLowerCase().includes("reminder"),
  );
  return byReminder ?? templates[0] ?? null;
}

export default function DashboardPage() {
  const { caseStatuses, lienLabel } = useCaseStatuses();
  const { priorityRules } = usePriorityCaseRules();
  const { dashboardWorkspaceSettings } = useDashboardWorkspaceSettings();
  const { recordsByPatientId: followUpOverridesByPatientId } = usePatientFollowUpOverrides();
  const { scheduleAppointments } = useScheduleAppointments();
  const { smsTemplates } = useSmsTemplates();
  const { officeSettings } = useOfficeSettings();
  const [tasksSnapshot, setTasksSnapshot] = useState<TaskRecord[]>(() => loadTasks());

  useEffect(() => {
    const refresh = () => setTasksSnapshot(loadTasks());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "casemate.tasks.v1") {
        refresh();
      }
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    patients.forEach((patient) => {
      counts[patient.caseStatus] = (counts[patient.caseStatus] ?? 0) + 1;
    });
    return counts;
  }, []);

  const computedStats = useMemo(() => {
    const activeStatuses = new Set(
      caseStatuses
        .filter((status) => !status.isCaseClosed)
        .map((status) => status.name.toLowerCase()),
    );
    const totalActive = patients.filter((p) =>
      activeStatuses.has(p.caseStatus.toLowerCase()),
    ).length;

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayAppointments = appointments.filter((a) =>
      a.start.startsWith(todayStr),
    ).length;

    const dischargedPatients = patients.filter((p) => {
      const status = p.caseStatus.toLowerCase();
      return status.includes("discharg") || status.includes("paid") || status.includes("dropped");
    });
    let avgDays = 0;
    if (dischargedPatients.length > 0) {
      const totalDays = dischargedPatients.reduce((sum, p) => {
        const initial = parseDateValue(p.matrix?.initialExam ?? "");
        const discharge = parseDateValue(p.matrix?.discharge ?? "");
        if (initial && discharge) {
          return sum + Math.max(0, Math.floor((discharge.getTime() - initial.getTime()) / (1000 * 60 * 60 * 24)));
        }
        return sum;
      }, 0);
      const countWithDates = dischargedPatients.filter((p) => {
        const initial = parseDateValue(p.matrix?.initialExam ?? "");
        const discharge = parseDateValue(p.matrix?.discharge ?? "");
        return initial && discharge;
      }).length;
      avgDays = countWithDates > 0 ? totalDays / countWithDates : 0;
    }

    return [
      { label: "Total Active Cases", value: String(totalActive) },
      { label: "Total Patients", value: String(patients.length) },
      { label: "Today Appointments", value: String(todayAppointments) },
      { label: "Avg Days Initial To Discharge", value: avgDays > 0 ? avgDays.toFixed(1) : "-" },
    ];
  }, [caseStatuses]);

  const dashboardStatuses = useMemo(
    () => caseStatuses.filter((status) => status.showOnDashboard),
    [caseStatuses],
  );
  const closedCaseStatuses = useMemo(
    () => caseStatuses.filter((status) => status.isCaseClosed).map((status) => status.name),
    [caseStatuses],
  );

  const priorityCases = useMemo(() => {
    const closedStatuses = new Set(closedCaseStatuses.map((status) => status.toLowerCase()));

    return patients
      .map((patient) => {
        if (closedStatuses.has(patient.caseStatus.toLowerCase())) {
          return null;
        }

        const reasons: string[] = [];

        const statusLower = patient.caseStatus.toLowerCase();
        const rbSentDate = extractLeadingDate(patient.matrix?.rbSent);
        const rbSentDays = rbSentDate ? daysSince(rbSentDate) : null;
        const initialExamDate = extractLeadingDate(patient.matrix?.initialExam);
        const initialExamDays = initialExamDate ? daysSince(initialExamDate) : null;
        const staleDays = daysSince(patient.lastUpdate) ?? 0;
        const hasMriLogged = Boolean(
          patient.matrix?.mriSent ||
            patient.matrix?.mriScheduled ||
            patient.matrix?.mriDone ||
            patient.matrix?.mriReceived ||
            patient.matrix?.mriReviewed,
        );

        const isDischarged = statusLower.includes("discharg");
        const isSubmitted = statusLower.includes("submit");
        const isPaid = statusLower.includes("paid");
        const pauseRules = isDischarged || Boolean(rbSentDate);

        // Discharged but report not yet sent → "Send Report" alert
        if (isDischarged && !rbSentDate) {
          const dischargeDate = extractLeadingDate(patient.matrix?.discharge);
          const dischargeDays = dischargeDate ? (daysSince(dischargeDate) ?? 0) : 0;
          reasons.push(`Send Report${dischargeDays > 0 ? ` ${dischargeDays}d` : ""}`);
        }

        if (
          priorityRules.includeMriDue &&
          !pauseRules &&
          !hasMriLogged &&
          initialExamDays !== null &&
          initialExamDays >= priorityRules.mriDueDaysFromInitial
        ) {
          reasons.push("MRI Due");
        }

        if (
          priorityRules.includeNoUpdate &&
          !pauseRules &&
          staleDays >= priorityRules.noUpdateDaysThreshold
        ) {
          reasons.push(`No update ${staleDays}d`);
        }

        // Submitted cases: only Payment Status matters
        if (
          priorityRules.includeRbStatusCheck &&
          rbSentDays !== null &&
          !isPaid &&
          rbSentDays >= priorityRules.rbStatusCheckDaysThreshold
        ) {
          reasons.push(`Payment status ${rbSentDays}d`);
        }

        // For submitted cases, only keep Payment Status alerts (drop MRI Due, No Update, etc.)
        if (isSubmitted && reasons.some((r) => r.startsWith("Payment"))) {
          const paymentOnly = reasons.filter((r) => r.startsWith("Payment"));
          reasons.length = 0;
          reasons.push(...paymentOnly);
        }

        if (!reasons.length) {
          return null;
        }

        return {
          patient,
          reasons,
          staleDays,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => {
        if (b.reasons.length !== a.reasons.length) {
          return b.reasons.length - a.reasons.length;
        }
        return b.staleDays - a.staleDays;
      })
      .slice(0, priorityRules.maxItems);
  }, [closedCaseStatuses, priorityRules]);

  const dashboardTasks = useMemo(() => {
    const openOnly = dashboardWorkspaceSettings.myTasks.openOnly;
    const maxItems = dashboardWorkspaceSettings.myTasks.maxItems;
    const rows = openOnly ? tasksSnapshot.filter((task) => !task.done) : tasksSnapshot;
    return [...rows].sort(compareTasksForDashboard).slice(0, maxItems);
  }, [
    dashboardWorkspaceSettings.myTasks.maxItems,
    dashboardWorkspaceSettings.myTasks.openOnly,
    tasksSnapshot,
  ]);

  const taskCounts = useMemo(() => {
    const open = tasksSnapshot.filter((task) => !task.done).length;
    return {
      total: tasksSnapshot.length,
      open,
      done: tasksSnapshot.length - open,
    };
  }, [tasksSnapshot]);

  const dashboardFollowUpItems = useMemo(
    () =>
      buildFollowUpItems(patients, {
        includeXray: dashboardWorkspaceSettings.patientFollowUp.includeXray,
        includeMriCt: dashboardWorkspaceSettings.patientFollowUp.includeMriCt,
        includeSpecialist: dashboardWorkspaceSettings.patientFollowUp.includeSpecialist,
        includeLienLop: dashboardWorkspaceSettings.patientFollowUp.includeLienLop,
        xrayAppearAuto: dashboardWorkspaceSettings.patientFollowUp.xrayAppearAuto,
        mriAppearMode: dashboardWorkspaceSettings.patientFollowUp.mriAppearMode,
        mriAppearDays: dashboardWorkspaceSettings.patientFollowUp.mriAppearDays,
        specialistAppearWhen: dashboardWorkspaceSettings.patientFollowUp.specialistAppearWhen,
        xrayClearedBy: dashboardWorkspaceSettings.patientFollowUp.xrayClearedBy,
        mriCtClearedBy: dashboardWorkspaceSettings.patientFollowUp.mriCtClearedBy,
        specialistClearedBy: dashboardWorkspaceSettings.patientFollowUp.specialistClearedBy,
        lienLopClearStatuses: dashboardWorkspaceSettings.patientFollowUp.lienLopClearStatuses,
        xrayClearStatuses: dashboardWorkspaceSettings.patientFollowUp.xrayClearStatuses,
        mriCtClearStatuses: dashboardWorkspaceSettings.patientFollowUp.mriCtClearStatuses,
        specialistClearStatuses: dashboardWorkspaceSettings.patientFollowUp.specialistClearStatuses,
        xrayNoReportWarningDays: dashboardWorkspaceSettings.patientFollowUp.xrayNoReportWarningDays,
        mriNoReportWarningDays: dashboardWorkspaceSettings.patientFollowUp.mriNoReportWarningDays,
        mriNoScheduleWarningDays: dashboardWorkspaceSettings.patientFollowUp.mriNoScheduleWarningDays,
        specialistNoReportWarningDays: dashboardWorkspaceSettings.patientFollowUp.specialistNoReportWarningDays,
        specialistNoScheduleWarningDays: dashboardWorkspaceSettings.patientFollowUp.specialistNoScheduleWarningDays,
        followUpOverrides: followUpOverridesByPatientId,
        closedCaseStatuses,
        maxItems: dashboardWorkspaceSettings.patientFollowUp.maxItems,
      }),
    [
      closedCaseStatuses,
      dashboardWorkspaceSettings.patientFollowUp.includeLienLop,
      dashboardWorkspaceSettings.patientFollowUp.includeMriCt,
      dashboardWorkspaceSettings.patientFollowUp.includeSpecialist,
      dashboardWorkspaceSettings.patientFollowUp.includeXray,
      dashboardWorkspaceSettings.patientFollowUp.lienLopClearStatuses,
      dashboardWorkspaceSettings.patientFollowUp.xrayClearStatuses,
      dashboardWorkspaceSettings.patientFollowUp.mriCtClearStatuses,
      dashboardWorkspaceSettings.patientFollowUp.specialistClearStatuses,
      dashboardWorkspaceSettings.patientFollowUp.maxItems,
      dashboardWorkspaceSettings.patientFollowUp.mriAppearMode,
      dashboardWorkspaceSettings.patientFollowUp.mriAppearDays,
      dashboardWorkspaceSettings.patientFollowUp.mriCtClearedBy,
      dashboardWorkspaceSettings.patientFollowUp.specialistAppearWhen,
      dashboardWorkspaceSettings.patientFollowUp.specialistClearedBy,
      dashboardWorkspaceSettings.patientFollowUp.xrayAppearAuto,
      dashboardWorkspaceSettings.patientFollowUp.xrayClearedBy,
      followUpOverridesByPatientId,
    ],
  );

  const caseFlowItems = useMemo(() => {
    type CaseFlowItem = {
      id: string;
      patientId: string;
      patientName: string;
      detail: string;
      subDetail: string;
      tag: string;
      tagClass: string;
      staleDays: number;
    };

    const items: CaseFlowItem[] = [];

    // Add priority alerts
    for (const entry of priorityCases) {
      for (const reason of entry.reasons) {
        items.push({
          id: `priority-${entry.patient.id}-${reason}`,
          patientId: entry.patient.id,
          patientName: entry.patient.fullName,
          detail: reason,
          subDetail: `${entry.patient.attorney} • Last update ${entry.patient.lastUpdate}`,
          tag: reason.split(" ")[0] === "No" ? "No Update" : reason.startsWith("Payment") ? "Payment Status" : reason.startsWith("Send Report") ? "Send Report" : reason,
          tagClass: getPriorityBadgeClass([reason]),
          staleDays: entry.staleDays,
        });
      }
    }

    // Add follow-up items
    for (const item of dashboardFollowUpItems) {
      const isStale =
        item.daysFromAnchor !== null &&
        item.daysFromAnchor >= dashboardWorkspaceSettings.patientFollowUp.staleDaysThreshold;
      items.push({
        id: `followup-${item.id}`,
        patientId: item.patientId,
        patientName: item.patientName,
        detail: item.stage,
        subDetail: `Case ${item.caseNumber || "-"} • ${item.anchorDate ? formatUsDateDisplay(item.anchorDate) : "No date"}${isStale ? ` • Stale ${item.daysFromAnchor}d` : ""}`,
        tag: item.category === "Lien / LOP" ? lienLabel : item.category,
        tagClass: "",
        staleDays: item.daysFromAnchor ?? 0,
      });
    }

    // Sort: highest stale days first
    items.sort((a, b) => b.staleDays - a.staleDays);

    return items;
  }, [priorityCases, dashboardFollowUpItems, dashboardWorkspaceSettings.patientFollowUp.staleDaysThreshold, lienLabel]);

  const tomorrowAppointments = useMemo(() => {
    const tomorrow = getTomorrowIsoDate();
    return scheduleAppointments
      .filter((appt) => appt.date === tomorrow && appt.status === "Scheduled")
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [scheduleAppointments]);

  const reminderTemplate = useMemo(
    () => pickReminderTemplate(smsTemplates),
    [smsTemplates],
  );

  const reminderEligible = useMemo(() => {
    if (!reminderTemplate) return [];
    return tomorrowAppointments
      .map((appt) => {
        const patient = patients.find((p) => p.id === appt.patientId);
        const phone = patient?.phone ?? "";
        if (!phone) return null;
        const [lastName, firstNameRaw] = appt.patientName.includes(",")
          ? appt.patientName.split(",", 2).map((s) => s.trim())
          : ["", appt.patientName];
        const firstName = firstNameRaw || appt.patientName.split(/\s+/)[0] || "";
        const body = expandTokens(reminderTemplate.body, {
          patient: {
            firstName,
            lastName,
            fullName: appt.patientName,
          },
          appointment: {
            time: formatAppointmentTimeDisplay(appt.startTime),
            date: formatUsDateDisplay(appt.date),
            type: appt.appointmentType,
          },
          office: {
            officeName: officeSettings.officeName,
            doctorName: officeSettings.doctorName,
          },
        });
        return { appt, phone, url: buildSmsUrl(phone, body) };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [tomorrowAppointments, reminderTemplate, officeSettings.officeName, officeSettings.doctorName]);

  const sendAllReminders = () => {
    if (typeof window === "undefined") return;
    // Opening multiple sms: URLs in one click can be popup-blocked. Open the
    // first synchronously and schedule the rest — most browsers allow this
    // pattern when triggered from a direct user click.
    for (let i = 0; i < reminderEligible.length; i++) {
      const entry = reminderEligible[i];
      if (i === 0) {
        window.location.href = entry.url;
      } else {
        window.open(entry.url, "_blank");
      }
    }
  };

  return (
    <div className="space-y-5">
      <SetupChecklist />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {computedStats.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} />
        ))}
      </section>

      {tomorrowAppointments.length > 0 && (
        <section className="panel-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Tomorrow&apos;s Appointments</h3>
              <p className="text-xs text-[var(--text-muted)]">
                {tomorrowAppointments.length} scheduled · {reminderEligible.length} with phone on file
              </p>
            </div>
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-semibold transition-all active:scale-[0.97] active:shadow-inner disabled:opacity-50"
              disabled={!reminderTemplate || reminderEligible.length === 0}
              onClick={sendAllReminders}
              title={
                !reminderTemplate
                  ? "Add a reminder template in Settings → SMS / Text Templates first"
                  : undefined
              }
              type="button"
            >
              Send reminders ({reminderEligible.length})
            </button>
          </div>
          <ul className="space-y-1.5">
            {tomorrowAppointments.map((appt) => {
              const entry = reminderEligible.find((e) => e.appt.id === appt.id);
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  key={appt.id}
                >
                  <div className="min-w-0">
                    <span className="font-semibold">
                      {formatAppointmentTimeDisplay(appt.startTime)}
                    </span>
                    <span className="mx-2 text-[var(--text-muted)]">·</span>
                    <Link
                      className="text-[var(--brand-primary)] hover:underline"
                      href={appt.patientId ? `/patients/${appt.patientId}` : "/patients"}
                    >
                      {appt.patientName}
                    </Link>
                    <span className="ml-2 text-xs text-[var(--text-muted)]">
                      {appt.appointmentType}
                    </span>
                  </div>
                  {entry ? (
                    <a
                      className="rounded-lg border border-[var(--line-soft)] px-2 py-1 text-xs font-semibold text-[var(--brand-primary)] hover:bg-[var(--bg-soft)]"
                      href={entry.url}
                    >
                      Send reminder
                    </a>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">No phone</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="panel-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-xl font-semibold">Case Status</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Configured in Settings
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {dashboardStatuses.map((status) => (
            <div
              key={status.name}
              className="flex items-center gap-3 rounded-xl border border-[var(--line-soft)] bg-white px-4 py-3"
            >
              <span
                aria-hidden
                className="inline-block h-3 w-3 shrink-0 rounded"
                style={{ backgroundColor: withAlpha(status.color, 0.7) }}
              />
              <div>
                <p className="text-xs text-[var(--text-muted)]">{status.name}</p>
                <p className="text-2xl font-semibold leading-tight">{statusCounts[status.name] ?? 0}</p>
              </div>
            </div>
          ))}
          {dashboardStatuses.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">
              No statuses selected. Go to Settings and enable &quot;Show on Dashboard&quot;.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="panel-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xl font-semibold">Case Flow</h3>
            <p className="text-sm text-[var(--text-muted)]">
              {caseFlowItems.length} item{caseFlowItems.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="space-y-2">
            {caseFlowItems.map((item) => (
              <Link
                key={item.id}
                href={`/patients/${item.patientId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2.5 transition hover:border-[var(--brand-primary)] hover:shadow-sm"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--brand-primary)]">{item.patientName}</p>
                  <p className="text-sm text-[var(--text-muted)]">{item.detail}</p>
                  <p className="text-xs text-[var(--text-muted)]">{item.subDetail}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    item.tagClass
                      ? `status-pill ${item.tagClass}`
                      : "bg-[var(--bg-soft)] text-[var(--text-muted)]"
                  }`}
                >
                  {item.tag}
                </span>
              </Link>
            ))}
            {caseFlowItems.length === 0 && (
              <p className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-3 text-sm text-[var(--text-muted)]">
                No case flow items. All patients are up to date.
              </p>
            )}
          </div>
        </article>

        {dashboardWorkspaceSettings.myTasks.showOnDashboard && (
          <article className="panel-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xl font-semibold">To Do</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Open {taskCounts.open} • Done {taskCounts.done}
              </p>
            </div>
            <div className="space-y-2">
              {dashboardTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className={`font-semibold ${task.done ? "text-[var(--text-muted)] line-through" : ""}`}>
                      {task.title}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {task.dueDate ? `Due ${formatUsDateDisplay(task.dueDate)}` : "No due date"}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getTaskPriorityBadgeClass(task.priority)}`}>
                    {task.priority}
                  </span>
                </div>
              ))}
              {dashboardTasks.length === 0 && (
                <p className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-3 text-sm text-[var(--text-muted)]">
                  No tasks to show.
                </p>
              )}
            </div>
          </article>
        )}
      </section>
    </div>
  );
}
