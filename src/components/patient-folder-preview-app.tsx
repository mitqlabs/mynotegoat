"use client";

import { useMemo, useState } from "react";
import {
  CaseListPreviewView,
  PatientFolderCaseView,
  PatientFolderListView,
  PatientFolderPageView,
  type CaseListEntry,
  type FolderCaseRow,
  type FolderDetail,
  type FolderListRow,
  type FolderNote,
  type FolderTodo,
} from "@/components/patient-folder-views";

type Screen =
  | { name: "list" }
  | { name: "patient"; id: string }
  | { name: "case"; id: string }
  | { name: "cases" };

const NAV = [
  "G.O.A.T. Page",
  "Patient List",
  "Case List",
  "Dashboard",
  "Contacts",
  "Schedule",
  "Encounters",
  "Key Dates",
  "My Files",
  "Billing",
  "Messages",
  "Settings",
];

function smithCases(): FolderCaseRow[] {
  return [
    {
      id: "case-1042",
      caseNumber: "#1042",
      fileNumber: "101426SMITHJOHN",
      dateOfInjury: "09/28/2026",
      initialExam: "10/02/2026",
      attorney: "Hart & Lowe Injury Law",
      attorneyPhone: "(818) 555-0100",
      location: "Glendale",
      status: "Active",
      review: "",
      lop: "Yes",
      priorCare: "No",
      discharge: "",
      billed: 8400,
      paid: 0,
      paidDate: "",
      owed: 8400,
      notes: [
        { id: "n1", date: "10/02/26", author: "Dr. Mike", text: "Initial exam completed. Cervical and lumbar complaints after MVA." },
        { id: "n2", date: "10/09/26", author: "Hannah M.", text: "Patient requested a copy of records for the attorney." },
      ],
    },
    {
      id: "case-0987",
      caseNumber: "#0987",
      dateOfInjury: "03/11/2025",
      initialExam: "03/15/2025",
      attorney: "Benson Legal Group",
      attorneyPhone: "(818) 555-0177",
      location: "Glendale",
      status: "Submitted",
      review: "Requested",
      lop: "Yes",
      priorCare: "No",
      discharge: "08/02/2025",
      billed: 12200,
      paid: 0,
      paidDate: "",
      owed: 12200,
      notes: [{ id: "n3", date: "08/02/25", author: "Dr. Mike", text: "Records sent to the attorney with the bill." }],
    },
    {
      id: "case-0731",
      caseNumber: "#0731",
      dateOfInjury: "06/04/2023",
      initialExam: "06/09/2023",
      attorney: "Hart & Lowe Injury Law",
      attorneyPhone: "(818) 555-0100",
      location: "Glendale",
      status: "Paid",
      review: "Received",
      lop: "Yes",
      priorCare: "No",
      discharge: "11/12/2023",
      billed: 9800,
      paid: 9800,
      paidDate: "02/18/2024",
      owed: 0,
      notes: [],
    },
    {
      id: "case-0455",
      caseNumber: "#0455",
      dateOfInjury: "01/19/2021",
      initialExam: "01/25/2021",
      attorney: "Pacific Accident Attorneys",
      attorneyPhone: "(213) 555-0144",
      location: "Glendale",
      status: "Paid",
      review: "Received",
      lop: "Yes",
      priorCare: "Yes",
      discharge: "06/01/2021",
      billed: 7150,
      paid: 7150,
      paidDate: "09/14/2021",
      owed: 0,
      notes: [],
    },
  ];
}

function startingFolder(): FolderDetail {
  return {
    id: "pf-smith",
    name: "Smith, John",
    dob: "03/14/1980",
    phone: "(818) 555-0142",
    sex: "Male",
    maritalStatus: "Married",
    email: "john.smith@example.com",
    address: "1234 Example Ave, Glendale, CA 91203",
    alerts: ["Allergic to latex", "Prefers Spanish paperwork"],
    todos: [
      { id: "t1", title: "Update insurance card on file", due: "10/22" },
      { id: "t2", title: "Call back about new address", due: "10/24" },
    ],
    notes: [
      { id: "g1", date: "10/02/26", author: "Dr. Mike", text: "Patient prefers afternoon appointments. This note is for the person, not one case." },
      { id: "g2", date: "10/09/26", author: "Hannah M.", text: "Updated mailing address. It applies to every case." },
    ],
    cases: smithCases(),
  };
}

