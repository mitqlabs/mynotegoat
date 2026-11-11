"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { ADMIN_ONLY_REPLY, appointmentCheck, quickBiz, type BriefData } from "@/lib/goat-briefs";
import { appConfirm } from "@/components/app-dialog";
import { GoatPageSettings } from "@/components/goat-page-settings";
import {
  HANDOFF_TODAY_ITEMS,
  SCHEDULE_ITEMS,
  appointmentVisible,
  boardSnapshot,
  boxTitle,
  boxesFromSnapshot,
  casesByMonth,
  clampMaxH,
  defaultTypePriority,
  imagingReferralRows,
  itemShown,
  matchesPeriod,
  nextOpenDayLabel,
  nextOpenOfficeDay,
  orderedIds,
  patientsInStatus,
  rowFields,
  saveBoard,
  sortAppointments,
  specialistReferralRows,
  subscribeBoard,
  todayVisitGroups,
  type BoardBox,
  type RowField,
  type SnapshotPeriod,
} from "@/lib/goat-board";
import { printGoatHandoff } from "@/lib/print-goat-handoff";
import { isNewPatientAppointmentType } from "@/lib/initial-exam-date";
import type { KeyDateRecord } from "@/lib/key-dates";
import { buildFollowUpItems } from "@/lib/follow-up-queue";
import { caseReviewAnswer } from "@/lib/goat-pipeline";
import type { CloseoutModel } from "@/lib/goat-closeout";
import type { ScheduleSettingsConfig } from "@/lib/schedule-settings";
import { to12hLabel } from "@/lib/time-12h";
import type { GoatPageModel } from "@/lib/goat-page-model";
import type { PatientRecord } from "@/lib/mock-data";

const Grid = WidthProvider(Responsive);

type StatusConfig = { name: string; color?: string };

type PatientLike = PatientRecord;

function layoutOf(boxes: BoardBox[]): Layout[] {
  return boxes.map((box) => {
    const maxH = clampMaxH(box.maxH);
    return { i: box.i, x: box.x, y: box.y, w: box.w, h: Math.min(box.h, maxH), minW: 2, minH: 4, maxH };
  });
}

function stack(boxes: BoardBox[]): Layout[] {
  let y = 0;
  return boxes.map((box) => {
    const maxH = clampMaxH(box.maxH);
    const item = { i: box.i, x: 0, y, w: 1, h: Math.min(box.h, maxH), minH: 4, maxH };
    y += box.h;
    return item;
  });
}

