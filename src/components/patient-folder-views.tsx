"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { softPillStyle } from "@/lib/color-utils";
import { ageOn } from "@/lib/age";
import { PatientPhotoControl } from "@/components/patient-photo-cropper";
import { formatDobDisplay, formatFolderMoney, formatPhoneDisplay, splitFullName } from "@/lib/patient-folders";
import { PatientFolderFiles } from "@/components/patient-folder-files";
import { PatientTodoList, type PatientTodoDraft, type PatientTodoItem } from "@/components/patient-todo-list";
import { normalizeMaritalStatus, type MaritalStatus } from "@/lib/marital-status";
import {
  PatientPersonFields,
  isoToUsDate,
  type PatientPersonDraft,
  type PatientSexValue,
} from "@/components/patient-person-fields";
import { formatUsPhoneInput } from "@/lib/phone-format";

export type FolderStatusColumn = { name: string; color: string };

export type FolderListRow = {
  id: string;
  name: string;
  dob: string;
  phone: string;
  /** Case counts keyed by the office's configured status name. Missing keys count as zero. */
  counts: Record<string, number>;
  total: number;
  photo?: string;
};

export type FolderNote = { id: string; date: string; author: string; text: string };
export type FolderTodo = { id: string; title: string; due: string };

export type FolderCaseRow = {
  id: string;
  caseNumber: string;
  dateOfInjury: string;
  initialExam: string;
  attorney: string;
  attorneyPhone: string;
  /** The office case-number string, when it differs from the short case label. */
  fileNumber?: string;
  location: string;
  status: string;
  review: string;
  lop: string;
  priorCare: string;
  discharge: string;
  billed: number;
  paid: number;
  paidDate: string;
  owed: number;
  notes: FolderNote[];
  /** Older free-form case note, shown read-only. Not a separate stored type. */
  earlierNotes?: string;
  /** ISO date used to pick the latest case. Date of injury, else when the case was created. */
  openedOn?: string;
};

export type FolderDetail = {
  id: string;
  name: string;
  dob: string;
  phone: string;
  sex: string;
  maritalStatus: string;
  email: string;
  address: string;
  alerts: string[];
  /** Same per-person flag the case page stores as textRemindersOff. */
  textRemindersOff?: boolean;
  todos: FolderTodo[];
  notes: FolderNote[];
  cases: FolderCaseRow[];
  photo?: string;
};

const FIELD = "w-full rounded-xl border border-[#d5e4ef] bg-white px-3 py-2 text-sm text-[#172a3a] outline-none focus:border-[#0d79bf]";
const LABEL = "grid gap-1 text-xs font-semibold text-[#6b8496]";

export function statusPillClass(status: string): string {
  if (status === "Active") return "bg-emerald-100 text-emerald-800";
  if (status === "Submitted") return "bg-amber-100 text-amber-800";
  if (status === "Paid") return "bg-sky-100 text-sky-800";
  if (status === "Dropped") return "bg-rose-100 text-rose-800";
  if (status === "Ready To Submit") return "bg-orange-100 text-orange-800";
  if (status === "Discharged") return "bg-indigo-100 text-indigo-800";
  return "bg-slate-100 text-slate-700";
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPillClass(status)}`}>{status}</span>;
}

function CountBubble({ n, color }: { n: number; color: string }) {
  const tinted = n > 0 ? softPillStyle(color) : undefined;
  return (
    <span
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-semibold ${tinted ? "" : "bg-slate-100 text-slate-400"}`}
      style={tinted}
    >
      {n}
    </span>
  );
}