const OTHER_ROWS: FolderListRow[] = [
  { id: "pf-alvarez", name: "Alvarez, Maria", dob: "11/02/1988", phone: "(323) 555-0199", active: 1, submitted: 0, paid: 0, total: 1 },
  { id: "pf-bennett", name: "Bennett, Laura", dob: "07/21/1992", phone: "(626) 555-0110", active: 0, submitted: 1, paid: 1, total: 2 },
  { id: "pf-chen", name: "Chen, David", dob: "01/09/1975", phone: "(818) 555-0187", active: 2, submitted: 0, paid: 1, total: 3 },
  { id: "pf-dawson", name: "Dawson, Kevin", dob: "05/30/1983", phone: "(213) 555-0163", active: 0, submitted: 0, paid: 3, total: 3 },
  { id: "pf-garcia", name: "Garcia, Elena", dob: "09/12/1990", phone: "(747) 555-0121", active: 1, submitted: 1, paid: 0, total: 2 },
  { id: "pf-kim", name: "Kim, Sarah", dob: "12/04/1986", phone: "(818) 555-0175", active: 1, submitted: 0, paid: 0, total: 1 },
  { id: "pf-patel", name: "Patel, Ravi", dob: "02/18/1981", phone: "(310) 555-0134", active: 0, submitted: 2, paid: 1, total: 3 },
  { id: "pf-rivera", name: "Rivera, Carlos", dob: "08/25/1972", phone: "(323) 555-0158", active: 1, submitted: 0, paid: 2, total: 3 },
  { id: "pf-thompson", name: "Thompson, Amy", dob: "04/07/1995", phone: "(626) 555-0190", active: 0, submitted: 0, paid: 1, total: 1 },
];

function counts(cases: FolderCaseRow[]) {
  return {
    active: cases.filter((row) => row.status === "Active").length,
    submitted: cases.filter((row) => row.status === "Submitted").length,
    paid: cases.filter((row) => row.status === "Paid").length,
    total: cases.length,
  };
}

