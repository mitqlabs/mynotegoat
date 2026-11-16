"use client";

import { useMemo, useState } from "react";
import { ageOn } from "@/lib/age";
import { PatientPhotoControl } from "@/components/patient-photo-cropper";
import { formatDobDisplay, formatFolderMoney, formatPhoneDisplay, splitFullName } from "@/lib/patient-folders";
import { PatientFolderFiles } from "@/components/patient-folder-files";
import { PatientTodoList, type PatientTodoDraft, type PatientTodoItem } from "@/components/patient-todo-list";

export type FolderListRow = {
  id: string;
  name: string;
  dob: string;
  phone: string;
  active: number;
  submitted: number;
  paid: number;
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

function CountBubble({ n, tone }: { n: number; tone: "green" | "amber" | "blue" }) {
  const color =
    n === 0
      ? "bg-slate-100 text-slate-400"
      : tone === "green"
        ? "bg-emerald-100 text-emerald-700"
        : tone === "amber"
          ? "bg-amber-100 text-amber-700"
          : "bg-sky-100 text-sky-700";
  return <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-semibold ${color}`}>{n}</span>;
}

export function PatientFolderListView({
  rows,
  onOpen,
  onCreate,
}: {
  rows: FolderListRow[];
  onOpen: (id: string) => void;
  onCreate: (draft: { firstName: string; lastName: string; dob: string; phone: string; openCase: boolean }) => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ firstName: "", lastName: "", dob: "", phone: "", openCase: false });
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => `${row.name} ${row.dob} ${row.phone}`.toLowerCase().includes(q));
  }, [query, rows]);
  const caseTotal = rows.reduce((sum, row) => sum + row.total, 0);
  return (
    <div className="space-y-5">
      <section className="panel-card p-4">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button className="btn btn-primary" onClick={() => setCreating(true)} type="button">
            New Patient
          </button>
        </div>
        {creating && (
          <form
            className="mt-4 grid gap-3 rounded-xl border border-[var(--line-soft)] bg-white p-3 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.firstName.trim() || !draft.lastName.trim()) return;
              onCreate(draft);
              setDraft({ firstName: "", lastName: "", dob: "", phone: "", openCase: false });
              setCreating(false);
            }}
          >
            <p className="md:col-span-2 text-sm font-semibold">New patient — person info only. A case is optional and starts empty.</p>
            <label className={LABEL}>
              First name
              <input className={FIELD} value={draft.firstName} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} />
            </label>
            <label className={LABEL}>
              Last name
              <input className={FIELD} value={draft.lastName} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} />
            </label>
            <label className={LABEL}>
              DOB
              <input className={FIELD} placeholder="MM/DD/YYYY" value={draft.dob} onChange={(event) => setDraft({ ...draft, dob: event.target.value })} />
            </label>
            <label className={LABEL}>
              Phone
              <input className={FIELD} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input checked={draft.openCase} onChange={(event) => setDraft({ ...draft, openCase: event.target.checked })} type="checkbox" />
              Also open a blank case (no attorney, billing, or notes copied)
            </label>
            <div className="flex gap-2 md:col-span-2">
              <button className="btn btn-primary" type="submit">
                Save patient
              </button>
              <button className="rounded-lg bg-[var(--bg-soft)] px-3 py-1.5 text-sm font-semibold" onClick={() => setCreating(false)} type="button">
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="mt-4 space-y-3 rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Search</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search patient or attorney..."
              value={query}
            />
          </label>
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
                <th className="px-4 py-3 text-center">Active</th>
                <th className="px-4 py-3 text-center">Submitted</th>
                <th className="px-4 py-3 text-center">Paid</th>
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
                  <td className="px-4 py-3 text-center"><CountBubble n={row.active} tone="green" /></td>
                  <td className="px-4 py-3 text-center"><CountBubble n={row.submitted} tone="amber" /></td>
                  <td className="px-4 py-3 text-center"><CountBubble n={row.paid} tone="blue" /></td>
                  <td className="px-4 py-3 text-center font-semibold">{row.total}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr className="border-t border-[var(--line-soft)]">
                  <td className="px-4 py-5 text-sm text-[var(--text-muted)]" colSpan={7}>
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
  onNewCase,
  onSavePerson,
  onAddNote,
  todoItems,
  onToggleTodo,
  onAddTodo,
  onSavePhoto,
}: {
  folder: FolderDetail;
  onBack: () => void;
  onOpenCase: (caseId: string) => void;
  onNewCase: (draft: { attorney: string; dateOfInjury: string }) => void;
  onSavePerson: (next: { firstName: string; lastName: string; dob: string; phone: string; sex: string; maritalStatus: string; email: string; address: string }) => void;
  onAddNote: (text: string) => void;
  todoItems: PatientTodoItem[];
  onToggleTodo: (id: string) => void;
  onAddTodo: (draft: PatientTodoDraft) => string;
  onSavePhoto: (dataUrl: string) => void;
}) {
  const parts = splitFullName(folder.name);
  const [person, setPerson] = useState({
    firstName: parts.firstName,
    lastName: parts.lastName,
    dob: formatDobDisplay(folder.dob),
    phone: formatPhoneDisplay(folder.phone),
    sex: folder.sex,
    maritalStatus: folder.maritalStatus,
    email: folder.email,
    address: folder.address,
  });
  const [note, setNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [addingCase, setAddingCase] = useState(false);
  const [caseDraft, setCaseDraft] = useState({ attorney: "", dateOfInjury: "" });
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
        <div className="flex gap-2">
          <button
            className="rounded-full border border-[#d5e4ef] bg-white px-4 py-2 text-sm font-semibold text-[#172a3a]"
            onClick={() => onSavePerson(person)}
            type="button"
          >
            Edit Patient Info
          </button>
          <button className="rounded-full bg-[#0d79bf] px-4 py-2 text-sm font-semibold text-white" onClick={() => setAddingCase(true)} type="button">
            + New Case
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
      <section className="panel-card p-3">
        <div className="mb-2">
          <h3 className="font-semibold text-[#172a3a]">Patient Info</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>Last Name<input className={FIELD} value={person.lastName} onChange={(event) => setPerson({ ...person, lastName: event.target.value })} /></label>
          <label className={LABEL}>First Name<input className={FIELD} value={person.firstName} onChange={(event) => setPerson({ ...person, firstName: event.target.value })} /></label>
          <label className={LABEL}>DOB<input className={FIELD} value={person.dob} onChange={(event) => setPerson({ ...person, dob: event.target.value })} /></label>
          <label className={LABEL}>Phone<input className={FIELD} value={person.phone} onChange={(event) => setPerson({ ...person, phone: event.target.value })} /></label>
          <label className={LABEL}>Sex<input className={FIELD} value={person.sex} onChange={(event) => setPerson({ ...person, sex: event.target.value })} /></label>
          <label className={LABEL}>Marital Status<input className={FIELD} value={person.maritalStatus} onChange={(event) => setPerson({ ...person, maritalStatus: event.target.value })} /></label>
          <label className={LABEL}>Email<input className={FIELD} value={person.email} onChange={(event) => setPerson({ ...person, email: event.target.value })} /></label>
          <label className={LABEL}>Address<input className={FIELD} value={person.address} onChange={(event) => setPerson({ ...person, address: event.target.value })} /></label>
        </div>
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
                  <td className="px-4 py-3 text-right">{formatFolderMoney(row.billed)}</td>
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

      {addingCase && (
        <form
          className="panel-card grid gap-3 p-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            onNewCase(caseDraft);
            setCaseDraft({ attorney: "", dateOfInjury: "" });
            setAddingCase(false);
          }}
        >
          <p className="md:col-span-2 text-sm text-[#172a3a]">
            Person info stays on the patient. This case does not copy attorney, billing, or notes from the other cases.
          </p>
          <label className={LABEL}>Attorney<input className={FIELD} value={caseDraft.attorney} onChange={(event) => setCaseDraft({ ...caseDraft, attorney: event.target.value })} /></label>
          <label className={LABEL}>Date of injury<input className={FIELD} placeholder="MM/DD/YYYY" value={caseDraft.dateOfInjury} onChange={(event) => setCaseDraft({ ...caseDraft, dateOfInjury: event.target.value })} /></label>
          <div className="flex gap-2 md:col-span-2">
            <button className="rounded-full bg-[#0d79bf] px-4 py-2 text-sm font-semibold text-white" type="submit">Add case</button>
            <button className="rounded-full bg-[#e4f0f7] px-4 py-2 text-sm font-semibold" onClick={() => setAddingCase(false)} type="button">Cancel</button>
          </div>
        </form>
      )}

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
              className="mb-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!note.trim()) return;
                onAddNote(note.trim());
                setNote("");
                setAddingNote(false);
              }}
            >
              <textarea
                className={`${FIELD} min-h-[64px]`}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Type a note…"
                value={note}
              />
              <div className="mt-2 flex justify-end">
                <button className="btn btn-primary btn-sm" disabled={!note.trim()} type="submit">
                  Add note
                </button>
              </div>
            </form>
          )}
          <div className="max-h-36 overflow-y-auto text-sm">
            {folder.notes.map((entry) => (
              <div className="border-b border-[var(--line-soft)] py-1.5 last:border-0" key={entry.id}>
                <p>
                  <span className="font-semibold">{entry.date}</span>
                  {entry.author && <span className="ml-2 font-semibold text-[var(--brand-primary)]">{entry.author}</span>}
                </p>
                <p className="whitespace-pre-wrap break-words">{entry.text}</p>
              </div>
            ))}
            {folder.cases.length > 1
              ? folder.cases.map((row) => {
                  const hasNotes = row.notes.length > 0 || Boolean(row.earlierNotes?.trim());
                  if (!hasNotes) return null;
                  return (
                    <div className="pt-2" key={row.id}>
                      <p className="text-xs font-semibold text-[var(--text-muted)]">{row.caseNumber}</p>
                      {row.notes.map((entry) => (
                        <div className="border-b border-[var(--line-soft)] py-1.5 last:border-0" key={entry.id}>
                          <p>
                            <span className="font-semibold">{entry.date}</span>
                            {entry.author && <span className="ml-2 font-semibold text-[var(--brand-primary)]">{entry.author}</span>}
                          </p>
                          <p className="whitespace-pre-wrap break-words">{entry.text}</p>
                        </div>
                      ))}
                      {row.earlierNotes?.trim() ? (
                        <p className="whitespace-pre-wrap break-words py-1.5 text-[var(--text-muted)]">{row.earlierNotes}</p>
                      ) : null}
                    </div>
                  );
                })
              : folder.cases.map((row) => (
                  <div key={row.id}>
                    {row.notes.map((entry) => (
                      <div className="border-b border-[var(--line-soft)] py-1.5 last:border-0" key={entry.id}>
                        <p>
                          <span className="font-semibold">{entry.date}</span>
                          {entry.author && <span className="ml-2 font-semibold text-[var(--brand-primary)]">{entry.author}</span>}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{entry.text}</p>
                      </div>
                    ))}
                    {row.earlierNotes?.trim() ? (
                      <p className="whitespace-pre-wrap break-words py-1.5 text-[var(--text-muted)]">{row.earlierNotes}</p>
                    ) : null}
                  </div>
                ))}
            {folder.notes.length === 0 && folder.cases.every((row) => row.notes.length === 0 && !row.earlierNotes?.trim()) && (
              <p className="py-1 text-[var(--text-muted)]">No notes.</p>
            )}
          </div>
        </section>
        <section className="panel-card min-w-0 p-3">
          <h3 className="mb-1 font-semibold">To-Do</h3>
          <PatientTodoList compact items={todoItems} onAdd={onAddTodo} onToggle={onToggleTodo} />
        </section>
        <section className="panel-card min-w-0 p-3">
          <h3 className="mb-1 font-semibold">Alerts</h3>
          <ul className="max-h-36 overflow-y-auto">
            {folder.alerts.map((alert) => (
              <li className="flex items-center gap-2 border-b border-[var(--line-soft)] py-1.5 text-sm last:border-0" key={alert}>
                <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                {alert}
              </li>
            ))}
            {folder.alerts.length === 0 && <li className="py-1 text-sm text-[var(--text-muted)]">No alerts.</li>}
          </ul>
        </section>
        <PatientFolderFiles
          cases={folder.cases.map((row) => ({
            id: row.id,
            label: row.caseNumber,
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
