"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { patients as patientList, type PatientRecord } from "@/lib/mock-data";
import { askGoat, type GoatContext, type GoatResult } from "@/lib/goat";
import {
  choiceLabel,
  clearChat,
  displayName,
  findPatientsInQuestion,
  loadChat,
  saveChat,
  stripPatientName,
  type ChatMessage,
  type ChatChoice,
  type ChatPatient,
  type ChatState,
} from "@/lib/goat-ai/global-chat";
import { recFormatFromPrefs } from "@/lib/goat-answer-prefs";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { useGoatPatientContext } from "@/hooks/use-goat-patient-context";
import type { GoatFilesController } from "@/hooks/use-goat-files";
import { GoatAvatar } from "@/components/goat-avatar";
import { GoatStatusLine, type GoatStatus } from "@/components/goat-smart";
import { CopyButton } from "@/components/copy-button";
import { useGoatAnswerPrefs } from "@/hooks/use-goat-answer-prefs";
import { splitPatientQuestion, typedDateAnswer } from "@/lib/goat-split";
import { HOWTO_QUESTION, answerHowTo, dayLabel, isBookingRequest } from "@/lib/goat-howto";
import { PRACTICE_HELP, isPatientSpecific, isPracticeWide, yearOfDate, type PracticeData } from "@/lib/goat-practice";
import { buildInitialExamIndex, patientInitialExamIso } from "@/lib/initial-exam-date";
import { answerOffice, type OfficeMemory } from "@/lib/goat-office";
import { bookingRecord, draftSummary, finishDraft, planBooking, retime } from "@/lib/goat-booking";
import { loadScheduleSettings } from "@/lib/schedule-settings";
import { createAppointmentId, parseTimeFlexible } from "@/lib/schedule-appointments";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { to12hLabel } from "@/lib/time-12h";
import { LAST_SIGNER_KEY, appendNote, defaultSigner, formatNote, isAddNoteRequest, loadSigners, matchPatientsByName, parseAddNote, signatureFor, signerFromLogin, stripNameTokens, type NoteSigner } from "@/lib/goat-notes";
import { expandFollowUp } from "@/lib/goat-followup";
import { buildTeam, isTellRequest, matchRecipient, messageBody, parseTell } from "@/lib/goat-message";
import { patientsMentionedInMessage } from "@/lib/goat-message";
import { clarifyFor, editNoteLine, followUpFor, withNoteDate, withNoteText, type LastAct } from "@/lib/goat-memory";
import { isClearFileQuestion } from "@/lib/goat-dialog";
import { canonicalBooking, canonicalTell, clarifyForPatient, isAddNote, isBooking, isTell } from "@/lib/goat-commands";
import { emptyDialog, goatTurn, type DialogState } from "@/lib/goat-dialog";
import { activeFirst, isActiveCase } from "@/lib/patient-name-match";
import { useWorkspacePeople, type WorkspacePerson } from "@/hooks/use-workspace-people";
import { useWorkspaceMessages } from "@/hooks/use-workspace-messages";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { buildCaseNumber } from "@/lib/follow-up-queue";
import { getCaseNote, setCaseNote, STORAGE_KEY_CASE_NOTES } from "@/lib/case-notes";
import { notifyChange } from "@/lib/local-sync";
import { getCurrentMembershipSync } from "@/lib/workspace-membership";
import { loadTasks } from "@/lib/tasks";
import { loadScheduleAppointments } from "@/lib/schedule-appointments";
import { loadContactDirectory } from "@/lib/contact-directory";

// ---------------------------------------------------------------------------
// Open/closed, shared by the nav button and the popup.
// ---------------------------------------------------------------------------

let popupOpen = false;
const openListeners = new Set<() => void>();
export function setGlobalGoatOpen(open: boolean) {
  popupOpen = open;
  openListeners.forEach((l) => l());
}
function useGlobalGoatOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      openListeners.add(l);
      return () => {
        openListeners.delete(l);
      };
    },
    () => popupOpen,
    () => false,
  );
}

