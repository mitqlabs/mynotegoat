"use client";

/**
 * Text reminders for a day's visits.
 *
 * Today this is a worklist: it shows exactly who would be texted, the
 * message each one gets, and a Text button that hands off to the phone —
 * the same manual send the office already does, but as a list instead of
 * hunting through the schedule.
 *
 * The same queue drives automatic sending once a texting provider is
 * connected, so whatever the office sees here is what will go out. Holds
 * are listed rather than hidden: "why didn't she get a text?" has to be
 * answerable from this screen.
 */

import { useMemo, useState } from "react";
import { patients as patientDirectory } from "@/lib/mock-data";
import { expandTokens, buildSmsUrl } from "@/lib/sms-templates";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import {
  buildReminderQueue,
  defaultSmsReminderSettings,
  reminderHoldLabel,
  reminderSendDate,
  sendableReminders,
} from "@/lib/sms-reminders";
import { formatTimeLabel, type ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { formatUsDateFromIso } from "@/lib/key-dates";

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function SmsRemindersPanel({
  appointments,
  todayIso,
}: {
  appointments: ScheduleAppointmentRecord[];
  todayIso: string;
}) {
  const { smsTemplates } = useSmsTemplates();
  const { officeSettings } = useOfficeSettings();
  const settings = defaultSmsReminderSettings();
  // The visits being reminded about — tomorrow by default, which is what
  // the day-before reminder covers.
  const [visitDate, setVisitDate] = useState(() => addDaysIso(todayIso, settings.daysAhead));
  const [templateId, setTemplateId] = useState("");

  const template = useMemo(
    () => smsTemplates.find((entry) => entry.id === templateId) ?? smsTemplates[0],
    [smsTemplates, templateId],
  );

  const patientsById = useMemo(
    () => new Map(patientDirectory.map((patient) => [patient.id, patient])),
    [],
  );

  const queue = useMemo(
    () => buildReminderQueue(appointments, patientsById, settings, visitDate),
    // `settings` is rebuilt each render from constants, so it isn't a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointments, patientsById, visitDate],
  );
  const sendable = sendableReminders(queue);

  const messageFor = (entry: (typeof queue)[number]) => {
    if (!template) return "";
    const patient = patientsById.get(entry.patientId);
    return expandTokens(template.body, {
      patient: {
        firstName: patient?.fullName?.split(",")[1]?.trim() ?? "",
        lastName: patient?.fullName?.split(",")[0]?.trim() ?? "",
        fullName: patient?.fullName ?? entry.patientName,
      },
      appointment: {
        time: formatTimeLabel(entry.time),
        date: formatUsDateFromIso(entry.date),
        type: entry.appointmentType,
      },
      office: {
        officeName: officeSettings.officeName,
        doctorName: officeSettings.doctorName,
      },
    });
  };

  return (
    <section className="panel-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Text reminders</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Everyone due a reminder for one day&apos;s visits. Sending is still by hand — tap Text
            and it opens your phone with the message ready.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--text-muted)]">Visits on</span>
            <input
              className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
              onChange={(event) => setVisitDate(event.target.value)}
              type="date"
              value={visitDate}
            />
          </label>
          {smsTemplates.length > 1 && (
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-[var(--text-muted)]">Message</span>
              <select
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                onChange={(event) => setTemplateId(event.target.value)}
                value={template?.id ?? ""}
              >
                {smsTemplates.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-sm">
        <span className="font-semibold">
          {sendable.length} to text
        </span>{" "}
        for {formatUsDateFromIso(visitDate)}
        {queue.length - sendable.length > 0 && (
          <span className="text-[var(--text-muted)]">
            {" "}
            · {queue.length - sendable.length} held back
          </span>
        )}
        <span className="text-[var(--text-muted)]">
          {" "}
          · a day-before batch would go out {formatUsDateFromIso(reminderSendDate(visitDate, settings.daysAhead))}
        </span>
      </p>

      {!template && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No text templates yet. Add one in Settings → Templates → SMS Templates and it will be used
          here.
        </p>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line-soft)]">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-[var(--bg-soft)] text-left">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Patient</th>
              <th className="px-3 py-2">Message</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {queue.map((entry) => {
              const message = messageFor(entry);
              return (
                <tr
                  className="border-t border-[var(--line-soft)] align-top"
                  key={entry.appointmentId}
                  style={entry.hold ? { opacity: 0.6 } : undefined}
                >
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {formatTimeLabel(entry.time)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-semibold">{entry.patientName}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {entry.appointmentType}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">
                    {entry.hold ? reminderHoldLabel(entry.hold) : message}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {!entry.hold && template && (
                      <a
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-xs font-semibold text-[var(--brand-primary)]"
                        href={buildSmsUrl(entry.phone, message)}
                      >
                        Text
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
            {queue.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-[var(--text-muted)]" colSpan={4}>
                  No visits booked for {formatUsDateFromIso(visitDate)}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        Held back: patients who asked not to be texted, visits already canceled or seen, and a second
        visit the same day. A patient can be switched off on their own file.
      </p>
    </section>
  );
}