export function PatientFolderListView({
  rows,
  statuses,
  onOpen,
  onNewPatient,
}: {
  rows: FolderListRow[];
  statuses: FolderStatusColumn[];
  onOpen: (id: string) => void;
  onNewPatient: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => `${row.name} ${row.dob} ${row.phone}`.toLowerCase().includes(q));
  }, [query, rows]);
  const caseTotal = rows.reduce((sum, row) => sum + row.total, 0);
  return (
    <div className="space-y-5">
      <section className="panel-card p-4">
        <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-[12rem] flex-1 gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Search</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search patient or attorney..."
                value={query}
              />
            </label>
            <button className="btn btn-primary" onClick={onNewPatient} type="button">
              New Patient
            </button>
          </div>
        </div>
      </section>
      <section className="panel-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line-soft)] px-4 py-2.5 text-sm">
          <span className="font-semibold">
            {shown.length} patient{shown.length === 1 ? "" : "s"}
          </span>
          <span className="text-[var(--text-muted)]">{caseTotal} case{caseTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-[var(--bg-soft)] text-left text-sm">
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">DOB</th>
                <th className="px-4 py-3">Phone</th>
                {statuses.map((status) => (
                  <th className="px-4 py-3 text-center" key={status.name}>{status.name}</th>
                ))}
                <th className="px-4 py-3 text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr className="border-t border-[var(--line-soft)]" key={row.id}>
                  <td className="px-4 py-3">
                    <button className="inline-flex items-center gap-2 font-semibold text-[var(--brand-primary)] underline" onClick={() => onOpen(row.id)} type="button">
                      {row.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt="" className="h-7 w-7 rounded-md object-cover" src={row.photo} />
                      ) : null}
                      {row.name}
                    </button>
                  </td>
                  <td className="px-4 py-3">{formatDobDisplay(row.dob)}</td>
                  <td className="px-4 py-3">{formatPhoneDisplay(row.phone)}</td>
                  {statuses.map((status) => (
                    <td className="px-4 py-3 text-center" key={status.name}>
                      <CountBubble color={status.color} n={row.counts[status.name] ?? 0} />
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center font-semibold">{row.total}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr className="border-t border-[var(--line-soft)]">
                  <td className="px-4 py-5 text-sm text-[var(--text-muted)]" colSpan={4 + statuses.length}>
                    No patients match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function PatientFolderPageView({
  folder,
  onBack,
  onOpenCase,
  onAddCase,
  onSavePerson,
  onAddNote,
  onAddAlert,
  todoItems,
  onToggleTodo,
  onAddTodo,
  onSavePhoto,
}: {
  folder: FolderDetail;
  onBack: () => void;
  onOpenCase: (caseId: string) => void;
  onAddCase: () => void;
  onSavePerson: (next: PatientPersonDraft) => void;
  onAddNote: (draft: { text: string; caseId?: string }) => void;
  onAddAlert: (text: string) => void;
  todoItems: PatientTodoItem[];
  onToggleTodo: (id: string) => void;
  onAddTodo: (draft: PatientTodoDraft) => string;
  onSavePhoto: (dataUrl: string) => void;
}) {
  const parts = splitFullName(folder.name);
  const sex: PatientSexValue =
    folder.sex === "Male" || folder.sex === "Female" || folder.sex === "Other" ? folder.sex : "";
  const marital = normalizeMaritalStatus(folder.maritalStatus) ?? "";
  const [person, setPerson] = useState<PatientPersonDraft>({
    firstName: parts.firstName,
    lastName: parts.lastName,
    dob: isoToUsDate(folder.dob),
    phone: formatUsPhoneInput(folder.phone),
    sex,
    maritalStatus: marital as MaritalStatus | "",
    email: folder.email,
    address: folder.address,
    textRemindersOff: folder.textRemindersOff === true,
  });
  const [note, setNote] = useState("");
  const [noteCaseId, setNoteCaseId] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [alertDraft, setAlertDraft] = useState("");
  const [addingAlert, setAddingAlert] = useState(false);
  const age = ageOn(folder.dob, "2026-11-11");
  const caseMoney = folder.cases.map((row) => {
    const balance = row.billed - row.paid;
    const settled = row.status === "Paid";
    return { reduced: settled ? balance : null, outstanding: settled ? null : balance };
  });
  const moneyTotals = { billed: 0, paid: 0, reduced: 0, outstanding: 0 };
  folder.cases.forEach((row, index) => {
    moneyTotals.billed += row.billed;
    moneyTotals.paid += row.paid;
    moneyTotals.reduced += caseMoney[index].reduced ?? 0;
    moneyTotals.outstanding += caseMoney[index].outstanding ?? 0;
  });
  const shownNotes = [
    ...folder.notes.map((entry) => ({
      key: entry.id,
      label: "General",
      date: entry.date,
      author: entry.author,
      text: entry.text,
    })),
    ...folder.cases.flatMap((row) => [
      ...row.notes.map((entry) => ({
        key: entry.id,
        label: row.caseNumber,
        date: entry.date,
        author: entry.author,
        text: entry.text,
      })),
      ...(row.earlierNotes?.trim()
        ? [{ key: `${row.id}-earlier`, label: row.caseNumber, date: "", author: "", text: row.earlierNotes.trim() }]
        : []),
    ]),
  ];
  return (
    <div className="space-y-5">
      <button className="text-sm font-semibold text-[var(--text-muted)]" onClick={onBack} type="button">
        Patient List
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <PatientPhotoControl caseIds={folder.cases.map((row) => row.id)} name={folder.name} onSave={onSavePhoto} photo={folder.photo} />
          <div>
            <h2 className="text-2xl font-semibold text-[#172a3a]">{folder.name}</h2>
            <p className="text-sm text-[#6b8496]">
              Patient · {folder.cases.length} case{folder.cases.length === 1 ? "" : "s"} · DOB {formatDobDisplay(folder.dob)}
              {age !== null ? ` · Age ${age}` : ""}
            </p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={onAddCase} type="button">
          Add Case
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
      <section className="panel-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-[#172a3a]">Patient Info</h3>
          <button
            className="rounded-full border border-[#d5e4ef] bg-white px-4 py-2 text-sm font-semibold text-[#172a3a]"
            onClick={() => onSavePerson(person)}
            type="button"
          >
            Save Patient Info
          </button>
        </div>
        <PatientPersonFields onChange={setPerson} value={person} />
      </section>
      <section className="panel-card min-w-0 overflow-hidden">
        <div className="border-b border-[var(--line-soft)] px-4 py-2.5">
          <h3 className="font-semibold">Cases</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-[var(--bg-soft)] text-left text-sm">
                <th className="px-4 py-3">Case #</th>
                <th className="px-4 py-3">Date of injury</th>
                <th className="px-4 py-3">Attorney</th>
                <th className="px-4 py-3">Initial exam</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Billed</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Reduced</th>
                <th className="px-4 py-3 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {folder.cases.map((row, index) => (
                <tr className="border-t border-[var(--line-soft)]" key={row.id}>
                  <td className="px-4 py-3">
                    <button className="font-semibold text-[var(--brand-primary)] underline" onClick={() => onOpenCase(row.id)} type="button">
                      {row.caseNumber}
                    </button>
                  </td>
                  <td className="px-4 py-3">{row.dateOfInjury}</td>
                  <td className="px-4 py-3">{row.attorney}</td>
                  <td className="px-4 py-3">{row.initialExam}</td>
                  <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link className="font-semibold text-[var(--brand-primary)] underline" href={`/billing?patient=${encodeURIComponent(row.id)}`}>
                      {formatFolderMoney(row.billed)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">{formatFolderMoney(row.paid)}</td>
                  <td className="px-4 py-3 text-right">{caseMoney[index].reduced === null ? "" : formatFolderMoney(caseMoney[index].reduced)}</td>
                  <td className="px-4 py-3 text-right">{caseMoney[index].outstanding === null ? "" : formatFolderMoney(caseMoney[index].outstanding)}</td>
                </tr>
              ))}
              <tr className="border-t border-[var(--line-soft)] font-semibold">
                <td className="px-4 py-3">Totals</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right">{formatFolderMoney(moneyTotals.billed)}</td>
                <td className="px-4 py-3 text-right">{formatFolderMoney(moneyTotals.paid)}</td>
                <td className="px-4 py-3 text-right">{formatFolderMoney(moneyTotals.reduced)}</td>
                <td className="px-4 py-3 text-right">{formatFolderMoney(moneyTotals.outstanding)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <section className="panel-card flex min-w-0 flex-col p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Notes</h3>
            <button className="text-xs font-semibold text-[var(--brand-primary)]" onClick={() => setAddingNote((open) => !open)} type="button">
              {addingNote ? "Cancel" : "+ Add"}
            </button>
          </div>
          {addingNote && (
            <form
              className="mb-2 grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!note.trim()) return;
                onAddNote({ text: note.trim(), caseId: noteCaseId || undefined });
                setNote("");
                setNoteCaseId("");
                setAddingNote(false);
              }}
            >
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-[var(--text-muted)]">Case</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onChange={(event) => setNoteCaseId(event.target.value)}
                  value={noteCaseId}
                >
                  <option value="">General (no case)</option>
                  {folder.cases.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.caseNumber}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                className={`${FIELD} min-h-[64px]`}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Type a note…"
                value={note}
              />
              <div className="flex justify-end">
                <button className="btn btn-primary btn-sm" disabled={!note.trim()} type="submit">
                  Add note
                </button>
              </div>
            </form>
          )}
          <div className="max-h-36 overflow-y-auto text-sm">
            {shownNotes.length === 0 && <p className="py-1 text-[var(--text-muted)]">No notes.</p>}
            {shownNotes.map((entry) => (
              <div className="border-b border-[var(--line-soft)] py-1.5 last:border-0" key={entry.key}>
                <p>
                  <span className="text-xs font-semibold text-[var(--text-muted)]">{entry.label}</span>
                  {entry.date && <span className="ml-2 font-semibold">{entry.date}</span>}
                  {entry.author && <span className="ml-2 font-semibold text-[var(--brand-primary)]">{entry.author}</span>}
                </p>
                <p className="whitespace-pre-wrap break-words">{entry.text}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="panel-card min-w-0 p-3">
          <h3 className="mb-1 font-semibold">To-Do</h3>
          <PatientTodoList
            cases={folder.cases.map((row) => ({ id: row.id, caseNumber: row.caseNumber }))}
            compact
            items={todoItems}
            onAdd={onAddTodo}
            onToggle={onToggleTodo}
          />
        </section>
        <section className="panel-card min-w-0 p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Alerts</h3>
            <button className="text-xs font-semibold text-[var(--brand-primary)]" onClick={() => setAddingAlert((open) => !open)} type="button">
              {addingAlert ? "Cancel" : "+ Add"}
            </button>
          </div>
          {addingAlert && (
            <form
              className="mb-2 flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = alertDraft.trim().toUpperCase();
                if (!text) return;
                onAddAlert(text);
                setAlertDraft("");
                setAddingAlert(false);
              }}
            >
              <input
                className="min-w-0 flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm"
                onChange={(event) => setAlertDraft(event.target.value)}
                placeholder="Add Patient Alert (Ex: Hx of Cancer, Broken Rib, etc.)"
                value={alertDraft}
              />
              <button className="rounded-lg border border-[#e8b931] bg-[#fef9e7] px-3 py-1.5 text-sm font-bold text-[#92400e] transition hover:bg-[#fdf2c5]" type="submit">
                + Alert
              </button>
            </form>
          )}
          <ul className="max-h-36 overflow-y-auto">
            {folder.alerts.map((alert, index) => (
              <li className="py-1" key={`${alert}-${index}`}>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#e8b931] bg-[#fef9e7] px-2 py-1 text-sm font-bold text-[#92400e]">
                  ⚠ {alert}
                </span>
              </li>
            ))}
            {folder.alerts.length === 0 && <li className="py-1 text-sm text-[var(--text-muted)]">No alerts.</li>}
          </ul>
        </section>
        <PatientFolderFiles
          cases={folder.cases.map((row) => ({
            id: row.id,
            label: row.caseNumber,
            sortAt: row.openedOn ?? "",
          }))}
        />
      </div>
    </div>
  );
}

export function PatientFolderCaseView({
  patientName,
  person,
  row,
  onViewPatient,
  onBack,
}: {
  patientName: string;
  person: { dob: string; phone: string; email: string; address: string; photo?: string };
  row: FolderCaseRow;
  onViewPatient: () => void;
  onBack: () => void;
}) {
  const show = (value: string) => value.trim() || "—";
  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6b8496]">
        <button className="font-semibold" onClick={onBack} type="button">Patient List</button>
        <span> · </span>
        <button className="font-semibold text-[#0d79bf]" onClick={onViewPatient} type="button">{patientName}</button>
        <span> · Case {row.caseNumber}</span>
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-[#172a3a]">{patientName}</h2>
          <p className="text-sm text-[#6b8496]">
            Case {row.caseNumber} · {row.status} · Date of injury {row.dateOfInjury} · Initial exam {row.initialExam}
          </p>
        </div>
        <button className="rounded-full border border-[#d5e4ef] bg-white px-4 py-2 text-sm font-semibold" onClick={onViewPatient} type="button">
          View Patient
        </button>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-[#b7cfe0] bg-[#f7fbfe] px-4 py-3">
        <div className="flex items-start gap-3">
          {person.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="h-12 w-12 rounded-xl object-cover" src={person.photo} />
          ) : null}
          <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6b8496]">From the patient page</p>
          <p className="mt-1 text-sm text-[#172a3a]">
            <span className="font-semibold">DOB</span> {formatDobDisplay(person.dob)}
            <span> · </span>
            <span className="font-semibold">Phone</span> {formatPhoneDisplay(person.phone)}
            <span> · </span>
            <span className="font-semibold">Email</span> {person.email || "—"}
          </p>
          <p className="text-sm text-[#172a3a]">
            <span className="font-semibold">Address</span> {person.address || "—"}
          </p>
          </div>
        </div>
        <button className="rounded-full border border-[#d5e4ef] bg-white px-4 py-2 text-sm font-semibold text-[#0d79bf]" onClick={onViewPatient} type="button">
          Edit on patient page
        </button>
      </section>

      <section className="rounded-2xl border border-[#d5e4ef] bg-white p-4">
        <div className="mb-3">
          <h3 className="font-semibold">Case Info</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <ReadOnly label="Attorney" value={row.attorney} />
          <ReadOnly label="Attorney Phone" value={formatPhoneDisplay(row.attorneyPhone)} />
          <ReadOnly label="Case #" value={row.fileNumber || row.caseNumber.replace(/^#/, "")} />
          <ReadOnly label="Date of Injury" value={row.dateOfInjury} />
          <ReadOnly label="Initial Exam" value={row.initialExam} />
          <ReadOnly label="Location" value={row.location} />
          <ReadOnly label="Case Status" value={row.status} />
        </div>
      </section>

      <section className="rounded-2xl border border-[#d5e4ef] bg-white p-4">
        <div className="mb-3">
          <h3 className="font-semibold">Additional Details</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <ReadOnly label="Review" value={show(row.review)} />
          <ReadOnly label="LOP" value={show(row.lop)} />
          <ReadOnly label="Prior Care" value={show(row.priorCare)} />
          <ReadOnly label="Discharge" value={show(row.discharge)} />
          <ReadOnly label="Billed" value={formatFolderMoney(row.billed)} />
          <ReadOnly label="Paid Date" value={show(row.paidDate)} />
          <ReadOnly label="Paid Amount" value={row.paid ? formatFolderMoney(row.paid) : "—"} />
          <ReadOnly label="Owed" value={formatFolderMoney(row.owed)} />
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="panel-card p-4">
          <div className="mb-2">
            <h3 className="font-semibold">Notes</h3>
          </div>
          <ul className="divide-y divide-[#e6f0f6]">
            {row.notes.map((entry) => (
              <li className="py-2" key={entry.id}>
                <p className="text-sm">
                  <span className="font-semibold text-[#0d79bf]">{entry.date}</span>
                  {entry.author && <span className="ml-2 font-semibold text-[#0d79bf]">{entry.author}</span>}
                </p>
                <p className="text-sm">{entry.text}</p>
              </li>
            ))}
            {row.notes.length === 0 && <li className="py-2 text-sm text-[#6b8496]">No notes on this case.</li>}
          </ul>
        </section>
        <section className="panel-card p-4">
          <div className="mb-2">
            <h3 className="font-semibold">Billing for this case</h3>
          </div>
          <dl className="divide-y divide-[#e6f0f6] text-sm">
            <div className="flex justify-between py-2"><dt>Total billed</dt><dd className="font-semibold">{formatFolderMoney(row.billed)}</dd></div>
            <div className="flex justify-between py-2"><dt>Total paid</dt><dd className="font-semibold">{formatFolderMoney(row.paid)}</dd></div>
            <div className="flex justify-between py-2"><dt>Balance</dt><dd className="font-semibold text-[#0d79bf]">{formatFolderMoney(row.owed)}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <label className={LABEL}>
      {label}
      <div className={`${FIELD} bg-[#f8fbfd]`}>{value || "—"}</div>
    </label>
  );
}

export type CaseListEntry = {
  id: string;
  folderId: string;
  name: string;
  dateOfInjury: string;
  initialExam: string;
  attorney: string;
  status: string;
  caseNumber: string;
  phone: string;
  address: string;
  kind: "pi" | "cash";
};

export function CaseListPreviewView({
  rows,
  onOpen,
}: {
  rows: CaseListEntry[];
  onOpen: (row: CaseListEntry) => void;
}) {
  const [section, setSection] = useState<"pi" | "cash" | "todo">("pi");
  const [query, setQuery] = useState("");
  const shown = rows.filter((row) => {
    if (section === "cash" && row.kind !== "cash") return false;
    if (section === "pi" && row.kind !== "pi") return false;
    if (section === "todo") return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${row.name} ${row.attorney} ${row.caseNumber} ${row.phone} ${row.address}`.toLowerCase().includes(q);
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-[#172a3a]">Case List</h2>
        </div>
        <button className="rounded-full bg-[#0d79bf] px-4 py-2 text-sm font-semibold text-white" type="button">
          New Case
        </button>
      </div>
      <section className="rounded-2xl border border-[#d5e4ef] bg-white p-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["pi", "Personal Injury"],
              ["cash", "Cash / Other"],
              ["todo", "To-Do"],
            ] as const
          ).map(([id, label]) => (
            <button
              className={`rounded-full px-4 py-2 text-sm font-semibold ${section === id ? "bg-[#0d79bf] text-white" : "bg-[#e4f0f7] text-[#172a3a]"}`}
              key={id}
              onClick={() => setSection(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className={`${LABEL} md:col-span-4`}>
            Search
            <input className={FIELD} onChange={(event) => setQuery(event.target.value)} placeholder="Search patient or attorney..." value={query} />
          </label>
          <ReadOnly label="Initial Exam — year / months" value="2026 · All months" />
          <ReadOnly label="Attorney" value="All attorneys" />
          <ReadOnly label="Status" value="All" />
          <ReadOnly label="Review" value="All" />
        </div>
      </section>
      <section className="rounded-2xl border border-[#d5e4ef] bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-semibold">{section === "todo" ? "To-Do lives on the patient" : `${shown.length} cases`}</p>
          <span className="rounded-full border border-[#d5e4ef] px-3 py-1 text-xs font-semibold text-[#6b8496]">Print</span>
        </div>
        {section === "todo" ? (
          <p className="px-4 pb-4 text-sm text-[#6b8496]">General to-dos are on the patient page. They are not tied to a case, and they are not mixed into case notes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f4f9fc] text-xs font-semibold uppercase tracking-wide text-[#6b8496]">
                <tr>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Date of injury</th>
                  <th className="px-4 py-3">Initial exam</th>
                  <th className="px-4 py-3">Attorney</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Case #</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr className="border-t border-[#e6f0f6]" key={row.id}>
                    <td className="px-4 py-3">
                      <button className="font-semibold text-[#0d79bf]" onClick={() => onOpen(row)} type="button">{row.name}</button>
                      <p className="text-xs text-[#6b8496]">{formatPhoneDisplay(row.phone)}</p>
                    </td>
                    <td className="px-4 py-3">{row.dateOfInjury}</td>
                    <td className="px-4 py-3">{row.initialExam}</td>
                    <td className="px-4 py-3">{row.attorney}</td>
                    <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                    <td className="px-4 py-3 font-semibold">{row.caseNumber}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-[#6b8496]" colSpan={6}>No cases in this view.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