/** Sidebar / mobile-nav button. `compact` = icon only (collapsed sidebar). */
export function GlobalGoatButton({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const open = useGlobalGoatOpen();
  const { canView } = useWorkspaceAccess();
  if (!canView("patients")) return null;
  return (
    <button
      aria-expanded={open}
      className={className}
      onClick={() => setGlobalGoatOpen(!open)}
      title="Ask G.O.A.T."
      type="button"
    >
      <GoatAvatar size={compact ? 30 : 28} />
      {!compact && <span>G.O.A.T.</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Answers as chat text
// ---------------------------------------------------------------------------

function ruleAnswerToMessage(result: GoatResult): Pick<ChatMessage, "text" | "quotes" | "warnings" | "copy"> {
  const parts: string[] = [];
  for (const a of result.answers) {
    const lines = [...a.lines];
    for (const g of a.groups ?? []) {
      lines.push(g.lead);
      for (const b of g.blocks) {
        // Plain headings ("Cervical", "Alternatives") stay as written, like the copied text.
        if (b.heading) lines.push(b.plain ? `${lines.length ? "\n" : ""}${b.heading}` : `${b.heading}:`);
        lines.push(...b.items.map((i) => `- ${i}`));
      }
    }
    parts.push(`${a.title}\n${lines.join("\n")}${a.flag ? `\n(${a.flag})` : ""}`);
  }
  const quotes = (result.files?.matches ?? []).slice(0, 3).flatMap((m) =>
    m.lines.filter((l) => !l.heading).slice(0, 6).map((l) => ({ title: m.name, page: l.page, quote: l.text })),
  );
  if (!parts.length && quotes.length) parts.push(result.files?.title ? `${result.files.title}:` : "From the patient's files:");
  if (!parts.length && result.hits.length) parts.push(...result.hits.slice(0, 3).map((h) => `${h.kind} · ${h.title}: ${h.snippet}`));
  const copy = result.answers.find((a) => a.copyText)?.copyText;
  return {
    copy,
    text: parts.join("\n\n") || "I couldn't find that in this patient's file. I only read what's there and I won't guess.",
    quotes,
    warnings: result.files?.notes.length ? result.files.notes.slice(0, 2) : undefined,
  };
}

function livePatients(override?: PatientRecord[]): PatientRecord[] {
  return (override ?? patientList).filter((p) => !p.deleted);
}

function findPatient(override: PatientRecord[] | undefined, id: string | null): PatientRecord | null {
  return id ? livePatients(override).find((p) => p.id === id) ?? null : null;
}

const newId = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const nowIso = () => new Date().toISOString();

function toChatPatient(p: PatientRecord): ChatPatient {
  return { id: p.id, fullName: p.fullName, dob: p.dob, dateOfLoss: p.dateOfLoss, caseStatus: p.caseStatus };
}

// ---------------------------------------------------------------------------
// Loading one patient's data (only once a single patient is chosen)
// ---------------------------------------------------------------------------

interface Job {
  id: string;
  patientId: string;
  question: string;
  previous: { question: string; answer: string } | null;
}

interface AnswererProps {
  patient: PatientRecord;
  job: Job;
  onPartial: (text: string) => void;
  onDone: (msg: Pick<ChatMessage, "text" | "quotes" | "warnings" | "ms" | "copy">) => void;
}

function PatientAnswerer(props: AnswererProps) {
  const { context, files } = useGoatPatientContext(props.patient);
  return <Answerer {...props} context={context} files={files} />;
}

const NO_FILES: GoatFilesController = {
  enabled: false,
  files: [],
  counts: { total: 0, read: 0, waiting: 0, scanned: 0, failed: 0, other: 0 },
  reader: { running: false, done: 0, total: 0, current: null },
  readAll: () => undefined,
  stop: () => undefined,
  openFile: () => undefined,
};

function Answerer({ job, onDone, context, files }: AnswererProps & { context: GoatContext; files: GoatFilesController }) {
  const { prefs } = useGoatAnswerPrefs();
  const started = useRef<string | null>(null);
  const ctxRef = useRef<GoatContext>(context);
  const filesRef = useRef<GoatFilesController>(files);
  useEffect(() => {
    ctxRef.current = context;
    filesRef.current = files;
  });

  useEffect(() => {
    if (started.current === job.id) return;
    started.current = job.id;
    void (async () => {
      // Give the Patient Files reader a moment to pull already-extracted text (cache) before answering.
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, 400));
      while (filesRef.current.reader.running && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 300));
      const ctx = { ...ctxRef.current, recFormat: recFormatFromPrefs(prefs) };
      // "when was his XR and what were the findings?": answer each part, then one reply with every part.
      const parts = splitPatientQuestion(job.question);
      const answerPart = async (question: string): Promise<Omit<ChatMessage, "id" | "at" | "role"> & { ms?: number }> => {
        // "when was his PM appt" / "XR date": only that kind's dates, not every visit.
        const typed = typedDateAnswer(ctx, question);
        if (typed) return { text: typed, ms: 0 };
        const t1 = performance.now();
        return { ...ruleAnswerToMessage(askGoat(ctx, question)), ms: performance.now() - t1 };
      };
      if (parts.length < 2) {
        onDone(await answerPart(job.question));
        return;
      }
      const answers = [];
      for (const part of parts) {
        answers.push(await answerPart(part));
      }
      const label = (q: string) => q.replace(/\s*\((x-ray|MRI|pain management|orthopedic|neurology|CT)\)$/, "").replace(/^\w/, (c) => c.toUpperCase());
      onDone({
        // The same block (e.g. "Specialist referrals") is shown once, under the first part that has it.
        text: (() => {
          const seen = new Set<string>();
          return answers
            .map((a, i) => {
              const blocks = a.text.split(/\n\n+/).filter((b) => {
                const k = b.trim();
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
              });
              return `${label(parts[i])}?\n${blocks.join("\n\n") || "(see above)"}`;
            })
            .join("\n\n");
        })(),
        quotes: answers.flatMap((a) => a.quotes ?? []).slice(0, 6),
        warnings: answers.some((a) => a.warnings?.length) ? [...new Set(answers.flatMap((a) => a.warnings ?? []))].slice(0, 3) : undefined,
        copy: answers.map((a) => a.copy).filter(Boolean).join("\n\n") || undefined,
        ms: answers.reduce((n, a) => n + (a.ms ?? 0), 0),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per job; callbacks only touch refs / functional updates
  }, [job]);
  return null;
}

// ---------------------------------------------------------------------------
// The popup
// ---------------------------------------------------------------------------

export function GlobalGoatPopup({
  patientsOverride,
  practiceOverride,
  contextOverride,
}: {
  /** Test harness only: a fixed patient list and contexts instead of the workspace's. */
  patientsOverride?: PatientRecord[];
  /** Test harness only: office data instead of this browser's stores. */
  practiceOverride?: () => PracticeData;
  contextOverride?: (patientId: string) => GoatContext | null;
} = {}) {
  const open = useGlobalGoatOpen();
  const pathname = usePathname();
  const { canView } = useWorkspaceAccess();
  // Read once on the client; the popup only renders after a click, so there's no hydration mismatch.
  const [chat, setChat] = useState<ChatState>(() => loadChat());
  const [input, setInput] = useState("");
  const [job, setJobState] = useState<Job | null>(null);
  const jobRef = useRef<Job | null>(null);
  const setJob = useCallback((j: Job | null) => {
    jobRef.current = j;
    setJobState(j);
  }, []);
  const [partial, setPartial] = useState("");
  const practiceBusy = false;
  const { addAppointments, removeAppointment } = useScheduleAppointments();
  const [teamLogins, setTeamLogins] = useState<WorkspacePerson[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    saveChat(chat);
  }, [chat]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.messages.length, partial, open]);

  const dialogRef = useRef<DialogState>(emptyDialog());
  const openPatientId = useMemo(() => {
    const m = /^\/patients\/([^/?#]+)/.exec(pathname ?? "");
    return m ? decodeURIComponent(m[1]) : null;
  }, [pathname]);
  const allPatients = () => livePatients(patientsOverride);
  const patientById = (id: string | null) => findPatient(patientsOverride, id);
  const current = patientById(chat.patientId);

  const push = useCallback((m: Omit<ChatMessage, "id" | "at">, patientId?: string | null) => {
    setChat((c) => ({ messages: [...c.messages, { ...m, id: newId(), at: nowIso() }], patientId: patientId === undefined ? c.patientId : patientId }));
  }, []);

  const lastExchange = (patientId: string): { question: string; answer: string } | null => {
    const msgs = chat.messages;
    for (let i = msgs.length - 1; i > 0; i--) {
      if (msgs[i].role === "goat" && msgs[i].patientId === patientId && !msgs[i].choices && msgs[i - 1].role === "user") {
        return { question: msgs[i - 1].text, answer: msgs[i].text };
      }
    }
    return null;
  };

  const startAnswer = (patient: PatientRecord, question: string, followUp: boolean) => {
    const q = stripPatientName(question, patient.fullName) || question;
    setPartial("");
    setChat((c) => ({ ...c, patientId: patient.id }));
    setJob({ id: newId(), patientId: patient.id, question: q, previous: followUp && q.split(/\s+/).length < 7 ? lastExchange(patient.id) : null });
  };

  /** The question waiting for a patient (a "Which patient?" or "Did you mean" message), if the last G.O.A.T. message has one. */
  const waitingQuestion = (): string | null => {
    const last = [...chat.messages].reverse().find((m) => m.role === "goat");
    return last?.pendingQuestion ?? null;
  };

  const practiceData = (): PracticeData => {
    if (practiceOverride) return practiceOverride();
    const d = new Date();
    const appointments = loadScheduleAppointments();
    const index = buildInitialExamIndex(appointments);
    // Same year the Patients list files each patient under: Initial Exam box, else the
    // schedule's New Patient visit, else date of injury (so counts match its Status filter).
    const listYear = (p: PatientRecord) => yearOfDate(p.matrix?.initialExam?.trim() ? p.matrix.initialExam : patientInitialExamIso(p, index)) || yearOfDate(p.dateOfLoss);
    return {
      patients: allPatients().filter((p) => !(p as { deleted?: boolean }).deleted).map((p) => ({ ...p, listYear: listYear(p), cash: Boolean(p.isCashPatient) })),
      tasks: loadTasks(),
      appointments,
      contacts: loadContactDirectory(),
      today: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    };
  };

  /** The memory of the last office answer, for follow-ups ("and tomorrow?", "list them", "their fax?"). */
  const lastOffice = (): OfficeMemory | null => {
    const last = [...chat.messages].reverse().find((m) => m.role === "goat");
    return last?.office ?? null;
  };

  /** Office questions (to-do, schedule, cases, contacts, settings), rules only. True if handled. */
  const tryPractice = (question: string, confidentPatient: boolean): boolean => {
    const ans = answerOffice(question, practiceData(), lastOffice());
    if (!ans) return false;
    if (confidentPatient && !ans.memory?.contact && !ans.links) return false;
    push({ role: "user", text: question, practice: true });
    push({ role: "goat", text: ans.text, practice: true, links: ans.links, office: ans.memory, choices: ans.choices?.map((c) => ({ label: c.label, question: c.question })) });
    return true;
  };

  const scheduleSettings = () => practiceOverride ? undefined : loadScheduleSettings();

  /** "book kara tmrw at 3": a confirm card; nothing is saved until Confirm. */
  const startBooking = (question: string, patient: PatientRecord) => {
    const data = practiceData();
    const settings = scheduleSettings() ?? loadScheduleSettings();
    const step = planBooking({ question, patient: { id: patient.id, fullName: patient.fullName }, todayIso: data.today, appointments: data.appointments, settings, types: [...new Set(data.appointments.map((a) => a.appointmentType).filter(Boolean))] });
    const name = displayName(patient.fullName);
    if (step.kind === "needDay") {
      push({ role: "goat", text: `What day should I book ${name}? (e.g. "Thursday at 3" or "10/20 9:30am")`, patientName: name, bookingAsk: { patientId: patient.id, question } });
      return;
    }
    if (step.kind === "needTime") {
      push({ role: "goat", text: `What time on ${dayLabel(step.date)} for ${name}? (e.g. "3" or "9:30am")`, patientName: name, bookingAsk: { patientId: patient.id, question } });
      return;
    }
    push({ role: "goat", text: draftSummary(step.draft), patientName: name, booking: { ...step.draft, state: "open" } });
  };

  const updateBooking = (id: string, next: ChatMessage["booking"], text?: string) =>
    setChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? { ...m, booking: next, ...(text !== undefined ? { text } : {}) } : m)) }));

  /** Confirm: recheck the slot, then save through the Schedule's own save path. */
  const confirmBooking = (msg: ChatMessage, override = false) => {
    const b = msg.booking;
    if (!b || b.state !== "open") return;
    const data = practiceData();
    const settings = scheduleSettings() ?? loadScheduleSettings();
    const fresh = finishDraft({ ...b, override }, data.appointments, settings);
    if (!override && (fresh.taken || fresh.outsideHours)) {
      updateBooking(msg.id, { ...fresh, state: "open" }, draftSummary(fresh));
      return;
    }
    const record = bookingRecord({ ...fresh, override }, createAppointmentId(), data.appointments);
    addAppointments([record]);
    // "make it 2pm instead" after it was booked: the new time replaces the old appointment.
    if (b.replacesId) removeAppointment(b.replacesId);
    updateBooking(msg.id, { ...fresh, override, state: "booked", appointmentId: record.id, replacesId: b.replacesId });
    push({ role: "goat", text: `Booked ${b.patientName}: ${b.type}, ${dayLabel(b.date)} at ${to12hLabel(b.time)}.`, practice: true, links: [{ label: `Open Schedule (${dayLabel(b.date)})`, href: `/appointments?date=${b.date}` }] });
  };

  /** Confirm: append the signed line to the patient's Notes (the same store the Notes box uses). */
  const saveNote = (msg: ChatMessage, line: string) => {
    const d = msg.noteDraft;
    if (!d || d.state !== "open") return;
    const p = patientById(d.patientId);
    const existing = getCaseNote(d.patientId) ?? p?.matrix?.notes ?? "";
    setCaseNote(d.patientId, appendNote(existing, line));
    notifyChange(STORAGE_KEY_CASE_NOTES);
    setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === msg.id ? { ...x, noteDraft: { ...d, state: "saved", saved: line } } : x)) }));
  };

  const pickTime = (msg: ChatMessage, time: string) => {
    const b = msg.booking;
    if (!b) return;
    const settings = scheduleSettings() ?? loadScheduleSettings();
    const next = finishDraft({ ...b, time, notes: [], override: false }, practiceData().appointments, settings);
    updateBooking(msg.id, { ...next, state: "open" }, draftSummary(next));
  };

  /** The last thing G.O.A.T. did or is waiting on, for follow-ups ("change the date to yesterday", "send it to Greg instead"). */
  const lastAct = (): LastAct | null => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      if (m.role !== "goat") continue;
      if (m.noteEdit) {
        if (m.noteEdit.state === "done" && m.noteEdit.newLine) return { kind: "note", msgId: m.id, patientId: m.noteEdit.patientId, patientName: m.noteEdit.patientName, line: m.noteEdit.newLine };
        if (m.noteEdit.state === "done") return null;
        continue;
      }
      if (m.noteDraft) return m.noteDraft.state === "saved" && m.noteDraft.saved ? { kind: "note", msgId: m.id, patientId: m.noteDraft.patientId, patientName: m.noteDraft.patientName, line: m.noteDraft.saved } : null;
      if (m.msgAsk) return { kind: "msgAsk", msgId: m.id, ...m.msgAsk };
      if (m.msgDraft) return { kind: "message", msgId: m.id, toLabel: m.msgDraft.toLabel, toUserId: m.msgDraft.toUserId, text: m.msgDraft.text, patientId: m.msgDraft.patientId, patientName: m.msgDraft.patientName, caseLabel: m.msgDraft.caseLabel, state: m.msgDraft.state };
      if (m.booking) return { kind: "booking", msgId: m.id, state: m.booking.state };
    }
    return null;
  };

  /** Act on a follow-up to the last action. True if handled. */
  const tryFollowUp = (question: string): boolean => {
    const last = lastAct();
    const f = followUpFor(question, last, practiceData().today);
    if (!f || !last) return false;
    push({ role: "user", text: question, practice: true });
    if (last.kind === "note") {
      const edit = (newLine: string | null, say: string) => push({ role: "goat", text: say, practice: true, noteEdit: { patientId: last.patientId, patientName: last.patientName, oldLine: last.line, newLine, state: "open" } });
      if (f.kind === "noteDate") edit(withNoteDate(last.line, f.iso), `Change the date on the note I just added for ${displayName(last.patientName)}?`);
      else if (f.kind === "noteReplace") edit(withNoteText(last.line, f.text), `Change the note I just added for ${displayName(last.patientName)} to this?`);
      else if (f.kind === "noteDelete") edit(null, `Remove the note I just added for ${displayName(last.patientName)}?`);
      else if (f.kind === "noteAppend") push({ role: "goat", text: "Add this to the Notes in the patient file?", patientName: displayName(last.patientName), noteDraft: { patientId: last.patientId, patientName: last.patientName, text: f.text, state: "open" } });
      else if (f.kind === "clarify") push({ role: "goat", text: f.say, practice: true, choices: f.choice ? [f.choice] : undefined });
      return true;
    }
    if (last.kind === "msgAsk" && f.kind === "generalMessage") {
      setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === last.msgId ? { ...x, msgAsk: undefined } : x)) }));
      push({ role: "goat", text: "Send this message? (general, no patient)", msgDraft: { toLabel: last.toLabel, toUserId: last.toUserId, text: last.text, state: "open" } });
      return true;
    }
    if (last.kind === "message" && f.kind === "messageTo") {
      const to = matchRecipient(f.to, buildTeam(loadSigners(), teamLogins));
      if (!to.length) {
        push({ role: "goat", text: `I couldn't find a team member named "${f.to}".`, practice: true });
        return true;
      }
      if (f.mode === "instead" && last.state === "open") setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === last.msgId && x.msgDraft ? { ...x, msgDraft: { ...x.msgDraft, state: "canceled" } } : x)) }));
      const note = f.mode === "instead" && last.state === "sent" ? ` (The one to ${last.toLabel} was already sent.)` : "";
      push({ role: "goat", text: `Send this to ${to[0].label}?${note}`, msgDraft: { toLabel: to[0].label, toUserId: to[0].userId, text: last.text, patientId: last.patientId, patientName: last.patientName, caseLabel: last.caseLabel, state: "open" } });
      return true;
    }
    if (last.kind === "booking" && f.kind === "bookingTime") {
      const prev = chat.messages.find((x) => x.id === last.msgId)?.booking;
      if (!prev) return false;
      const next = retime(prev, f.time, practiceData().appointments.filter((a) => a.id !== prev.appointmentId), scheduleSettings() ?? loadScheduleSettings());
      if (!next) {
        push({ role: "goat", text: `What time? (e.g. "2pm" or "9:30am")`, practice: true });
        return true;
      }
      if (prev.state === "open") updateBooking(last.msgId, { ...prev, state: "canceled" });
      const replacesId = prev.state === "booked" ? prev.appointmentId : undefined;
      push({ role: "goat", text: `${draftSummary(next)}${replacesId ? "\nThis moves the visit I just booked." : ""}`, patientName: displayName(next.patientName), booking: { ...next, state: "open", replacesId } });
      return true;
    }
    return false;
  };

  /** Confirm a change to the note G.O.A.T. just added: edit that exact line in Case Notes. */
  const applyNoteEdit = (msg: ChatMessage) => {
    const e = msg.noteEdit;
    if (!e || e.state !== "open") return;
    const p = patientById(e.patientId);
    const existing = getCaseNote(e.patientId) ?? p?.matrix?.notes ?? "";
    const next = editNoteLine(existing, e.oldLine, e.newLine);
    if (next !== null) {
      setCaseNote(e.patientId, next);
      notifyChange(STORAGE_KEY_CASE_NOTES);
    }
    setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === msg.id ? { ...x, noteEdit: { ...e, state: next === null ? "missing" : "done" } } : x)) }));
  };

  const send = (raw: string) => {
    const question = raw.trim();
    if (!question || job || practiceBusy) return;
    setInput("");
    const people = allPatients().map(toChatPatient);
    const found = findPatientsInQuestion(question, people);
    const waitingForName = waitingQuestion();
    // Follow-ups to what G.O.A.T. just did (note / message / booking) come first.
    if (tryFollowUp(question)) return;
    // Casual-language turn (goat-dialog): add-note across turns, "him/her/that
    // one", "no, the other John", and a clarifying question for a statement that
    // names a patient — never "couldn't find that in this patient's file".
    {
      const team = buildTeam(loadSigners(), teamLogins);
      const turn = goatTurn(question, dialogRef.current, {
        data: practiceData(),
        team,
        openPatientId: current?.id ?? openPatientId ?? null,
        settings: scheduleSettings() ?? loadScheduleSettings(),
      });
      const r = turn.reply;
      const wasPendingNote = Boolean(dialogRef.current.pendingNote);
      dialogRef.current = turn.state;
      const noteFlow = wasPendingNote || Boolean(turn.state.pendingNote) || isAddNote(question);
      const pp = (id: string | null | undefined) => patientById(id ?? null);
      if (r.kind === "noteConfirm") {
        const p = pp(r.patientId);
        if (p) {
          push({ role: "user", text: question, practice: true });
          setChat((c) => ({ ...c, patientId: p.id }));
          push({ role: "goat", text: "Add this to the Notes in the patient file?", patientName: displayName(p.fullName), noteDraft: { patientId: p.id, patientName: p.fullName, text: stripNameTokens(r.text, p.fullName) || r.text, state: "open" } });
          return;
        }
      }
      if ((r.kind === "ask" && noteFlow) || (r.kind === "choose" && noteFlow)) {
        push({ role: "user", text: question, practice: true });
        const ids = r.kind === "choose" ? r.patientIds : [];
        push({ role: "goat", text: r.say, practice: true, choices: ids.map((id) => pp(id)).filter((p): p is PatientRecord => Boolean(p)).map((p) => ({ label: choiceLabel(toChatPatient(p)), question: p.fullName })) });
        return;
      }
      if (r.kind === "clarify" || r.kind === "unsupported") {
        push({ role: "user", text: question, practice: true });
        const p = pp(r.patientId);
        const opts = r.kind === "clarify" && p ? clarifyForPatient(p.fullName, question.replace(new RegExp(p.fullName.split(" ")[0], "i"), "").replace(new RegExp(p.fullName.split(" ").slice(1).join(" ") || "^$", "i"), "").trim()).options : [];
        push({
          role: "goat",
          text: r.say,
          practice: true,
          choices: opts.length ? opts : undefined,
          links: r.kind === "unsupported" ? [{ label: "Open Schedule", href: "/appointments" }] : undefined,
        });
        return;
      }
      // Pronoun / correction follow-ups the rest of send() can't resolve on its own.
      const viaContext = !findPatientsInQuestion(question, people).named;
      if (viaContext && r.kind === "fileQuestion") {
        const p = pp(r.patientId);
        if (p) {
          push({ role: "user", text: question });
          startAnswer(p, r.topic === "bill" ? "what is the balance" : question, false);
          return;
        }
      }
      if (viaContext && r.kind === "booking") {
        const p = pp(r.patientId);
        if (p) {
          push({ role: "user", text: question, practice: true });
          startBooking(canonicalBooking(question), p);
          return;
        }
      }
    }
    // Casual message wording ("send greg a message…", "let hannah know…") → the "tell" form.
    if (!isTellRequest(question) && isTell(question)) return send(canonicalTell(question));
    if (!isBookingRequest(question) && isBooking(question) && canonicalBooking(question) !== question) return send(canonicalBooking(question));
    // "add note to kara's file: spoke to atty" → preview; saved only on Confirm.
    if (isAddNoteRequest(question) || isAddNote(question)) {
      push({ role: "user", text: question, practice: true });
      const req = parseAddNote(question);
      if (!req) {
        push({ role: "goat", text: 'Tell me the patient and the note, like: "add note to Kara\'s file: spoke to atty, waiting for reduction."' });
        return;
      }
      const all = matchPatientsByName(req.name, allPatients().filter((p) => !(p as { deleted?: boolean }).deleted));
      const split = activeFirst(all, (p) => isActiveCase(p.caseStatus));
      const hits = split.shown;
      if (!hits.length) {
        push({ role: "goat", text: `I couldn't find a patient named "${req.name}". Check the name and try again.` });
        return;
      }
      if (hits.length > 1) {
        const ch = (p: PatientRecord) => ({ label: choiceLabel(toChatPatient(p)), question: `add note to ${p.fullName}: ${req.text}` });
        push({ role: "goat", text: `Which ${req.name}?`, ...withInactive(hits.map(ch), split.hidden.map(ch)) });
        return;
      }
      const p = hits[0];
      setChat((c) => ({ ...c, patientId: p.id }));
      push({ role: "goat", text: "Add this to the Notes in the patient file?", patientName: displayName(p.fullName), noteDraft: { patientId: p.id, patientName: p.fullName, text: stripNameTokens(req.text, p.fullName) || req.text, state: "open" } });
      return;
    }
    // "tell hanna i need notes for John" → a team message about John's case; posted only on Confirm.
    if (isTellRequest(question)) {
      const req = parseTell(question);
      if (req) {
        push({ role: "user", text: question, practice: true });
        const team = buildTeam(loadSigners(), teamLogins);
        const to = matchRecipient(req.to, team);
        if (!to.length) {
          push({ role: "goat", text: `I couldn't find a team member named "${req.to}". Add them under Note signatures in G.O.A.T. Settings (link their login so they get notified).`, links: [{ label: "G.O.A.T. Settings", href: "/settings/goat" }] });
          return;
        }
        const recipient = to[0];
        const pool = allPatients().filter((p) => !(p as { deleted?: boolean }).deleted).map(toChatPatient);
        // No "about <name>": only a real name in the text points at a patient (strict
        // match, common words like "testing"/"hey" never do). No name → a general
        // team message (no patient), like the Messages page's own composer.
        const mentioned = req.patientName ? [] : patientsMentionedInMessage(req.text, pool);
        const asCand = (p: ChatPatient) => ({ patient: p, score: 1, words: [] as string[] });
        const lookup = req.patientName
          ? findPatientsInQuestion(`about ${req.patientName} `, pool)
          : { confident: mentioned.length === 1 ? asCand(mentioned[0]) : null, candidates: mentioned.length > 1 ? mentioned.map(asCand) : [], inactive: [] as ReturnType<typeof asCand>[] };
        if (!lookup.confident && lookup.candidates.length) {
          const swap = (full: string) => {
            const t = req.text.replace(/[.?!]+$/, "");
            const n = req.patientName ?? "";
            return n && t.toLowerCase().endsWith(n.toLowerCase()) ? `${t.slice(0, t.length - n.length)}${full}` : `${t} about ${full}`;
          };
          const ch = (c: { patient: ChatPatient }) => ({ label: choiceLabel(c.patient), question: `tell ${req.to} ${swap(displayName(c.patient.fullName))}` });
          push({ role: "goat", text: "Which patient is this about? (Or say \"no patient\" to send it as a general message.)", msgAsk: { toLabel: recipient.label, toUserId: recipient.userId, text: req.text }, ...withInactive(lookup.candidates.map(ch), lookup.inactive.map(ch)) });
          return;
        }
        if (!lookup.confident && req.patientName) {
          push({ role: "goat", text: `I couldn't find a patient named "${req.patientName}". Check the name and try again.` });
          return;
        }
        const pt = lookup.confident?.patient ?? null;
        const caseNo = pt ? buildCaseNumber(pt.dateOfLoss, pt.fullName) : "";
        push({
          role: "goat",
          text: "Send this message?",
          msgDraft: { toLabel: recipient.label, toUserId: recipient.userId, text: req.text, patientId: pt?.id, patientName: pt?.fullName, caseLabel: pt ? (caseNo ? `${caseNo} ${pt.fullName}` : pt.fullName) : undefined, state: "open" },
        });
        return;
      }
    }
    // "How do I…" answers come only from NoteGoat's page/button and Settings
    // catalogs (never the model's guess); unknown ones say "I'm not sure".
    const lastG = [...chat.messages].reverse().find((m) => m.role === "goat");
    // Reply to "what time?" / "what day?" for a booking.
    if (lastG?.bookingAsk) {
      const p = patientById(lastG.bookingAsk.patientId);
      if (p && !isBookingRequest(question) && question.split(/\s+/).length <= 6) {
        push({ role: "user", text: question, practice: true });
        startBooking(`${lastG.bookingAsk.question} ${question}`, p);
        return;
      }
    }
    // A new time typed while a booking card is open ("4:15", "4p", "different time 2pm").
    if (lastG?.booking?.state === "open" && question.split(/\s+/).length <= 4) {
      const next = retime(lastG.booking, question.replace(/^(different time|instead|how about|make it|change( it)? to)\s*/i, ""), practiceData().appointments, scheduleSettings() ?? loadScheduleSettings());
      if (next) {
        push({ role: "user", text: question, practice: true });
        updateBooking(lastG.id, { ...lastG.booking, state: "canceled" });
        push({ role: "goat", text: draftSummary(next), patientName: displayName(next.patientName), booking: { ...next, state: "open" } });
        return;
      }
    }
    // "How do I…" answers come only from NoteGoat's page/button and Settings catalogs; unknown ones say "I'm not sure".
    const how = HOWTO_QUESTION.test(question) && !waitingForName ? answerHowTo(question) : null;
    if (how && (how.found || !found.confident)) {
      push({ role: "user", text: question, practice: true });
      push({ role: "goat", text: how.text, practice: true, links: how.links });
      return;
    }
    // Booking ("book kara tmrw at 3"): a confirm card, never the next-visit answer.
    if (isBookingRequest(question)) {
      push({ role: "user", text: question, practice: true });
      if (found.confident) {
        const p = patientById(found.confident.patient.id);
        if (p) return startBooking(question, p);
      }
      if (found.candidates.length) {
        push({ role: "goat", text: "Book which patient?", choices: [...found.candidates, ...found.inactive].map((c) => ({ label: choiceLabel(c.patient), question: `book ${c.patient.fullName} ${stripPatientName(question, found.named ?? "").replace(/^(please\s+)?(book|schedule)\b/i, "")}`.replace(/\s+/g, " ").trim() })) });
        return;
      }
      const p = found.named ? null : current ?? patientById(openPatientId);
      if (p) return startBooking(question, p);
      push({ role: "goat", text: found.named ? `I couldn't find a patient named "${found.named}". Who should I book?` : "Who should I book? Type their name, the day and the time." });
      return;
    }
    if (!(waitingForName && found.named) && tryPractice(question, Boolean(found.confident))) return;
    push({ role: "user", text: question });
    // A reply that is only a name ("Jane Sample") answers the question that was waiting for a patient.
    const waiting = waitingQuestion();
    const justAName = waiting && found.named && question.split(/\s+/).length <= 4;
    const original = justAName ? waiting : question;
    if (found.confident) {
      const p = patientById(found.confident.patient.id);
      if (p) startAnswer(p, original, p.id === chat.patientId && !justAName);
      return;
    }
    if (found.candidates.length) {
      push({
        role: "goat",
        text: "Did you mean:",
        ...withInactive(
          found.candidates.map((c) => ({ patientId: c.patient.id, label: choiceLabel(c.patient) })),
          found.inactive.map((c) => ({ patientId: c.patient.id, label: choiceLabel(c.patient) })),
        ),
        pendingQuestion: original,
      });
      return;
    }
    if (found.named) {
      push({ role: "goat", text: `I couldn't find a patient named "${found.named}" in the patient list. Type their name and I'll answer "${original}".`, pendingQuestion: original });
      return;
    }
    // Practice-wide wording ("how many…", "do we have", "our…") is never answered from the open patient's file.
    if (isPracticeWide(question)) {
      push({ role: "goat", text: PRACTICE_HELP, practice: true });
      return;
    }
    // No name: stay on the chat's patient (or the last one mentioned), else the patient page that's open.
    const lastMentioned = [...chat.messages].reverse().find((m) => m.patientId)?.patientId ?? null;
    const p = current ?? patientById(lastMentioned) ?? patientById(openPatientId);
    // "and the MRI?" after "when was her x-ray?" → "when was her MRI?"
    if (p) {
      const prev = lastExchange(p.id);
      const expanded = expandFollowUp(question, prev?.question ?? null);
      if (expanded) {
        startAnswer(p, expanded, false);
        return;
      }
    }
    if (!p) {
      // Only ask "which patient" when the question is clearly about one; otherwise say what G.O.A.T. can answer.
      if (isPatientSpecific(question)) push({ role: "goat", text: "Which patient is this about? Type their name and I'll answer it.", pendingQuestion: question });
      else push({ role: "goat", text: PRACTICE_HELP, practice: true });
      return;
    }
    // Not clearly about the file: never "I couldn't find that in this patient's file".
    if (!isClearFileQuestion(question)) {
      push({ role: "goat", text: clarifyFor(lastAct()), practice: true });
      return;
    }
    startAnswer(p, question, Boolean(current));
  };

  // A tapped patient answers the ORIGINAL question; nothing needs retyping.
  const pick = (msg: ChatMessage, patientId: string | undefined, question?: string, showMore?: boolean) => {
    if (showMore) {
      setChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === msg.id ? { ...m, choices: [...(m.choices ?? []).filter((x) => !x.showMore), ...(m.moreChoices ?? [])], moreChoices: undefined } : m)) }));
      return;
    }
    // The chips stay inside the "Did you mean" bubble with the pick highlighted
    // (no separate message for the pick).
    const label = msg.choices?.find((c) => (patientId ? c.patientId === patientId : c.question === question))?.label;
    if (question) {
      setChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === msg.id ? { ...m, picked: label ?? question } : m)) }));
      send(question);
      return;
    }
    const p = patientById(patientId ?? null);
    if (!p || job) return;
    setChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === msg.id ? { ...m, picked: label ?? displayName(p.fullName), pendingQuestion: undefined } : m)) }));
    startAnswer(p, msg.pendingQuestion ?? "", false);
  };

  // Plain functions: they only touch refs and functional state updates, so a stale copy is fine.
  const onPartial = (t: string) => setPartial(t);
  const onDone = (m: Pick<ChatMessage, "text" | "quotes" | "warnings" | "ms" | "copy">) => {
    const j = jobRef.current;
    if (j) {
      const p = findPatient(patientsOverride, j.patientId);
      push({ role: "goat", ...m, patientId: j.patientId, patientName: p ? displayName(p.fullName) : undefined }, j.patientId);
    }
    jobRef.current = null;
    setJob(null);
    setPartial("");
  };

  const jobPatient = job ? patientById(job.patientId) : null;

  const lastGoat = [...chat.messages].reverse().find((m) => m.role === "goat");
  const status: GoatStatus = job || practiceBusy
    ? "searching"
    : !lastGoat || (lastGoat.choices && !lastGoat.picked) || lastGoat.pendingQuestion
      ? "ready"
      : /^I couldn't find/.test(lastGoat.text) || lastGoat.text === PRACTICE_HELP
        ? "notFound"
        : "found";

  if (!canView("patients")) return null;
  return (
    <>
      {jobPatient && job && (contextOverride ? (
        <Answerer context={contextOverride(jobPatient.id)!} files={NO_FILES} job={job} onDone={onDone} onPartial={onPartial} patient={jobPatient} />
      ) : (
        <PatientAnswerer job={job} onDone={onDone} onPartial={onPartial} patient={jobPatient} />
      ))}
      {open && <PeopleLoader onPeople={setTeamLogins} />}
      {open && (
        <section
          aria-label="G.O.A.T. chat"
          className="fixed inset-x-2 bottom-2 z-[60] flex h-[78vh] flex-col overflow-hidden rounded-2xl border border-[var(--line-soft)] bg-white shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:h-[560px] sm:max-h-[calc(100vh-2rem)] sm:w-[400px]"
          data-goat-section="global-goat"
        >
          <header className="flex items-center gap-2.5 bg-[#72bdcf] px-3 py-2 text-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="G.O.A.T." className="h-11 w-11 shrink-0 rounded-full bg-white/80 object-cover" height={44} src="/goat-avatar/tablet-128.png" srcSet="/goat-avatar/tablet-128.png 1x, /goat-avatar/tablet-256.png 2x" width={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-lg font-semibold leading-tight">
                G.O.A.T. <GoatStatusLine className="font-medium text-white/95" status={status} />
              </div>
              <div className="truncate text-xs text-white/90">
                {current ? (
                  <>
                    On: <strong>{displayName(current.fullName)}</strong>{" "}
                    <button className="underline hover:no-underline" onClick={() => setChat((c) => ({ ...c, patientId: null }))} type="button">
                      Switch patient
                    </button>
                  </>
                ) : (
                  "Ask about any patient by name"
                )}
              </div>
            </div>
            <button style={{ fontSize: 12 }}
              className="rounded-lg px-2 py-1 text-xs font-semibold hover:bg-white/20 disabled:opacity-40"
              disabled={!chat.messages.length || Boolean(job)}
              onClick={() => {
                if (window.confirm("Clear this G.O.A.T. chat? It's only saved on this computer and can't be brought back.")) {
                  clearChat();
                  setChat({ messages: [], patientId: null });
                }
              }}
              type="button"
            >
              Clear chat
            </button>
            <button aria-label="Close G.O.A.T." className="rounded-lg px-2 py-0.5 text-xl leading-none hover:bg-white/20" onClick={() => setGlobalGoatOpen(false)} type="button">
              ×
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto bg-[var(--bg-soft,#f6f9fa)] px-3 py-3">
            {!chat.messages.length && (
              <div className="flex gap-2">
                <GoatAvatar size={28} />
                <p className="rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-sm">
                  Hi! Ask me anything about a patient.
                  <span className="mt-0.5 block text-xs text-[var(--text-muted)]">Everything stays in NoteGoat.</span>
                </p>
              </div>
            )}
            {chat.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-tr-sm bg-[var(--brand-primary)] px-3 py-2 text-sm text-white">{m.text}</p>
                </div>
              ) : (
                <div key={m.id} className="flex gap-2">
                  <GoatAvatar size={28} />
                  <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-sm">
                    {m.patientName && <div className="mb-0.5 text-[11px] font-semibold text-[#2f7f93]">{m.patientName}</div>}
                    <div className="whitespace-pre-line leading-snug">{m.text}</div>
                    {m.links?.map((l) => (
                      <Link key={l.href} className="mt-1 block font-semibold text-[var(--brand-primary)] hover:underline" href={l.href} style={{ fontSize: 13 }}>
                        {l.label} ↗
                      </Link>
                    ))}
                    {m.msgDraft && <MessageCard draft={m.msgDraft} onCancel={() => setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, msgDraft: { ...x.msgDraft!, state: "canceled" } } : x)) }))} onSent={(body) => setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, msgDraft: { ...x.msgDraft!, state: "sent", sent: body } } : x)) }))} />}
                    {m.noteEdit && <NoteEditCard edit={m.noteEdit} onCancel={() => setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, noteEdit: { ...x.noteEdit!, state: "canceled" } } : x)) }))} onConfirm={() => applyNoteEdit(m)} />}
                    {m.noteDraft && <NoteCard draft={m.noteDraft} busy={Boolean(job)} onCancel={() => setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, noteDraft: { ...x.noteDraft!, state: "canceled" } } : x)) }))} onSave={(line) => saveNote(m, line)} />}
                    {m.booking && <BookingCard booking={m.booking} busy={Boolean(job) || practiceBusy} onCancel={() => updateBooking(m.id, { ...m.booking!, state: "canceled" })} onConfirm={(o) => confirmBooking(m, o)} onTime={(t) => pickTime(m, t)} />}
                    {m.choices && m.choices.length > 0 && (
                      <div className="mt-2 space-y-1.5" data-goat-choices>
                        {m.choices.map((c) => (
                          <button style={{ fontSize: 12 }}
                            key={c.patientId ?? c.label}
                            aria-pressed={m.picked === c.label}
                            className={`block w-full rounded-xl border px-2.5 py-1.5 text-left text-xs font-semibold ${
                              m.picked === c.label
                                ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                                : m.picked
                                  ? "border-[var(--line-soft)] bg-white text-[var(--text-muted)] opacity-60"
                                  : "border-[#72bdcf] bg-[#eef8fb] hover:bg-[#dff1f6] disabled:opacity-50"
                            }`}
                            disabled={Boolean(job) || practiceBusy || Boolean(m.picked)}
                            onClick={() => pick(m, c.patientId, c.question, c.showMore)}
                            type="button"
                          >
                            {m.picked === c.label ? "✓ " : ""}
                            {c.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {m.warnings?.map((w, i) => (
                      <p key={i} className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                        {w}
                      </p>
                    ))}
                    {m.quotes && m.quotes.length > 0 && (
                      <div className="mt-1.5 text-xs text-[var(--text-muted)]">
                        Source{new Set(m.quotes.map((q) => q.title)).size > 1 ? "s" : ""}:{" "}
                        <span className="font-semibold">
                          {[...new Map(m.quotes.map((q) => [q.title, q])).values()]
                            .map((q) => `${q.title.replace(/\s*\(patient page.*$/, " (patient page)")}${q.page ? ` · p.${q.page}` : ""}`)
                            .join(", ")}
                        </span>
                      </div>
                    )}
                    {m.patientId && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                        <span className="flex items-center gap-2">
                          Basic lookup
                          {m.copy && <CopyButton text={m.copy} />}
                        </span>
                        <Link className="font-semibold text-[var(--brand-primary)] hover:underline" href={`/patients/${encodeURIComponent(m.patientId)}`} target="_blank">
                          Open patient file ↗
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
            {(job || practiceBusy) && (
              <div className="flex gap-2">
                <GoatAvatar size={28} />
                <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-sm">
                  {jobPatient && <div className="mb-0.5 text-[11px] font-semibold text-[#2f7f93]">{displayName(jobPatient.fullName)}</div>}
                  {partial ? (
                    <div className="whitespace-pre-line leading-snug">
                      {partial}
                    </div>
                  ) : (
                    <span className="text-[var(--text-muted)]">
                      Searching…
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--line-soft)] bg-white px-3 pb-2 pt-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                aria-label="Ask G.O.A.T."
                className="min-w-0 flex-1 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about a patient…"
                value={input}
              />
              <button style={{ fontSize: 14 }} className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={!input.trim() || Boolean(job) || practiceBusy} type="submit">
                Ask
              </button>
            </form>
          </div>
        </section>
      )}
    </>
  );
}

function BookingCard({ booking, busy, onConfirm, onTime, onCancel }: { booking: NonNullable<ChatMessage["booking"]>; busy: boolean; onConfirm: (override: boolean) => void; onTime: (time: string) => void; onCancel: () => void }) {
  const [other, setOther] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  if (booking.state === "booked") return <p className="mt-1.5 text-xs font-semibold text-emerald-700">✓ Booked</p>;
  if (booking.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">Not booked.</p>;
  const blocked = booking.taken || booking.outsideHours;
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold disabled:opacity-50";
  return (
    <div className="mt-2 space-y-1.5" data-goat-booking>
      {booking.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {booking.suggestions.map((t) => (
            <button key={t} className={`${btn} border-[#72bdcf] bg-[#eef8fb] hover:bg-[#dff1f6]`} disabled={busy} onClick={() => onTime(t)} style={{ fontSize: 12 }} type="button">
              {to12hLabel(t)}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {!blocked && (
          <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`} disabled={busy} onClick={() => onConfirm(false)} style={{ fontSize: 12 }} type="button">
            Confirm
          </button>
        )}
        <button className={`${btn} border-[var(--line-soft)] bg-white`} disabled={busy} onClick={() => setOtherOpen((o) => !o)} style={{ fontSize: 12 }} type="button">
          Different time
        </button>
        {blocked && (
          <button className={`${btn} border-amber-400 bg-amber-50 text-amber-900`} disabled={busy} onClick={() => onConfirm(true)} style={{ fontSize: 12 }} type="button">
            Override, book anyway
          </button>
        )}
        <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} disabled={busy} onClick={onCancel} style={{ fontSize: 12 }} type="button">
          Cancel
        </button>
      </div>
      {otherOpen && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const t = parseTimeFlexible(other);
            if (t) {
              onTime(t);
              setOther("");
              setOtherOpen(false);
            }
          }}
        >
          <input aria-label="Different time" className="min-w-0 flex-1 rounded-lg border border-[var(--line-soft)] px-2 py-1 text-xs" onChange={(e) => setOther(e.target.value)} placeholder="e.g. 3:30p" value={other} />
          <button className={`${btn} border-[var(--brand-primary)] text-[var(--brand-primary)]`} style={{ fontSize: 12 }} type="submit">
            Check
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * The logged-in person's signature, derived from their login (no setup):
 * a member signs with their roster name (Doctor if on the office's doctor
 * list); the owner signs with the profile / office doctor name. Falls back to
 * the old G.O.A.T. signer list only when the login has no usable name.
 */
function useLoginSigner(): Pick<NoteSigner, "firstName" | "doctor"> | null {
  const { officeSettings } = useOfficeSettings();
  return useMemo(() => {
    const m = getCurrentMembershipSync();
    const fromLogin = signerFromLogin({
      userId: m?.userId ?? null,
      isMember: Boolean(m?.isMember),
      memberLabel: m?.label ?? "",
      ownerName: (officeSettings.doctorName ?? "").trim(),
      doctors: officeSettings.doctors ?? [],
    });
    if (fromLogin) return fromLogin;
    let last: string | null = null;
    try {
      last = window.localStorage.getItem(LAST_SIGNER_KEY);
    } catch {
      last = null;
    }
    return defaultSigner(loadSigners(), m?.userId ?? null, last).signer;
  }, [officeSettings.doctorName, officeSettings.doctors]);
}

function NoteCard({ draft, busy, onSave, onCancel }: { draft: NonNullable<ChatMessage["noteDraft"]>; busy: boolean; onSave: (line: string) => void; onCancel: () => void }) {
  const signer = useLoginSigner();
  const [now] = useState(() => new Date());
  const line = formatNote(draft.text, signer, now);
  if (draft.state === "saved") {
    return (
      <div className="mt-1.5 text-xs">
        <p className="rounded-md bg-[#eef8fb] px-2 py-1">{draft.saved}</p>
        <p className="mt-1 font-semibold text-emerald-700">
          ✓ Saved to Case Notes ·{" "}
          <Link className="text-[var(--brand-primary)] hover:underline" href={`/patients/${encodeURIComponent(draft.patientId)}`} target="_blank">
            Open patient file ↗
          </Link>
        </p>
      </div>
    );
  }
  if (draft.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">Not saved.</p>;
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold disabled:opacity-50";
  return (
    <div className="mt-2 space-y-1.5" data-goat-note>
      <p className="whitespace-pre-line rounded-md bg-[#eef8fb] px-2 py-1 text-xs">{line}</p>
      {signer && <p className="text-[11px] text-[var(--text-muted)]">Signed as {signatureFor(signer).slice(1)} (your login)</p>}
      <div className="flex flex-wrap gap-1.5">
        <button
          className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`}
          disabled={busy}
          onClick={() => onSave(formatNote(draft.text, signer, new Date()))}
          style={{ fontSize: 12 }}
          type="button"
        >
          Confirm
        </button>
        <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} disabled={busy} onClick={onCancel} style={{ fontSize: 12 }} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}

function NoteEditCard({ edit, onConfirm, onCancel }: { edit: NonNullable<ChatMessage["noteEdit"]>; onConfirm: () => void; onCancel: () => void }) {
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold";
  if (edit.state === "done") return <p className="mt-1.5 text-xs font-semibold text-emerald-700">✓ {edit.newLine ? "Updated in Case Notes" : "Removed from Case Notes"}</p>;
  if (edit.state === "missing") return <p className="mt-1.5 text-xs font-semibold text-amber-800">That line isn&apos;t in the Case Notes anymore (it was edited), so I didn&apos;t change anything.</p>;
  if (edit.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">No change.</p>;
  return (
    <div className="mt-2 space-y-1.5 text-xs" data-goat-note-edit>
      <p className="rounded-md bg-[#f6f6f6] px-2 py-1 text-[var(--text-muted)] line-through">{edit.oldLine}</p>
      {edit.newLine && <p className="rounded-md bg-[#eef8fb] px-2 py-1">{edit.newLine}</p>}
      <div className="flex flex-wrap gap-1.5">
        <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`} onClick={onConfirm} style={{ fontSize: 12 }} type="button">
          Confirm
        </button>
        <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} onClick={onCancel} style={{ fontSize: 12 }} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Choices with inactive cases held back behind "Show inactive (N)". */
function withInactive(shown: ChatChoice[], hidden: ChatChoice[]): Pick<ChatMessage, "choices" | "moreChoices"> {
  if (!hidden.length) return { choices: shown };
  if (!shown.length) return { choices: hidden };
  return { choices: [...shown, { label: `Show inactive (${hidden.length})`, showMore: true }], moreChoices: hidden };
}

/** Team logins for "tell <name>", read only while the chat is open. */
function PeopleLoader({ onPeople }: { onPeople: (p: WorkspacePerson[]) => void }) {
  const { officeSettings } = useOfficeSettings();
  const people = useWorkspacePeople((officeSettings.doctorName ?? "").trim());
  useEffect(() => {
    onPeople(people);
  }, [people, onPeople]);
  return null;
}

function MessageCard(props: { draft: NonNullable<ChatMessage["msgDraft"]>; onSent: (body: string) => void; onCancel: () => void }) {
  const { draft } = props;
  if (draft.state === "sent") {
    return (
      <div className="mt-1.5 text-xs">
        <p className="rounded-md bg-[#eef8fb] px-2 py-1">{draft.sent}</p>
        <p className="mt-1 font-semibold text-emerald-700">
          ✓ Sent ·{" "}
          <Link className="text-[var(--brand-primary)] hover:underline" href="/messages">
            Open Messages ↗
          </Link>
        </p>
      </div>
    );
  }
  if (draft.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">Not sent.</p>;
  return <OpenMessageCard {...props} />;
}

function OpenMessageCard({ draft, onSent, onCancel }: { draft: NonNullable<ChatMessage["msgDraft"]>; onSent: (body: string) => void; onCancel: () => void }) {
  const { postMessage } = useWorkspaceMessages();
  const { isOwner } = useWorkspaceAccess();
  const { officeSettings } = useOfficeSettings();
  const signer = useLoginSigner();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const sig = signer ? signatureFor(signer) : "";
  const body = messageBody({ firstName: draft.toLabel, label: draft.toLabel, userId: draft.toUserId }, draft.text, sig);
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold disabled:opacity-50";
  return (
    <div className="mt-2 space-y-1 text-xs" data-goat-message>
      <p>
        <span className="text-[var(--text-muted)]">To:</span> <strong>{draft.toLabel}</strong>
      </p>
      <p>
        <span className="text-[var(--text-muted)]">Case:</span> {draft.caseLabel ?? "None (general message)"}
      </p>
      <p className="whitespace-pre-line rounded-md bg-[#eef8fb] px-2 py-1">{body}</p>
      <p className="text-[11px] text-[var(--text-muted)]">From: {sig ? sig.slice(1) : "you"}</p>
      {!draft.toUserId && <p className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-800">{draft.toLabel} isn&apos;t linked to a login, so they won&apos;t get a notification. It still shows in Messages.</p>}
      {error && <p className="rounded-md bg-red-50 px-2 py-1 font-semibold text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <button
          className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`}
          disabled={sending}
          onClick={async () => {
            setSending(true);
            setError("");
            const ok = await postMessage({
              body,
              authorLabel: isOwner ? (officeSettings.doctorName ?? "").trim() || "Admin" : getCurrentMembershipSync()?.label || "Team Member",
              patientId: draft.patientId,
              patientName: draft.caseLabel,
              mentions: draft.toUserId ? [{ userId: draft.toUserId, label: draft.toLabel }] : [],
            });
            setSending(false);
            if (ok) onSent(body);
            else setError("Couldn't send. Check that you're signed in and try again.");
          }}
          style={{ fontSize: 12 }}
          type="button"
        >
          {sending ? "Sending…" : "Confirm"}
        </button>
        <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} disabled={sending} onClick={onCancel} style={{ fontSize: 12 }} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