export function PatientFolderPreviewApp({ initial = "list" }: { initial?: "list" | "patient" | "case" | "cases" }) {
  const [screen, setScreen] = useState<Screen>(
    initial === "patient" ? { name: "patient", id: "pf-smith" } : initial === "case" ? { name: "case", id: "case-1042" } : initial === "cases" ? { name: "cases" } : { name: "list" },
  );
  const [smith, setSmith] = useState<FolderDetail>(startingFolder);
  const [extras, setExtras] = useState<FolderDetail[]>([]);

  const listRows: FolderListRow[] = useMemo(() => {
    const smithCounts = counts(smith.cases);
    const created = extras.map((folder) => ({
      id: folder.id,
      name: folder.name,
      dob: folder.dob,
      phone: folder.phone,
      ...counts(folder.cases),
    }));
    return [
      { id: smith.id, name: smith.name, dob: smith.dob, phone: smith.phone, photo: smith.photo, ...smithCounts },
      ...OTHER_ROWS,
      ...created,
    ];
  }, [extras, smith]);

  const caseRows: CaseListEntry[] = useMemo(() => {
    const fromSmith: CaseListEntry[] = smith.cases.map((row) => ({
      id: row.id,
      folderId: smith.id,
      name: smith.name,
      dateOfInjury: row.dateOfInjury,
      initialExam: row.initialExam,
      attorney: row.attorney,
      status: row.status,
      caseNumber: row.caseNumber,
      phone: smith.phone,
      address: smith.address,
      kind: "pi",
    }));
    const samples: CaseListEntry[] = [
      { id: "case-1031", folderId: "pf-alvarez", name: "Alvarez, Maria", dateOfInjury: "08/30/2026", initialExam: "09/03/2026", attorney: "Benson Legal Group", status: "Active", caseNumber: "#1031", phone: "(323) 555-0199", address: "", kind: "pi" },
      { id: "case-1038", folderId: "pf-chen", name: "Chen, David", dateOfInjury: "09/15/2026", initialExam: "09/18/2026", attorney: "Pacific Accident Attorneys", status: "Active", caseNumber: "#1038", phone: "(818) 555-0187", address: "", kind: "pi" },
      { id: "case-1012", folderId: "pf-garcia", name: "Garcia, Elena", dateOfInjury: "07/02/2026", initialExam: "07/06/2026", attorney: "Hart & Lowe Injury Law", status: "Active", caseNumber: "#1012", phone: "(747) 555-0121", address: "", kind: "pi" },
      { id: "case-0995", folderId: "pf-patel", name: "Patel, Ravi", dateOfInjury: "11/20/2025", initialExam: "11/24/2025", attorney: "Benson Legal Group", status: "Submitted", caseNumber: "#0995", phone: "(310) 555-0134", address: "", kind: "pi" },
      { id: "case-0812", folderId: "pf-thompson", name: "Thompson, Amy", dateOfInjury: "02/10/2024", initialExam: "02/14/2024", attorney: "Benson Legal Group", status: "Paid", caseNumber: "#0812", phone: "(626) 555-0190", address: "", kind: "pi" },
      { id: "case-0990", folderId: "pf-rivera", name: "Rivera, Carlos", dateOfInjury: "05/08/2026", initialExam: "05/12/2026", attorney: "Pacific Accident Attorneys", status: "Active", caseNumber: "#0990", phone: "(323) 555-0158", address: "", kind: "pi" },
    ];
    const order = ["case-1042", "case-1031", "case-1038", "case-0987", "case-1012", "case-0995", "case-0731", "case-0812", "case-0455", "case-0990"];
    const all = [...fromSmith, ...samples];
    return all.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [smith]);

  const openFolder = (id: string) => {
    if (id === smith.id || extras.some((folder) => folder.id === id)) setScreen({ name: "patient", id });
  };

  const activeFolder = screen.name === "patient" ? (screen.id === smith.id ? smith : extras.find((folder) => folder.id === screen.id) ?? smith) : smith;
  const activeCase =
    [...smith.cases, ...extras.flatMap((folder) => folder.cases)].find((row) => row.id === (screen.name === "case" ? screen.id : "")) ??
    smith.cases[0];

  function updateFolder(id: string, change: (folder: FolderDetail) => FolderDetail) {
    if (id === smith.id) setSmith((current) => change(current));
    else setExtras((current) => current.map((folder) => (folder.id === id ? change(folder) : folder)));
  }

  const navActive = screen.name === "cases" ? "Case List" : screen.name === "list" ? "Patient List" : screen.name === "patient" ? "Patient List" : "Case List";

  return (
    <div className="flex min-h-screen bg-[#e7f2f8] text-[#172a3a]">
      <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col bg-[#0e2944] px-4 py-5 text-[#d7ebf8] md:flex">
        <div className="mb-6 rounded-2xl bg-[#163654] px-3 py-3 text-center text-lg font-semibold text-white">NoteGoat</div>
        <nav className="grid gap-1 text-sm font-semibold">
          {NAV.map((label) => {
            const active = label === navActive;
            return (
              <button
                className={`rounded-lg px-3 py-2 text-left ${active ? "bg-[#1d74c4] text-white" : "text-[#d7ebf8]"}`}
                key={label}
                onClick={() => {
                  if (label === "Patient List") setScreen({ name: "list" });
                  if (label === "Case List") setScreen({ name: "cases" });
                }}
                type="button"
              >
                {label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8">
        {screen.name === "list" && (
          <PatientFolderListView
            onCreate={(draft) => {
              const id = `pf-new-${Date.now()}`;
              const folder: FolderDetail = {
                id,
                name: `${draft.lastName.trim()}, ${draft.firstName.trim()}`,
                dob: draft.dob,
                phone: draft.phone,
                sex: "",
                maritalStatus: "",
                email: "",
                address: "",
                alerts: [],
                todos: [],
                notes: [],
                cases: draft.openCase
                  ? [
                      {
                        id: `case-new-${Date.now()}`,
                        caseNumber: "#new",
                        dateOfInjury: "",
                        initialExam: "",
                        attorney: "",
                        attorneyPhone: "",
                        location: "",
                        status: "Active",
                        review: "",
                        lop: "",
                        priorCare: "",
                        discharge: "",
                        billed: 0,
                        paid: 0,
                        paidDate: "",
                        owed: 0,
                        notes: [],
                      },
                    ]
                  : [],
              };
              setExtras((current) => [...current, folder]);
              setScreen({ name: "patient", id });
            }}
            onOpen={openFolder}
            rows={listRows}
          />
        )}
        {screen.name === "patient" && (
          <PatientFolderPageView
            key={activeFolder.id}
            folder={activeFolder}
            onAddNote={(text) => {
              const entry: FolderNote = { id: `gn-${Date.now()}`, date: "11/11/26", author: "Dr. Mike", text };
              updateFolder(activeFolder.id, (folder) => ({ ...folder, notes: [entry, ...folder.notes] }));
            }}
            onAddTodo={(title, due) => {
              const entry: FolderTodo = { id: `td-${Date.now()}`, title, due };
              updateFolder(activeFolder.id, (folder) => ({ ...folder, todos: [...folder.todos, entry] }));
            }}
            onBack={() => setScreen({ name: "list" })}
            onNewCase={(draft) => {
              const row: FolderCaseRow = {
                id: `case-new-${Date.now()}`,
                caseNumber: "#new",
                dateOfInjury: draft.dateOfInjury,
                initialExam: "",
                attorney: draft.attorney,
                attorneyPhone: "",
                location: "",
                status: "Active",
                review: "",
                lop: "",
                priorCare: "",
                discharge: "",
                billed: 0,
                paid: 0,
                paidDate: "",
                owed: 0,
                notes: [],
              };
              updateFolder(activeFolder.id, (folder) => ({ ...folder, cases: [row, ...folder.cases] }));
            }}
            onOpenCase={(caseId) => {
              if (smith.cases.some((row) => row.id === caseId) || activeFolder.cases.some((row) => row.id === caseId)) {
                setScreen({ name: "case", id: caseId });
              }
            }}
            onSavePhoto={(dataUrl) => {
              updateFolder(activeFolder.id, (folder) => ({ ...folder, photo: dataUrl }));
            }}
            onSavePerson={(next) => {
              updateFolder(activeFolder.id, (folder) => ({
                ...folder,
                name: `${next.lastName.trim()}, ${next.firstName.trim()}`,
                dob: next.dob,
                phone: next.phone,
                sex: next.sex,
                maritalStatus: next.maritalStatus,
                email: next.email,
                address: next.address,
              }));
            }}
          />
        )}
        {screen.name === "case" && (
          <PatientFolderCaseView
            key={activeCase.id}
            onBack={() => setScreen({ name: "cases" })}
            onViewPatient={() => setScreen({ name: "patient", id: smith.id })}
            patientName={smith.name}
            person={{ dob: smith.dob, phone: smith.phone, email: smith.email, address: smith.address, photo: smith.photo }}
            row={activeCase}
          />
        )}
        {screen.name === "cases" && (
          <CaseListPreviewView
            onOpen={(row) => {
              if (row.folderId === smith.id) setScreen({ name: "case", id: row.id });
            }}
            rows={caseRows}
          />
        )}
      </main>
    </div>
  );
}
