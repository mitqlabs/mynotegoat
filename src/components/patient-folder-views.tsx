"use client";

import { useMemo, useState } from "react";
import { ageOn } from "@/lib/age";
import { formatDobDisplay, formatFolderMoney, formatPhoneDisplay, splitFullName } from "@/lib/patient-folders";

export type FolderListRow = {
  id: string;
  name: string;
  dob: string;
  phone: string;
  active: number;
  submitted: number;
  paid: number;
  total: number;
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

function initials(name: string): string {
  const { firstName, lastName } = splitFullName(name);
  const a = (firstName[0] || lastName[0] || "").toUpperCase();
  const b = (lastName[0] || "").toUpperCase();
  return firstName ? `${a}${b}` : a;
}

function moneyTone(kind: "billed" | "paid" | "owed"): string {
  if (kind === "paid") return "text-emerald-700";
  if (kind === "owed") return "text-[#0d79bf]";
  return "text-[#172a3a]";
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-[#172a3a]">Patient List</h2>
          <p className="mt-1 text-sm text-[#6b8496]">One row per person. Click a patient to open their page and all of their cases.</p>
        </div>
        <button className="rounded-full bg-[#0d79bf] px-4 py-2 text-sm font-semibold text-white" onClick={() => setCreating(true)} type="button">
          + New Patient
        </button>
      </div>
      {creating && (
        <form
          className="grid gap-3 rounded-2xl border border-[#d5e4ef] bg-white p-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.firstName.trim() || !draft.lastName.trim()) return;
            onCreate(draft);
            setDraft({ firstName: "", lastName: "", dob: "", phone: "", openCase: false });
            setCreating(false);
          }}
        >
          <p className="md:col-span-2 text-sm font-semibold text-[#172a3a]">New patient — person info only. A case is optional and starts empty.</p>
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
            <button className="rounded-full bg-[#0d79bf] px-4 py-2 text-sm font-semibold text-white" type="submit">
              Save patient
            </button>
            <button className="rounded-full bg-[#e4f0f7] px-4 py-2 text-sm font-semibold" onClick={() => setCreating(false)} type="button">
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="rounded-2xl border border-[#d5e4ef] bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#e6f0f6] px-4 py-3">
          <input
            className="min-w-[16rem] flex-1 rounded-full border border-[#d5e4ef] px-4 py-2 text-sm outline-none focus:border-[#0d79bf]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search patients by name, DOB or phone..."
            value={query}
          />
          <p className="text-sm text-[#6b8496]">
            {shown.length} patients · {caseTotal} cases
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#f4f9fc] text-xs font-semibold uppercase tracking-wide text-[#6b8496]">
              <tr>
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
                <tr className="border-t border-[#e6f0f6]" key={row.id}>
                  <td className="px-4 py-3">
                    <button className="font-semibold text-[#0d79bf]" onClick={() => onOpen(row.id)} type="button">
                      {row.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[#172a3a]">{formatDobDisplay(row.dob)}</td>
                  <td className="px-4 py-3 text-[#172a3a]">{formatPhoneDisplay(row.phone)}</td>
                  <td className="px-4 py-3 text-center"><CountBubble n={row.active} tone="green" /></td>
                  <td className="px-4 py-3 text-center"><CountBubble n={row.submitted} tone="amber" /></td>
                  <td className="px-4 py-3 text-center"><CountBubble n={row.paid} tone="blue" /></td>
                  <td className="px-4 py-3 text-center font-semibold">{row.total}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-[#6b8496]" colSpan={7}>
                    No patients match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
  onAddTodo,
}: {
  folder: FolderDetail;
  onBack: () => void;
  onOpenCase: (caseId: string) => void;
  onNewCase: (draft: { attorney: string; dateOfInjury: string }) => void;
  onSavePerson: (next: { firstName: string; lastName: string; dob: string; phone: string; sex: string; maritalStatus: string; email: string; address: string }) => void;
  onAddNote: (text: string) => void;
  onAddTodo: (title: string, due: string) => void;
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
  const [todo, setTodo] = useState({ title: "", due: "" });
  const [addingCase, setAddingCase] = useState(false);
  const [caseDraft, setCaseDraft] = useState({ attorney: "", dateOfInjury: "" });
  const billed = folder.cases.reduce((sum, row) => sum + row.billed, 0);
  const paid = folder.cases.reduce((sum, row) => sum + row.paid, 0);
  const owed = billed - paid;
  const age = ageOn(folder.dob, "2026-11-11");
  return (
    <div className="space-y-4">
      <button className="text-sm font-semibold text-[#6b8496]" onClick={onBack} type="button">
        Patient List
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0d79bf] text-sm font-semibold text-white">{initials(folder.name)}</div>
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

      <section className="rounded-2xl border border-[#d5e4ef] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-[#172a3a]">Patient Info</h3>
          <p className="text-xs text-[#6b8496]">Shared by every case · change it here, and it updates everywhere</p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <label className={LABEL}>Last Name<input className={FIELD} value={person.lastName} onChange={(event) => setPerson({ ...person, lastName: event.target.value })} /></label>
          <label className={LABEL}>First Name<input className={FIELD} value={person.firstName} onChange={(event) => setPerson({ ...person, firstName: event.target.value })} /></label>
          <label className={LABEL}>DOB<input className={FIELD} value={person.dob} onChange={(event) => setPerson({ ...person, dob: event.target.value })} /></label>
          <label className={LABEL}>Phone<input className={FIELD} value={person.phone} onChange={(event) => setPerson({ ...person, phone: event.target.value })} /></label>
          <label className={LABEL}>Sex<input className={FIELD} value={person.sex} onChange={(event) => setPerson({ ...person, sex: event.target.value })} /></label>
          <label className={LABEL}>Marital Status<input className={FIELD} value={person.maritalStatus} onChange={(event) => setPerson({ ...person, maritalStatus: event.target.value })} /></label>
          <label className={`${LABEL} md:col-span-2`}>Email<input className={FIELD} value={person.email} onChange={(event) => setPerson({ ...person, email: event.target.value })} /></label>
          <label className={`${LABEL} md:col-span-2`}>Address<input className={FIELD} value={person.address} onChange={(event) => setPerson({ ...person, address: event.target.value })} /></label>
        </div>
      </section>

      {addingCase && (
        <form
          className="grid gap-3 rounded-2xl border border-dashed border-[#0d79bf] bg-white p-4 md:grid-cols-2"
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

      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Total billed" value={formatFolderMoney(billed)} tone="billed" />
        <Stat label="Total paid" value={formatFolderMoney(paid)} tone="paid" />
        <Stat label="Total owed" value={formatFolderMoney(owed)} tone="owed" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#d5e4ef] bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Alerts</h3>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-100 px-2 text-xs font-semibold text-rose-700">{folder.alerts.length}</span>
          </div>
          <ul className="divide-y divide-[#e6f0f6]">
            {folder.alerts.map((alert) => (
              <li className="flex items-center gap-2 py-2 text-sm" key={alert}>
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                {alert}
              </li>
            ))}
            {folder.alerts.length === 0 && <li className="py-2 text-sm text-[#6b8496]">No alerts.</li>}
          </ul>
        </section>
        <section className="rounded-2xl border border-[#d5e4ef] bg-white p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-semibold">General To-Dos</h3>
            <p className="text-xs text-[#6b8496]">Not tied to a case</p>
          </div>
          <ul className="divide-y divide-[#e6f0f6]">
            {folder.todos.map((item) => (
              <li className="flex items-center justify-between gap-3 py-2 text-sm" key={item.id}>
                <span>{item.title}</span>
                <span className="text-[#6b8496]">Due {item.due}</span>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!todo.title.trim()) return;
              onAddTodo(todo.title.trim(), todo.due.trim());
              setTodo({ title: "", due: "" });
            }}
          >
            <input className={`${FIELD} min-w-[12rem] flex-1`} placeholder="Add a to-do for this patient" value={todo.title} onChange={(event) => setTodo({ ...todo, title: event.target.value })} />
            <input className={`${FIELD} w-28`} placeholder="Due" value={todo.due} onChange={(event) => setTodo({ ...todo, due: event.target.value })} />
            <button className="rounded-full bg-[#e4f0f7] px-3 py-2 text-xs font-semibold" type="submit">Add</button>
          </form>
        </section>
      </div>

      <section className="rounded-2xl border border-[#d5e4ef] bg-white p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-semibold">General Notes</h3>
          <p className="text-xs text-[#6b8496]">Belongs to this patient, not to a case</p>
        </div>
        <ul className="divide-y divide-[#e6f0f6]">
          {folder.notes.map((entry) => (
            <li className="py-2" key={entry.id}>
              <p className="text-sm">
                <span className="font-semibold">{entry.date}</span>
                {entry.author && <span className="ml-2 font-semibold text-[#0d79bf]">{entry.author}</span>}
              </p>
              <p className="text-sm text-[#172a3a]">{entry.text}</p>
            </li>
          ))}
          {folder.notes.length === 0 && <li className="py-2 text-sm text-[#6b8496]">No general notes yet.</li>}
        </ul>
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!note.trim()) return;
            onAddNote(note.trim());
            setNote("");
          }}
        >
          <textarea
            className={`${FIELD} min-h-[72px]`}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Type a note and press Enter…"
            value={note}
          />
          <div className="mt-2 flex justify-end">
            <button className="rounded-full bg-[#0d79bf] px-3 py-1 text-xs font-semibold text-white disabled:opacity-40" disabled={!note.trim()} type="submit">
              Add note
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-[#d5e4ef] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h3 className="font-semibold">Cases</h3>
          <p className="text-xs text-[#6b8496]">Each case keeps its own Additional Details, billing, and notes</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#f4f9fc] text-xs font-semibold uppercase tracking-wide text-[#6b8496]">
              <tr>
                <th className="px-4 py-3">Case #</th>
                <th className="px-4 py-3">Date of injury</th>
                <th className="px-4 py-3">Attorney</th>
                <th className="px-4 py-3">Initial exam</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Billed</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Owed</th>
              </tr>
            </thead>
            <tbody>
              {folder.cases.map((row) => (
                <tr className="border-t border-[#e6f0f6]" key={row.id}>
                  <td className="px-4 py-3">
                    <button className="font-semibold text-[#0d79bf]" onClick={() => onOpenCase(row.id)} type="button">
                      {row.caseNumber}
                    </button>
                  </td>
                  <td className="px-4 py-3">{row.dateOfInjury}</td>
                  <td className="px-4 py-3">{row.attorney}</td>
                  <td className="px-4 py-3">{row.initialExam}</td>
                  <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                  <td className="px-4 py-3 text-right">{formatFolderMoney(row.billed)}</td>
                  <td className="px-4 py-3 text-right">{formatFolderMoney(row.paid)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${moneyTone("owed")}`}>{formatFolderMoney(row.owed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "billed" | "paid" | "owed" }) {
  return (
    <section className="rounded-2xl border border-[#d5e4ef] bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6b8496]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${moneyTone(tone)}`}>{value}</p>
    </section>
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
  person: { dob: string; phone: string; email: string; address: string };
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
        <button className="rounded-full border border-[#d5e4ef] bg-white px-4 py-2 text-sm font-semibold text-[#0d79bf]" onClick={onViewPatient} type="button">
          Edit on patient page
        </button>
      </section>

      <section className="rounded-2xl border border-[#d5e4ef] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Case Info</h3>
          <p className="text-xs text-[#6b8496]">This case only</p>
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
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Additional Details</h3>
          <p className="text-xs text-[#6b8496]">This case only</p>
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
        <section className="rounded-2xl border border-[#d5e4ef] bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Notes</h3>
            <p className="text-xs text-[#6b8496]">This case only</p>
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
        <section className="rounded-2xl border border-[#d5e4ef] bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Billing for this case</h3>
            <p className="text-xs text-[#6b8496]">Does not mix with other cases</p>
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
          <p className="mt-1 max-w-3xl text-sm text-[#6b8496]">
            Same as today&apos;s Patient List, one row per case. Clicking the name opens that case. Phone and address still come from the patient.
          </p>
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