function Group({ label, rows, empty }: { label: string; rows: Array<{ id: string; name: string; href: string; detail?: string }>; empty: string }) {
  return (
    <div className="mt-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{empty}</p>
      ) : (
        <ul className="mt-0.5 space-y-0.5 text-sm">
          {rows.map((row) => (
            <li key={row.id}>
              <Link className="font-medium hover:underline" href={row.href}>{row.name}</Link>
              {row.detail ? <span className="text-[var(--text-muted)]"> · {row.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VisitLines({
  rows,
  fields,
}: {
  rows: Array<{ id: string; patientId: string; patientName: string; startTime: string; status: string; appointmentType?: string }>;
  fields: RowField[];
}) {
  if (!rows.length) return <p className="py-1 text-sm text-[var(--text-muted)]">Nothing booked.</p>;
  return (
    <ul className="divide-y divide-[var(--line-soft)] text-sm">
      {rows.map((row) => (
        <li className="flex items-center gap-2 py-1" key={row.id}>
          {fields.includes("time") && <span className="w-16 shrink-0 tabular-nums text-[var(--text-muted)]">{to12hLabel(row.startTime)}</span>}
          {fields.includes("name") && (
            <Link className="min-w-0 flex-1 truncate font-medium hover:underline" href={`/patients/${row.patientId}`}>{row.patientName}</Link>
          )}
          {fields.includes("type") && <span className="max-w-[9rem] truncate text-[11px] text-[var(--text-muted)]">{row.appointmentType || "Visit"}</span>}
          {fields.includes("status") && <span className="text-[10px] text-[var(--text-muted)]">{row.status}</span>}
          {isNewPatientAppointmentType(row.appointmentType ?? "") && (
            <span className="rounded-full bg-[#e7f8ee] px-1.5 py-0.5 text-[10px] font-semibold text-[#1f7a45]">New</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function CaseLinks({ patients, empty }: { patients: Array<{ id: string; fullName: string }>; empty?: string }) {
  if (!patients.length) return empty ? <p className="text-xs text-[var(--text-muted)]">{empty}</p> : null;
  return (
    <ul className="space-y-0.5 text-sm">
      {patients.map((patient) => (
        <li key={patient.id}>
          <Link className="font-medium hover:underline" href={`/patients/${patient.id}`}>{patient.fullName}</Link>
        </li>
      ))}
    </ul>
  );
}

export function GoatBriefingBoard({
  model,
  isAdmin,
  patients,
  appointments,
  caseStatuses,
  todayIso,
  scheduleSettings,
  keyDates = [],
  appointmentTypes = [],
  closeout,
  mail,
  answers,
  todos,
  onRemoveIntake,
}: {
  model: GoatPageModel;
  isAdmin: boolean;
  patients: PatientLike[];
  appointments: Array<{ id: string; patientId: string; patientName: string; date: string; startTime: string; status: string; appointmentType?: string; location?: string }>;
  caseStatuses: StatusConfig[];
  todayIso: string;
  scheduleSettings: Pick<ScheduleSettingsConfig, "officeHours" | "appointmentIntervalMin" | "maxAppointmentsPerSlot">;
  keyDates?: KeyDateRecord[];
  appointmentTypes?: string[];
  closeout: CloseoutModel;
  mail: ReactNode;
  answers: ReactNode;
  todos: ReactNode;
  onRemoveIntake?: (id: string) => void;
}) {
  const snapshot = useSyncExternalStore(subscribeBoard, boardSnapshot, () => "");
  const boxes = useMemo(() => boxesFromSnapshot(snapshot), [snapshot]);
  const [pageSettings, setPageSettings] = useState(false);
  const [arrange, setArrange] = useState(false);

  const commit = (next: BoardBox[]) => {
    saveBoard(next);
  };

  const applyLayout = (current: Layout[]) => {
    const prev = boxesFromSnapshot(boardSnapshot());
    let changed = false;
    const next = prev.map((box) => {
      const item = current.find((row) => row.i === box.i);
      if (!item || (item.x === box.x && item.y === box.y && item.w === box.w && item.h === box.h)) return box;
      changed = true;
      return { ...box, x: item.x, y: item.y, w: item.w, h: item.h };
    });
    if (changed) saveBoard(next);
  };

  const briefs = useMemo(() => {
    const data: BriefData = {
      today: todayIso,
      patients: patients.filter((patient) => !patient.deleted).map((patient) => ({
        id: patient.id,
        fullName: patient.fullName,
        caseStatus: patient.caseStatus,
        cash: patient.isCashPatient,
        firstVisit: patient.matrix?.initialExam,
        paidDate: patient.matrix?.paidDate,
      })),
      appointments: appointments.map((row) => ({
        id: row.id,
        patientId: row.patientId,
        patientName: row.patientName,
        date: row.date,
        startTime: row.startTime,
        status: row.status,
        appointmentType: row.appointmentType,
        location: row.location,
      })),
      tasks: [],
      locations: [],
    };
    let review = "Case review is unavailable right now.";
    try {
      const items = buildFollowUpItems(patients);
      review = caseReviewAnswer(
        { mode: "summary" },
        {
          today: todayIso,
          items,
          closedStatuses: [],
          patients: patients.map((patient) => ({ id: patient.id, fullName: patient.fullName, caseStatus: patient.caseStatus, cash: patient.isCashPatient })),
        },
      ).text;
    } catch {
      review = "Case review is unavailable right now.";
    }
    return {
      check: isAdmin ? appointmentCheck(data).text : ADMIN_ONLY_REPLY,
      biz: isAdmin ? quickBiz(data).text : ADMIN_ONLY_REPLY,
      review: isAdmin ? review : ADMIN_ONLY_REPLY,
    };
  }, [appointments, isAdmin, patients, todayIso]);

  const officeDay = useMemo(() => nextOpenOfficeDay(todayIso, scheduleSettings, keyDates), [keyDates, scheduleSettings, todayIso]);
  const months = useMemo(() => casesByMonth(patients), [patients]);
  const imaging = useMemo(() => imagingReferralRows(patients), [patients]);
  const specialists = useMemo(() => specialistReferralRows(patients), [patients]);

  const body = (box: BoardBox): ReactNode => {
    if (box.kind === "goat-mail") return mail;
    if (box.kind === "goat-answers") return answers;
    if (box.kind === "todos") return todos;
    if (box.kind === "appointment-check") return <p className="whitespace-pre-wrap text-sm">{briefs.check}</p>;
    if (box.kind === "quick-biz") return <p className="whitespace-pre-wrap text-sm">{briefs.biz}</p>;
    if (box.kind === "case-review") return <p className="whitespace-pre-wrap text-sm">{briefs.review}</p>;
    if (box.kind === "schedule" || box.kind === "tomorrow-schedule") {
      const day = box.kind === "schedule" ? todayIso : officeDay.date;
      const rows = sortAppointments(
        appointments.filter((row) => row.date === day && appointmentVisible(row.appointmentType, box.hiddenTypes)),
        box.typePriority?.length ? box.typePriority : defaultTypePriority(appointmentTypes),
      );
      const visibleRows = officeDay.closed && box.kind === "tomorrow-schedule" ? [] : rows;
      const groups = todayVisitGroups(visibleRows, day);
      const order = orderedIds(SCHEDULE_ITEMS.map((item) => item.id), box.itemOrder);
      return (
        <div>
          {box.kind === "tomorrow-schedule" && (
            <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">
              {officeDay.closed ? "No open office day in the next two months." : nextOpenDayLabel(officeDay.date)}
            </p>
          )}
          {order.map((id) => {
            if (!itemShown(box.hiddenItems, id)) return null;
            if (id === "list") return <VisitLines fields={rowFields(box)} key={id} rows={visibleRows} />;
            const group = groups.find((row) => row.label === id);
            if (!group) return null;
            return <Group empty="None" key={id} label={group.label} rows={group.rows} />;
          })}
        </div>
      );
    }
    if (box.kind === "intake") {
      return (
        <ul className="space-y-1 text-sm">
          {model.intake.map((row) => (
            <li className="flex flex-wrap items-center justify-between gap-2" key={row.id}>
              <Link className="font-medium hover:underline" href={row.href}>{row.name}</Link>
              {onRemoveIntake && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    void (async () => {
                      const ok = await appConfirm(`Remove ${row.name} from New Patient Intake? They'll be hidden from the lists. Restore them from Deleted Patients.`);
                      if (ok) onRemoveIntake(row.id);
                    })();
                  }}
                  type="button"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          {model.intake.length === 0 && <li className="text-sm text-[var(--text-muted)]">No one waiting on intake.</li>}
        </ul>
      );
    }
    if (box.kind === "case-snapshot") {
      const period = box.period ?? "this-year";
      const inPeriod = patients.filter((patient) => matchesPeriod(patient, period, todayIso));
      const order = orderedIds(caseStatuses.map((status) => `status:${status.name}`), box.itemOrder);
      return (
        <div className="space-y-3">
          <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
            Period
            <select
              className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-normal"
              onChange={(event) => commit(boxes.map((row) => (row.i === box.i ? { ...row, period: event.target.value as SnapshotPeriod } : row)))}
              value={period}
            >
              <option value="this-year">This Year</option>
              <option value="last-year">Last Year</option>
              {Array.from({ length: 8 }, (_, index) => Number(todayIso.slice(0, 4)) - index)
                .filter((year) => year !== Number(todayIso.slice(0, 4)) && year !== Number(todayIso.slice(0, 4)) - 1)
                .map((year) => (
                  <option key={year} value={`year:${year}`}>{year}</option>
                ))}
              <option value="all">All Time</option>
            </select>
          </label>
          {order.map((id) => {
            if (!itemShown(box.hiddenItems, id)) return null;
            const status = caseStatuses.find((row) => `status:${row.name}` === id);
            if (!status) return null;
            const list = patientsInStatus(inPeriod, status.name);
            return (
              <section key={status.name}>
                <h3 className="text-xs font-semibold">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: status.color ?? "#94a3b8" }} />
                  {status.name} <span className="tabular-nums text-[var(--text-muted)]">{list.length}</span>
                </h3>
                <CaseLinks empty={`No ${status.name} cases.`} patients={list} />
              </section>
            );
          })}
        </div>
      );
    }
    if (box.kind === "status-cases") {
      const list = patientsInStatus(patients, box.statusName ?? "");
      return <CaseLinks empty={`No ${box.statusName ?? "matching"} cases.`} patients={list} />;
    }
    if (box.kind === "end-of-day") {
      const priority = box.typePriority?.length ? box.typePriority : defaultTypePriority(appointmentTypes);
      const today = appointments.filter((row) => row.date === todayIso && appointmentVisible(row.appointmentType, box.hiddenTypes));
      const named = (rows: typeof today) =>
        sortAppointments(rows, priority).map((row) => ({
          id: row.id,
          name: row.patientName,
          href: `/patients/${row.patientId}`,
          detail: row.appointmentType || undefined,
        }));
      const todayBlocks: Record<string, { label: string; empty: string; rows: Array<{ id: string; name: string; href: string; detail?: string }> }> = {
        seen: { label: "Seen", empty: "No one checked out yet.", rows: named(today.filter((row) => row.status === "Check Out")) },
        "new-seen": {
          label: "New patients seen",
          empty: "No new patients checked out.",
          rows: named(today.filter((row) => row.status === "Check Out" && isNewPatientAppointmentType(row.appointmentType ?? ""))),
        },
        "no-show": { label: "No-shows", empty: "No no-shows.", rows: named(today.filter((row) => row.status === "No Show")) },
        canceled: { label: "Canceled", empty: "No cancellations.", rows: named(today.filter((row) => row.status === "Canceled")) },
        rebook: { label: "Rebooks needed", empty: "No rebooks.", rows: named(today.filter((row) => row.status === "Reschedule")) },
        unsigned: {
          label: "Unsigned notes",
          empty: "All of today's notes are signed.",
          rows: closeout.unsigned.map((row) => ({ id: row.id, name: row.name, href: row.href })),
        },
        "no-note": {
          label: "Checked in, no note",
          empty: "Every checked-in visit has a note.",
          rows: closeout.checkedInWithoutNote.map((row) => ({ id: row.id, name: row.name, href: row.href, detail: row.time })),
        },
      };
      const order = orderedIds(
        [...HANDOFF_TODAY_ITEMS.map((item) => item.id), "tomorrow-list"],
        box.itemOrder,
      );
      const tomorrow = sortAppointments(
        appointments.filter((row) => row.date === officeDay.date && appointmentVisible(row.appointmentType, box.hiddenTypes)),
        priority,
      );
      return (
        <div className="goat-handoff">
          <div className="goat-handoff-actions mb-2 flex justify-end">
            <button className="btn btn-secondary btn-sm" onClick={(event) => printGoatHandoff(event.currentTarget.closest(".goat-handoff"))} type="button">Print</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide">Today</h3>
              {order.map((id) => {
                const block = todayBlocks[id];
                if (!block || !itemShown(box.hiddenItems, id)) return null;
                return <Group empty={block.empty} key={id} label={block.label} rows={block.rows} />;
              })}
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide">Tomorrow</h3>
              <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">
                {officeDay.closed ? "No open office day in the next two months." : nextOpenDayLabel(officeDay.date)}
              </p>
              {itemShown(box.hiddenItems, "tomorrow-list") && (
                <div className="mt-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{"Tomorrow's Appointments"}</h3>
                  <VisitLines fields={rowFields(box)} rows={officeDay.closed ? [] : tomorrow} />
                </div>
              )}
            </section>
          </div>
        </div>
      );
    }
    if (box.kind === "cases-by-month") {
      return (
        <ul className="space-y-2 text-sm">
          {months.filter((row) => row.count > 0).map((row) => (
            <li key={row.month}>
              <p className="flex justify-between"><span>{row.month}</span><span className="font-semibold tabular-nums">{row.count}</span></p>
              <CaseLinks empty="" patients={row.people.map((person) => ({ id: person.id, fullName: person.name }))} />
            </li>
          ))}
          {months.every((row) => row.count === 0) && <li className="text-xs text-[var(--text-muted)]">No initial exams dated yet.</li>}
        </ul>
      );
    }
    if (box.kind === "imaging-referrals") {
      return (
        <div className="text-xs">
          <p className="mb-1 text-[11px] text-[var(--text-muted)]">Cases = distinct patients. Xrays / MRIs = one per region (a bilateral BL extremity counts as two).</p>
          {imaging.map((row) => (
            <section className="border-t border-[var(--line-soft)] py-1" key={row.facility}>
              <p className="flex justify-between gap-2">
                <span className="truncate font-medium">{row.facility}</span>
                <span className="shrink-0 tabular-nums">{row.cases} · {row.xray} xr · {row.mri} mri</span>
              </p>
              <CaseLinks empty="" patients={row.people.map((person) => ({ id: person.id, fullName: person.name }))} />
            </section>
          ))}
          {imaging.length === 0 && <p className="text-[var(--text-muted)]">No imaging referrals.</p>}
        </div>
      );
    }
    return (
      <ul className="space-y-2 text-sm">
        {specialists.map((row) => (
          <li key={row.specialist}>
            <p className="flex justify-between gap-2"><span className="truncate">{row.specialist}</span><span className="font-semibold tabular-nums">{row.cases}</span></p>
            <CaseLinks empty="" patients={row.people.map((person) => ({ id: person.id, fullName: person.name }))} />
          </li>
        ))}
        {specialists.length === 0 && <li className="text-xs text-[var(--text-muted)]">No specialist referrals.</li>}
      </ul>
    );
  };

  return (
    <div data-goat-board>
      <div className="mb-3 flex justify-end">
        <button aria-label="G.O.A.T. Page settings" className="btn btn-secondary btn-sm" onClick={() => setPageSettings((open) => !open)} title="G.O.A.T. Page settings" type="button">
          ⚙
        </button>
      </div>
      {pageSettings && (
        <div className="panel-card mb-3 p-3">
          <GoatPageSettings arranging={arrange} canSetOfficeDefault={isAdmin} onArrange={setArrange} />
        </div>
      )}
      <Grid
        breakpoints={{ lg: 1100, md: 800, sm: 0 }}
        cols={{ lg: 12, md: 8, sm: 1 }}
        compactType="vertical"
        draggableHandle=".goat-box-drag"
        isDraggable={arrange}
        isResizable={arrange}
        layouts={{ lg: layoutOf(boxes), md: layoutOf(boxes), sm: stack(boxes) }}
        margin={[12, 12]}
        onLayoutChange={(current) => {
          if (!arrange) return;
          if (typeof window !== "undefined" && window.innerWidth >= 1100) applyLayout(current);
        }}
        rowHeight={32}
      >
        {boxes.map((box) => (
          <div className="h-full" id={`goat-box-${box.i}`} key={box.i}>
            <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--line-soft)] bg-white">
              <header className={`${arrange ? "goat-box-drag cursor-grab" : ""} border-b border-[var(--line-soft)] px-3 py-2`}>
                <h2 className="truncate text-sm font-semibold">{boxTitle(box)}</h2>
              </header>
              <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto p-3">{body(box)}</div>
            </article>
          </div>
        ))}
      </Grid>
    </div>
  );
}
