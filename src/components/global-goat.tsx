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
import { isAdminTier } from "@/lib/admin-access";
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
import { buildTeam, isTellRequest, matchRecipient, parseTell, audienceLabel, privateToFor, type TeamPerson } from "@/lib/goat-message";
import { filterMentionPeople, mentionInsert, mentionQueryAt, parseMentions } from "@/lib/goat-mentions";
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
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { batchCategory, buildImportRows, categoryFromRequest, looksLikeContactPaste, parseContactPaste } from "@/lib/goat-contacts-import";
import { breaksFlow, continueFlow, isFlowToken, startFlow, type FlowCtx, type FlowTurn, type Pending } from "@/lib/goat-slash-flow";
import { GOAT_HANDBOOK_ANCHOR, goatHelpText, isGoatHelpQuestion } from "@/lib/handbook-goat";
import { CONTACT_CATEGORIES, type ContactCategory } from "@/lib/mock-data";
import { omTurn, planChanges, emptyOmMemory, isoToUs, usToIso, money, type OmMemory, type OmPlan, type OmData } from "@/lib/goat-om";
import { applyOmChanges, buildOmData, restoreOmSnapshot, snapshotFor } from "@/lib/goat-om-apply";
import { loadEncounterNoteRecords } from "@/lib/encounter-notes";
import { parseViewTarget, viewMatches, viewMessages, viewQuery, viewSchedule, viewTargetsFor, viewTodos, type ViewTarget } from "@/lib/goat-briefs";
import { ADMIN_ONLY_REPLY, appointmentCheck, briefAllowed, chipsFor, detectBrief, greetingFor, quickBiz, morningRundown, noteWording, parseSlash, parseTodo, slashMatches, slashQuery, type BriefData } from "@/lib/goat-briefs";
import { useTasks } from "@/hooks/use-tasks";
import { useUnreadMessages } from "@/hooks/use-unread-messages";
import { loadOfficeSettings } from "@/lib/office-settings";
import { loadPatientBillingMap } from "@/lib/patient-billing";

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
  const { addTask } = useTasks();
  const { roleTier } = useWorkspaceAccess();
  /** Owner/admin: sees Appointment Check + Quick Biz. */
  const isGoatAdmin = isAdminTier(roleTier);
  const { addContactsBulk, removeContactsByIds, updateContact } = useContactDirectory();
  /** The step a "/" command flow is waiting on (case pick, note text…). */
  const flowRef = useRef<Pending | null>(null);
  /** Contact imports being saved (message ids). */
  const importingRef = useRef(new Set<string>());
  const unreadMessages = useUnreadMessages();
  // Shown under the greeting until the first message; computed when the popup opens.
  const [greeting] = useState(() => greetingFor(new Date().getHours()));
  /** What the user actually typed, when send() rewrites it ("/note …" → "add a note for …"). */
  const shownAsRef = useRef<string | null>(null);
  const [teamLogins, setTeamLogins] = useState<WorkspacePerson[]>([]);
  // "@" in the input: the team roster picker (owner included), like the Messages composer.
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionMatches = mention ? filterMentionPeople(teamLogins, mention.query, getCurrentMembershipSync()?.userId ?? null) : [];
  const syncMention = (value: string, caret: number) => {
    const m = mentionQueryAt(value, caret);
    setMention(m);
    if (!m) setMentionIndex(0);
  };
  const pickMention = (p: WorkspacePerson) => {
    if (!mention) return;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const before = input.slice(0, mention.at);
    const ins = mentionInsert(p.label);
    setInput(before + ins + input.slice(caret));
    setMention(null);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = before.length + ins.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Opening G.O.A.T. (sidebar button or anywhere else) puts the cursor in the
  // chat box so the user can type right away.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open]);
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

  const push = useCallback((m0: Omit<ChatMessage, "id" | "at">, patientId?: string | null) => {
    let m = m0;
    if (m.role === "user" && shownAsRef.current) {
      m = { ...m, text: shownAsRef.current };
      shownAsRef.current = null;
    }
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
      push({ role: "goat", text: "Send this message? (general, no patient)", msgDraft: { toLabel: last.toLabel, toUserId: last.toUserId, alsoTo: last.alsoTo, text: last.text, state: "open" } });
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

  // ---- Office manager (money + cases): rules only; one confirm card per change. ----
  const omData = (): OmData => {
    const d = practiceData();
    return buildOmData({ patients: allPatients(), appointments: d.appointments, encounters: practiceOverride ? [] : loadEncounterNoteRecords(), contacts: d.contacts, today: d.today });
  };
  /** Memory from the chat itself: what was last listed, last confirmed card, and whether ours was the last action. */
  const omMemory = (): { mem: OmMemory; followUps: boolean } => {
    let mem = emptyOmMemory();
    let followUps = false;
    let sawAction = false;
    let sawListed = false;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      if (m.role !== "goat") continue;
      if (!sawListed && m.omListed) {
        mem = { ...mem, listed: m.omListed };
        sawListed = true;
      }
      const action = Boolean(m.contactEdit || m.contactImport || m.todoDraft || m.om || m.omUndo || m.noteDraft || m.noteEdit || m.booking || m.msgDraft || m.msgAsk);
      if (action && !sawAction) {
        sawAction = true;
        followUps = Boolean(m.om || m.omUndo);
      }
      if (m.om && (m.om.state === "done" || m.om.state === "undone") && !mem.lastPlan) {
        mem = { ...mem, lastPlan: m.om.plan, canUndo: m.om.state === "done" };
      }
      if (sawListed && sawAction && mem.lastPlan) break;
    }
    return { mem, followUps };
  };
  const tryOfficeManager = (question: string): boolean => {
    const { mem, followUps } = omMemory();
    const r = omTurn(question, omData(), mem, followUps);
    if (!r) return false;
    push({ role: "user", text: question, practice: true });
    if (r.kind === "answer") push({ role: "goat", text: r.text, practice: true, omListed: r.listed });
    else if (r.kind === "say") push({ role: "goat", text: r.text, practice: true });
    else if (r.kind === "confirm") push({ role: "goat", text: r.text, practice: true, om: { plan: r.plan, state: "open" } });
    else {
      const target = [...chat.messages].reverse().find((m) => m.om && m.om.state === "done");
      if (!target) push({ role: "goat", text: "There's nothing of mine to undo.", practice: true });
      else push({ role: "goat", text: r.text, practice: true, omUndo: { targetId: target.id, state: "open" } });
    }
    return true;
  };
  const setMsg = (id: string, patch: Partial<ChatMessage>) => setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const confirmOm = (msg: ChatMessage, plan: Exclude<OmPlan, { kind: "undo" }>, signLine: (text: string) => string) => {
    if (!msg.om || msg.om.state !== "open") return;
    const data = omData();
    const changes = planChanges(plan, data);
    if (!changes.length) {
      setMsg(msg.id, { om: { ...msg.om, plan, state: "canceled", result: "Nothing to change (every line was skipped or needs a pick)." } });
      return;
    }
    const patients = allPatients();
    const snapshot = snapshotFor([...new Set(changes.map((c) => c.patientId))], patients);
    applyOmChanges(changes, patients, signLine);
    const name = (id: string) => displayName(patients.find((p) => p.id === id)?.fullName ?? id);
    const result = `✓ Saved for ${changes.map((c) => name(c.patientId)).join(", ")} (signed note added to each).`;
    setMsg(msg.id, { om: { plan, state: "done", snapshot, result }, omListed: changes.map((c) => c.patientId) });
  };
  const confirmOmUndo = (msg: ChatMessage) => {
    const u = msg.omUndo;
    if (!u || u.state !== "open") return;
    const target = chat.messages.find((m) => m.id === u.targetId);
    if (!target?.om?.snapshot || target.om.state !== "done") {
      setMsg(msg.id, { omUndo: { ...u, state: "canceled", result: "That change was already undone." } });
      return;
    }
    restoreOmSnapshot(target.om.snapshot);
    setMsg(target.id, { om: { ...target.om, state: "undone" } });
    setMsg(msg.id, { omUndo: { ...u, state: "done", result: `✓ Undone — ${target.om.snapshot.length} case${target.om.snapshot.length === 1 ? "" : "s"} back exactly as before.` } });
  };

  // ---- Briefs (greeting chips) and "/" commands ----
  const briefData = (): BriefData => {
    const d = practiceData();
    const billing = practiceOverride ? {} : loadPatientBillingMap();
    const index = buildInitialExamIndex(d.appointments);
    const locations = practiceOverride ? [] : (loadOfficeSettings().locations ?? []);
    return {
      today: d.today,
      appointments: d.appointments,
      tasks: d.tasks,
      unreadMessages,
      locations: locations.map((l) => ({ id: l.id, name: l.name, nickname: l.nickname })),
      patients: allPatients().map((p) => ({
        id: p.id,
        fullName: p.fullName,
        caseStatus: p.caseStatus,
        locationId: p.locationId,
        firstVisit: p.matrix?.initialExam?.trim() || patientInitialExamIso(p, index),
        billed: billing[p.id]?.billedAmount,
        paid: billing[p.id]?.paidAmount ?? (Number.parseFloat(p.matrix?.paidAmount ?? "") || 0),
        paidDate: billing[p.id]?.paidDate || (p.matrix?.paidDate ?? "").replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1"),
      })),
    };
  };
  /** "/view <target>": read-only lists (admin targets gated). */
  const runView = (question: string, rest: string) => {
    push({ role: "user", text: question, practice: true });
    const target = parseViewTarget(rest);
    const opts = viewTargetsFor(isGoatAdmin);
    if (!target) {
      push({ role: "goat", text: rest ? `I can't show "${rest}". What would you like to see?` : "What would you like to see?", practice: true, choices: opts.map((v) => ({ label: v.word[0].toUpperCase() + v.word.slice(1), question: `/view ${v.word}` })) });
      return;
    }
    const kind: Record<ViewTarget, "rundown" | "apptCheck" | "business"> = { todo: "rundown", schedule: "rundown", messages: "rundown", apptCheck: "apptCheck", business: "business" };
    if (!briefAllowed(kind[target], isGoatAdmin)) {
      push({ role: "goat", text: ADMIN_ONLY_REPLY, practice: true });
      return;
    }
    const data = briefData();
    const a = target === "todo" ? viewTodos(data) : target === "schedule" ? viewSchedule(data) : target === "messages" ? viewMessages(data) : target === "apptCheck" ? appointmentCheck(data) : quickBiz(data);
    push({ role: "goat", text: a.text, practice: true, links: a.links });
  };
  /** Greeting chip tap: drop any waiting step and run the brief directly. */
  const runChip = (chip: string) => {
    flowRef.current = null;
    if (job || practiceBusy) return;
    tryBrief(chip);
  };
  const tryBrief = (question: string): boolean => {
    const kind = detectBrief(question);
    if (!kind) return false;
    if (!briefAllowed(kind, isGoatAdmin)) {
      push({ role: "user", text: question, practice: true });
      push({ role: "goat", text: ADMIN_ONLY_REPLY, practice: true, choices: [{ label: "Morning Rundown", question: "Morning Rundown" }] });
      return true;
    }
    const data = briefData();
    const a = kind === "rundown" ? morningRundown(data) : kind === "apptCheck" ? appointmentCheck(data) : quickBiz(data);
    push({ role: "user", text: question, practice: true });
    push({ role: "goat", text: a.text, practice: true, links: a.links });
    return true;
  };
  /** "/note …" → the note dialog; "/todo …" → a to-do confirm card. True if handled. */
  const trySlash = (question: string): boolean => {
    const sl = parseSlash(question);
    if (!sl) {
      if (/^\/[a-z]+\b/i.test(question)) {
        push({ role: "user", text: question, practice: true });
        push({ role: "goat", text: `I know these commands: ${slashMatches("").map((c) => `/${c.cmd}`).join(", ")}. Type / to see them.`, practice: true });
        return true;
      }
      return false;
    }
    if (sl.cmd === "view") {
      runView(question, sl.rest);
      return true;
    }
    const started = startFlow(sl.cmd, sl.rest, flowCtx());
    if (started) {
      push({ role: "user", text: sl.cmd === "contact" && sl.rest.includes("\n") ? `/contact … (pasted list)` : question, practice: true });
      runFlowTurn(started);
      return true;
    }
    if (sl.cmd === "contact") return false;
    if (sl.cmd === "note") {
      shownAsRef.current = question;
      send(noteWording(sl.rest));
      return true;
    }
    push({ role: "user", text: question, practice: true });
    const t = parseTodo(sl.rest, practiceData().today);
    if (!t.title) {
      push({ role: "goat", text: 'What\'s the to-do? e.g. "/todo call Nazaryan for John Smith tomorrow" or "/todo John Smith: request records"', practice: true });
      return true;
    }
    const people = allPatients();
    let patient: PatientRecord | null = null;
    let title = t.title;
    if (t.name) {
      const all = matchPatientsByName(t.name, people);
      const split = activeFirst(all, (p) => isActiveCase(p.caseStatus));
      if (!all.length) {
        push({ role: "goat", text: `I couldn't find a patient named "${t.name}". Check the name, or leave it off for a to-do with no patient.`, practice: true });
        return true;
      }
      if (all.length > 1) {
        const ch = (p: PatientRecord) => ({ label: choiceLabel(toChatPatient(p)), question: `/todo ${p.fullName.replace(/,/g, "")}: ${sl.rest.replace(/^[^:]*:\s*/, "")}` });
        push({ role: "goat", text: `Which ${t.name}?`, practice: true, ...withInactive(split.shown.map(ch), split.hidden.map(ch)) });
        return true;
      }
      patient = all[0];
    } else {
      const found = findPatientsInQuestion(title, people.map(toChatPatient));
      if (found.confident) {
        patient = patientById(found.confident.patient.id);
        if (patient) title = (stripPatientName(title, patient.fullName) || title).replace(/\s+(for|re|about|on)\s*$/i, "").trim();
      } else if (found.candidates.length > 1) {
        const ch = (c: ChatPatient) => ({ label: choiceLabel(c), question: `/todo ${c.fullName.replace(/,/g, "")}: ${title}${t.due ? ` ${t.due.slice(5, 7)}/${t.due.slice(8, 10)}` : ""}` });
        push({ role: "goat", text: "Which patient is this to-do for?", practice: true, choices: [...found.candidates.map((m) => ch(m.patient)), { label: "No patient", question: `/todo none: ${title}` }] });
        return true;
      }
    }
    if (t.name && /^none$/i.test(t.name)) patient = null;
    push({ role: "goat", text: "Add this to-do?", practice: true, patientName: patient ? displayName(patient.fullName) : undefined, todoDraft: { title, dueDate: t.due, patientId: patient?.id, patientName: patient?.fullName, state: "open" } });
    return true;
  };
  const confirmTodo = (msg: ChatMessage) => {
    const d = msg.todoDraft;
    if (!d || d.state !== "open") return;
    const r = addTask({ title: d.title, priority: "Medium", dueDate: d.dueDate, patientId: d.patientId, patientName: d.patientName });
    setMsg(msg.id, { todoDraft: { ...d, state: r.added ? "saved" : "canceled" } });
  };

  // ---- "/" command flows (step by step) ----
  const flowCtx = (): FlowCtx => ({
    today: practiceData().today,
    patients: allPatients().map((p) => ({ id: p.id, fullName: p.fullName, caseStatus: p.caseStatus })),
    contacts: practiceOverride ? [] : loadContactDirectory().map((c) => ({ id: c.id, name: c.name, category: c.category, phone: c.phone })),
    openPatientId: openPatientId ?? null,
  });
  const runFlowTurn = (turn: FlowTurn) => {
    flowRef.current = turn.pending;
    if (turn.say) push({ role: "goat", text: turn.say, practice: true, choices: turn.choices?.map((c) => ({ label: c.label, question: c.token })) });
    const a = turn.action;
    if (!a) return;
    if (a.type === "noteConfirm") {
      const p = patientById(a.patientId);
      if (p) push({ role: "goat", text: "Add this to the Notes in the patient file?", practice: true, patientName: displayName(p.fullName), noteDraft: { patientId: p.id, patientName: p.fullName, text: a.text, state: "open" } });
    } else if (a.type === "todoConfirm") {
      const p = a.patientId ? patientById(a.patientId) : null;
      push({ role: "goat", text: "Add this to-do?", practice: true, patientName: p ? displayName(p.fullName) : undefined, todoDraft: { title: a.title, dueDate: a.due, patientId: p?.id, patientName: p?.fullName, state: "open" } });
    } else if (a.type === "contactPaste") {
      if (!showContactImport(a.text, true)) push({ role: "goat", text: "I couldn't find a phone number in that. Each contact needs a name and a phone — try again, or type cancel.", practice: true });
      if (!looksLikeContactPaste(a.text) && parseContactPaste(a.text).every((d) => !d.phone)) flowRef.current = { k: "contactAdd" };
    } else if (a.type === "contactEdit") {
      const c = loadContactDirectory().find((x) => x.id === a.contactId);
      if (c) push({ role: "goat", text: `Edit ${c.name}:`, practice: true, contactEdit: { contactId: c.id, name: c.name, category: c.category, phone: c.phone, fax: c.fax ?? "", email: c.email ?? "", address: c.address ?? "", state: "open" } });
    }
  };
  /** Chip taps and replies to a waiting "/" step. True if handled. */
  const tryFlow = (question: string): boolean => {
    if (!isFlowToken(question) && breaksFlow(question, flowRef.current)) flowRef.current = null;
    if (!isFlowToken(question) && !flowRef.current) return false;
    const turn = continueFlow(question, flowRef.current, flowCtx());
    if (!turn) {
      if (isFlowToken(question)) return true; // stale chip: ignore
      flowRef.current = null;
      return false;
    }
    if (!isFlowToken(question)) push({ role: "user", text: question.includes("\n") ? `${question.split("\n")[0].slice(0, 80)} … (pasted list)` : question, practice: true });
    runFlowTurn(turn);
    return true;
  };
  const confirmContactEdit = (msg: ChatMessage, d: NonNullable<ChatMessage["contactEdit"]>) => {
    const r = updateContact(d.contactId, { name: d.name, category: d.category as ContactCategory, phone: d.phone, fax: d.fax, email: d.email, address: d.address });
    setMsg(msg.id, { contactEdit: { ...d, state: r.updated ? "saved" : "open", result: r.updated ? `Saved ${r.contact.name}.` : r.reason } });
  };

  // ---- Bulk contacts from pasted text ----
  const tryContactPaste = (text: string): boolean => {
    if (!looksLikeContactPaste(text)) return false;
    if (!parseContactPaste(text).length) return false;
    const first = text.split(/\r?\n/)[0].slice(0, 80);
    push({ role: "user", text: `${first}${text.includes("\n") ? " … (pasted list)" : ""}`, practice: true });
    return showContactImport(text, false);
  };
  /** The review card for pasted/typed contacts. force = came from /contact (no paste detection needed). */
  const showContactImport = (text: string, force: boolean): boolean => {
    const drafts = parseContactPaste(text).filter((d) => force ? d.phone || d.name : true);
    if (!drafts.length || (force && drafts.every((d) => !d.phone))) return false;
    const asked = categoryFromRequest(text);
    const guess = asked || batchCategory(drafts);
    const rows = buildImportRows(drafts, practiceOverride ? [] : loadContactDirectory(), guess as ContactCategory | "");
    const dupes = rows.filter((r) => r.flag).length;
    const say = guess
      ? `I found ${rows.length} contact${rows.length === 1 ? "" : "s"}. ${asked ? `Category: ${guess}.` : `They look like ${guess === "Attorney" ? "law firms" : guess} — I set the category to ${guess}; change it if that's wrong.`}${dupes ? ` ${dupes} start unticked (possible duplicates or missing info).` : ""} Check the list, then Confirm.`
      : `I found ${rows.length} contact${rows.length === 1 ? "" : "s"}. What category are they? Pick one in the card (you can change single rows too).${dupes ? ` ${dupes} start unticked (possible duplicates or missing info).` : ""}`;
    push({ role: "goat", text: say, practice: true, contactImport: { rows, category: guess, categoryGuessed: !asked && Boolean(guess), state: "open" } });
    return true;
  };
  const confirmContactImport = async (msg: ChatMessage, imp: NonNullable<ChatMessage["contactImport"]>) => {
    // A fast double click must not add the list twice.
    if (imp.state !== "open" || importingRef.current.has(msg.id)) return;
    importingRef.current.add(msg.id);
    const picked = imp.rows.filter((r) => r.checked);
    setMsg(msg.id, { contactImport: { ...imp, state: "saving" } });
    const res = await addContactsBulk(picked.map((r) => ({ name: r.name, phone: r.phone, fax: r.fax, email: r.email, address: r.address, category: (r.category || imp.category) as ContactCategory })));
    const skipped = imp.rows.length - res.added.length;
    const why = res.skipped.length ? ` (${res.skipped.length} couldn't be added: ${res.skipped.slice(0, 3).map((x) => `${x.name} — ${x.reason}`).join("; ")}${res.skipped.length > 3 ? "…" : ""})` : "";
    setMsg(msg.id, { contactImport: { ...imp, state: "saved", addedIds: res.added.map((c) => c.id), result: `Added ${res.added.length}, skipped ${skipped}${why}.` } });
  };
  const undoContactImport = (msg: ChatMessage, imp: NonNullable<ChatMessage["contactImport"]>) => {
    const n = removeContactsByIds(imp.addedIds ?? []);
    setMsg(msg.id, { contactImport: { ...imp, state: "undone", result: `Undone: removed the ${n} contact${n === 1 ? "" : "s"} this import added.` } });
  };

  const send = (raw: string, opts?: { to?: TeamPerson[]; display?: string; prefix?: string }) => {
    const question = raw.trim();
    if (!question || job || practiceBusy) return;
    // A chip, "/" or "@" command, help or a pasted list always ends a waiting "/" step.
    if (!opts && !isFlowToken(question) && breaksFlow(question, flowRef.current)) flowRef.current = null;
    setInput("");
    setMention(null);
    // "@Leilani hi", "@Dr. Abi …", "@Hannah @Greg …" = "tell …" (one card for everyone mentioned).
    if (!opts && question.startsWith("@")) {
      const team = buildTeam(loadSigners(), teamLogins);
      const mc = parseMentions(question, team);
      if (mc) {
        if (!mc.recipients.length || mc.unknown.length) {
          push({ role: "user", text: question, practice: true });
          push({ role: "goat", text: `I couldn't find a team member named "${mc.unknown[0] ?? question.slice(1).split(/\s/)[0]}". Type @ to pick from the team.`, practice: true });
          return;
        }
        if (!mc.text) {
          push({ role: "user", text: question, practice: true });
          push({ role: "goat", text: `What should I tell ${mc.recipients.map((r) => r.label).join(" and ")}?`, practice: true });
          return;
        }
        const prefix = mc.recipients.map((r) => `@${r.label}`).join(" ");
        return send(`tell ${mc.recipients[0].firstName} ${mc.text}`, { to: mc.recipients, display: question, prefix });
      }
    }
    const people = allPatients().map(toChatPatient);
    const found = findPatientsInQuestion(question, people);
    const waitingForName = waitingQuestion();
    // "/note", "/todo" and the greeting chips (Morning Rundown, Appointment Check, Quick Biz).
    if (!opts && isGoatHelpQuestion(question)) {
      push({ role: "user", text: question, practice: true });
      push({ role: "goat", text: goatHelpText(), practice: true, links: [{ label: "Handbook → G.O.A.T.", href: GOAT_HANDBOOK_ANCHOR }] });
      return;
    }
    if (!opts && !isFlowToken(question) && detectBrief(question)) {
      flowRef.current = null;
      if (tryBrief(question)) return;
    }
    if (!opts && tryFlow(question)) return;
    if (!opts && tryContactPaste(question)) return;
    if (!opts && trySlash(question)) return;
    if (!opts && tryBrief(question)) return;
    // Office manager (mark paid, reductions, case status, attorney, money questions, undo).
    if (!opts && tryOfficeManager(question)) return;
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
        push({ role: "user", text: opts?.display ?? question, practice: true });
        const team = buildTeam(loadSigners(), teamLogins);
        const to = opts?.to ?? matchRecipient(req.to, team);
        const alsoTo = (opts?.to ?? []).slice(1).map((p) => ({ label: p.label, userId: p.userId }));
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
          const ch = (c: { patient: ChatPatient }) => ({ label: choiceLabel(c.patient), question: opts?.prefix ? `${opts.prefix} ${swap(displayName(c.patient.fullName))}` : `tell ${req.to} ${swap(displayName(c.patient.fullName))}` });
          push({ role: "goat", text: "Which patient is this about? (Or say \"no patient\" to send it as a general message.)", msgAsk: { toLabel: recipient.label, toUserId: recipient.userId, alsoTo, text: req.text }, ...withInactive(lookup.candidates.map(ch), lookup.inactive.map(ch)) });
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
          msgDraft: { toLabel: recipient.label, toUserId: recipient.userId, alsoTo: alsoTo.length ? alsoTo : undefined, text: req.text, patientId: pt?.id, patientName: pt?.fullName, caseLabel: pt ? (caseNo ? `${caseNo} ${pt.fullName}` : pt.fullName) : undefined, state: "open" },
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
          className="fixed inset-x-2 bottom-2 z-[60] flex h-[min(97.5vh,calc(100dvh-1rem))] flex-col overflow-hidden rounded-2xl border border-[var(--line-soft)] bg-white shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:h-[min(700px,calc(100dvh-2rem))] sm:w-[min(600px,calc(100vw-2rem))]"
          data-goat-panel
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
                  // Waiting steps belong to the old chat.
                  flowRef.current = null;
                  dialogRef.current = emptyDialog();
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
                <div className="rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-sm" data-goat-greeting>
                  <p className="font-semibold">{greeting}</p>
                  <p className="text-xs text-[var(--text-muted)]">Ask about a patient, or tap one:</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {chipsFor(isGoatAdmin).map((c) => (
                      <button className="rounded-full border border-[var(--brand-primary)]/40 bg-[#eef8fb] px-3 py-1 text-xs font-semibold text-[var(--brand-primary)] transition hover:bg-[var(--brand-primary)] hover:text-white" data-goat-chip key={c} onClick={() => runChip(c)} type="button">
                        {c}
                      </button>
                    ))}
                  </div>
                  <span className="mt-1.5 block text-[11px] text-[var(--text-muted)]">Type / for commands, @ to message the team. Everything stays in NoteGoat.</span>
                </div>
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
                    {m.contactEdit && <ContactEditCard d={m.contactEdit} onCancel={() => setMsg(m.id, { contactEdit: { ...m.contactEdit!, state: "canceled" } })} onChange={(d) => setMsg(m.id, { contactEdit: d })} onConfirm={(d) => confirmContactEdit(m, d)} />}
                    {m.contactImport && <ContactImportCard imp={m.contactImport} onCancel={() => setMsg(m.id, { contactImport: { ...m.contactImport!, state: "canceled" } })} onChange={(imp) => setMsg(m.id, { contactImport: imp })} onConfirm={(imp) => void confirmContactImport(m, imp)} onUndo={() => undoContactImport(m, m.contactImport!)} />}
                    {m.todoDraft && <TodoCard draft={m.todoDraft} onCancel={() => setMsg(m.id, { todoDraft: { ...m.todoDraft!, state: "canceled" } })} onConfirm={() => confirmTodo(m)} />}
                    {m.om && <OmCard data={omData()} om={m.om} onCancel={() => setMsg(m.id, { om: { ...m.om!, state: "canceled" } })} onConfirm={(plan, sign) => confirmOm(m, plan, sign)} />}
                    {m.omUndo && <OmUndoCard undo={m.omUndo} onCancel={() => setMsg(m.id, { omUndo: { ...m.omUndo!, state: "canceled" } })} onConfirm={() => confirmOmUndo(m)} />}
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
              <div className="relative min-w-0 flex-1">
                <input
                  aria-label="Ask G.O.A.T."
                  aria-autocomplete="list"
                  aria-expanded={mentionMatches.length > 0}
                  className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onBlur={() => window.setTimeout(() => setMention(null), 150)}
                  onPaste={(e) => {
                    // A one-line box drops newlines, so a pasted contact list is handled here.
                    const pasted = e.clipboardData.getData("text");
                    const full = input.trim() ? `${input.trim()}\n${pasted}` : pasted;
                    if (pasted.includes("\n") && looksLikeContactPaste(full)) {
                      e.preventDefault();
                      send(full);
                    }
                  }}
                  onChange={(e) => {
                    setInput(e.target.value);
                    syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
                  }}
                  onKeyDown={(e) => {
                    const vq = !mention ? viewQuery(input) : null;
                    if (vq !== null && e.key === "Tab" && viewMatches(vq, isGoatAdmin).length) {
                      e.preventDefault();
                      setInput(`/view ${viewMatches(vq, isGoatAdmin)[0].word}`);
                      return;
                    }
                    const sq = !mention ? slashQuery(input) : null;
                    if (sq !== null && e.key === "Tab" && slashMatches(sq).length) {
                      e.preventDefault();
                      setInput(`/${slashMatches(sq)[0].cmd} `);
                      return;
                    }
                    if (!mention || !mentionMatches.length) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionIndex((i) => (i + 1) % mentionMatches.length);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                    } else if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      pickMention(mentionMatches[mentionIndex] ?? mentionMatches[0]);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setMention(null);
                    }
                  }}
                  onKeyUp={(e) => {
                    if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return;
                    const t = e.target as HTMLInputElement;
                    syncMention(t.value, t.selectionStart ?? t.value.length);
                  }}
                  placeholder="Ask about a patient… / for commands, @ to message the team"
                  ref={inputRef}
                  value={input}
                />
                {!mention && viewQuery(input) !== null && viewMatches(viewQuery(input) ?? "", isGoatAdmin).length > 0 && (
                  <div className="absolute bottom-full left-0 z-30 mb-1 w-72 overflow-hidden rounded-xl border border-[var(--line-soft)] bg-white shadow-lg" data-goat-view-menu role="listbox">
                    {viewMatches(viewQuery(input) ?? "", isGoatAdmin).map((v) => (
                      <button
                        aria-selected={false}
                        className="block w-full px-3 py-2 text-left hover:bg-[var(--bg-soft)]"
                        key={v.target}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          send(`/view ${v.word}`);
                        }}
                        role="option"
                        type="button"
                      >
                        <span className="text-sm font-semibold">/view {v.word}</span> <span className="text-xs text-[var(--text-muted)]">{v.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!mention && slashQuery(input) !== null && slashMatches(slashQuery(input) ?? "").length > 0 && (
                  <div className="absolute bottom-full left-0 z-30 mb-1 w-72 overflow-hidden rounded-xl border border-[var(--line-soft)] bg-white shadow-lg" data-goat-slash-menu role="listbox">
                    {slashMatches(slashQuery(input) ?? "").map((c) => (
                      <button
                        className="block w-full px-3 py-2 text-left hover:bg-[var(--bg-soft)]"
                        key={c.cmd}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setInput(`/${c.cmd} `);
                          inputRef.current?.focus();
                        }}
                        role="option"
                        aria-selected={false}
                        type="button"
                      >
                        <span className="text-sm font-semibold">/{c.cmd}</span> <span className="text-xs text-[var(--text-muted)]">{c.hint}</span>
                        <span className="block truncate text-[11px] text-[var(--text-muted)]">{c.example}</span>
                      </button>
                    ))}
                  </div>
                )}
                {mention && mentionMatches.length > 0 && (
                  <div className="absolute bottom-full left-0 z-30 mb-1 max-h-60 w-64 overflow-y-auto rounded-xl border border-[var(--line-soft)] bg-white shadow-lg" data-goat-mention-picker role="listbox">
                    {mentionMatches.map((p, i) => (
                      <button
                        aria-selected={i === mentionIndex}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${i === mentionIndex ? "bg-[var(--bg-soft)]" : "bg-white"}`}
                        key={p.userId}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickMention(p);
                        }}
                        onMouseEnter={() => setMentionIndex(i)}
                        ref={(el) => {
                          if (el && i === mentionIndex) el.scrollIntoView({ block: "nearest" });
                        }}
                        role="option"
                        type="button"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-soft)] text-xs font-bold text-[var(--text-muted)]">
                          {p.label.replace(/^dr\.?\s+/i, "").split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{p.label}</span>
                          {p.email && <span className="block truncate text-xs text-[var(--text-muted)]">{p.email}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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

function OmCard({ data, om, onConfirm, onCancel }: { data: OmData; om: NonNullable<ChatMessage["om"]>; onConfirm: (plan: Exclude<OmPlan, { kind: "undo" }>, sign: (text: string) => string) => void; onCancel: () => void }) {
  const signer = useLoginSigner();
  const [plan, setPlan] = useState(om.plan);
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold disabled:opacity-50";
  const nameOf = (id: string | null) => (id ? data.patients.find((p) => p.id === id) : undefined);
  if (om.state !== "open") {
    return (
      <p className={`mt-1.5 text-xs ${om.state === "done" ? "font-semibold text-emerald-700" : "text-[var(--text-muted)]"}`}>
        {om.state === "done" ? om.result : om.state === "undone" ? "Undone." : om.result ?? "Not saved."}
      </p>
    );
  }
  const moneyKind = plan.kind === "markPaid" || plan.kind === "addPaid" || plan.kind === "reduction";
  const setRow = (i: number, patch: Partial<(typeof plan.rows)[number]>) => setPlan((p) => ({ ...p, rows: p.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }) as typeof p);
  const ready = plan.rows.filter((r) => !r.skip && r.patientId && (!moneyKind || (r.amount ?? 0) > 0));
  const hasDate = plan.kind !== "attorney";
  return (
    <div className="mt-2 space-y-1.5 text-xs" data-goat-om>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-[11px] text-[var(--text-muted)]">
            <th className="py-0.5 pr-2 font-semibold">Patient</th>
            {moneyKind && <th className="py-0.5 pr-2 font-semibold">{plan.kind === "addPaid" ? "Add" : "Paid"}</th>}
            <th className="py-0.5 font-semibold">Now</th>
          </tr>
        </thead>
        <tbody>
          {plan.rows.map((r, i) => {
            const p = nameOf(r.patientId);
            const flagged = !r.patientId || r.flag === "noAmount";
            return (
              <tr className={`border-t border-[var(--line-soft)] ${r.skip ? "opacity-40" : ""}`} key={i}>
                <td className="py-1 pr-2 align-top">
                  {r.candidates.length > 1 || !r.patientId ? (
                    <select aria-label={`Patient for "${r.typed}"`} className="max-w-[11rem] rounded border border-amber-400 bg-amber-50 px-1 py-0.5" onChange={(e) => setRow(i, e.target.value === "__skip" ? { skip: true, patientId: null } : { skip: false, patientId: e.target.value || null })} value={r.skip ? "__skip" : r.patientId ?? ""}>
                      <option value="">{r.candidates.length ? `Pick for "${r.typed}"…` : `No match for "${r.typed}"`}</option>
                      {r.candidates.map((id) => {
                        const c = nameOf(id);
                        return <option key={id} value={id}>{c ? `${c.fullName} · ${c.caseStatus}` : id}</option>;
                      })}
                      <option value="__skip">Skip this line</option>
                    </select>
                  ) : (
                    <span className="font-semibold">{p?.fullName}</span>
                  )}
                  {flagged && !r.skip && r.patientId && r.flag === "noAmount" && <span className="ml-1 text-amber-700">(no amount typed)</span>}
                  {r.patientId && r.candidates.length <= 1 && (
                    <button className="ml-1 text-[11px] text-[var(--text-muted)] hover:underline" onClick={() => setRow(i, { skip: !r.skip })} type="button">{r.skip ? "include" : "skip"}</button>
                  )}
                </td>
                {moneyKind && (
                  <td className="py-1 pr-2 align-top">
                    <input aria-label="Amount" className="w-20 rounded border border-[var(--line-soft)] px-1 py-0.5" inputMode="decimal" onChange={(e) => { const n = Number.parseFloat(e.target.value.replace(/[^0-9.]/g, "")); setRow(i, { amount: Number.isFinite(n) ? n : undefined }); }} value={r.amount ?? ""} />
                  </td>
                )}
                <td className="py-1 align-top text-[var(--text-muted)]">
                  {p ? (moneyKind ? `${p.caseStatus} · billed ${p.billed ? money(p.billed) : "—"}${p.paid ? ` · paid ${money(p.paid)}` : ""}` : plan.kind === "attorney" ? p.attorney || "no attorney" : p.caseStatus) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasDate && (
        <label className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)]">{plan.kind === "status" ? (plan.status === "Discharged" ? "Discharge date" : "Date") : "Paid date"}</span>
          <input className="w-24 rounded border border-[var(--line-soft)] px-1 py-0.5" onChange={(e) => { const iso = usToIso(e.target.value); if (iso) setPlan((p) => ({ ...p, date: iso }) as typeof p); }} defaultValue={isoToUs((plan as { date: string }).date)} />
        </label>
      )}
      {plan.kind === "reduction" && <p className="text-[var(--text-muted)]">Asked {money(plan.asked)} · reduction {money(Math.max(0, plan.asked - (plan.rows[0]?.amount ?? 0)))} logged as a billing adjustment · status → Paid</p>}
      {(plan.kind === "markPaid" || plan.kind === "addPaid") && <p className="text-[var(--text-muted)]">Saves paid amount + date to billing, sets case status to Paid.</p>}
      {plan.kind === "attorney" && plan.attorneyChoices.length > 1 && (
        <select className="rounded border border-amber-400 bg-amber-50 px-1 py-0.5" onChange={(e) => setPlan((p) => ({ ...p, attorney: e.target.value, known: true }) as typeof p)} value={plan.attorney}>
          {!plan.known && <option value={plan.attorney}>{`Pick the attorney for "${plan.attorney}"…`}</option>}
          {plan.attorneyChoices.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}
      {signer && <p className="text-[11px] text-[var(--text-muted)]">A note signed as {signatureFor(signer).slice(1)} is added to each patient.</p>}
      <div className="flex flex-wrap gap-1.5">
        <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`} disabled={!ready.length || (plan.kind === "attorney" && plan.attorneyChoices.length > 1 && !plan.known)} onClick={() => onConfirm(plan, (text) => formatNote(text, signer, new Date()))} style={{ fontSize: 12 }} type="button">
          Confirm{ready.length !== plan.rows.length ? ` ${ready.length} of ${plan.rows.length}` : ""}
        </button>
        <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} onClick={onCancel} style={{ fontSize: 12 }} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ContactEditCard({ d, onChange, onConfirm, onCancel }: { d: NonNullable<ChatMessage["contactEdit"]>; onChange: (d: NonNullable<ChatMessage["contactEdit"]>) => void; onConfirm: (d: NonNullable<ChatMessage["contactEdit"]>) => void; onCancel: () => void }) {
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold";
  if (d.state === "saved") return <p className="mt-1.5 text-xs font-semibold text-emerald-700">✓ {d.result} · <Link className="text-[var(--brand-primary)] hover:underline" href="/contacts">Open Contacts ↗</Link></p>;
  if (d.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">No changes made.</p>;
  const field = (key: "name" | "phone" | "fax" | "email" | "address", lbl: string) => (
    <label className="grid grid-cols-[64px_1fr] items-center gap-1.5" key={key}>
      <span className="text-[11px] font-semibold text-[var(--text-muted)]">{lbl}</span>
      <input aria-label={lbl} className="min-w-0 rounded border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs" onChange={(e) => onChange({ ...d, [key]: e.target.value })} value={d[key]} />
    </label>
  );
  return (
    <div className="mt-2 space-y-1 text-xs" data-goat-contact-edit>
      {field("name", "Name")}
      <label className="grid grid-cols-[64px_1fr] items-center gap-1.5">
        <span className="text-[11px] font-semibold text-[var(--text-muted)]">Category</span>
        <select aria-label="Category" className="min-w-0 rounded border border-[var(--line-soft)] bg-white px-1 py-0.5 text-xs" onChange={(e) => onChange({ ...d, category: e.target.value })} value={d.category}>
          {CONTACT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      {field("phone", "Phone")}
      {field("fax", "Fax")}
      {field("email", "Email")}
      {field("address", "Address")}
      {d.result && <p className="text-[11px] text-amber-700">{d.result}</p>}
      <div className="flex gap-1.5 pt-0.5">
        <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`} onClick={() => onConfirm(d)} style={{ fontSize: 12 }} type="button">Confirm</button>
        <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} onClick={onCancel} style={{ fontSize: 12 }} type="button">Cancel</button>
      </div>
    </div>
  );
}

function ContactImportCard({ imp, onChange, onConfirm, onCancel, onUndo }: { imp: NonNullable<ChatMessage["contactImport"]>; onChange: (imp: NonNullable<ChatMessage["contactImport"]>) => void; onConfirm: (imp: NonNullable<ChatMessage["contactImport"]>) => void; onCancel: () => void; onUndo: () => void }) {
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold";
  const cell = "w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] hover:border-[var(--line-soft)] focus:border-[var(--brand-primary)] focus:bg-white focus:outline-none";
  const open = imp.state === "open";
  const setRow = (key: string, patch: Partial<(typeof imp.rows)[number]>) => onChange({ ...imp, rows: imp.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const checked = imp.rows.filter((r) => r.checked);
  const missingCat = checked.some((r) => !(r.category || imp.category));
  const badPhone = checked.some((r) => r.phone.replace(/\D/g, "").length !== 10 || !r.name.trim());
  if (imp.state === "saved" || imp.state === "undone") {
    return (
      <div className="mt-1.5 space-y-1 text-xs" data-goat-contacts-result>
        <p className={`font-semibold ${imp.state === "saved" ? "text-emerald-700" : "text-[var(--text-muted)]"}`}>{imp.state === "saved" ? "✓ " : ""}{imp.result}</p>
        {imp.state === "saved" && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Link className="text-[var(--brand-primary)] hover:underline" href="/contacts">Open Contacts ↗</Link>
            {(imp.addedIds?.length ?? 0) > 0 && <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} onClick={onUndo} style={{ fontSize: 12 }} type="button">Undo this import</button>}
          </div>
        )}
      </div>
    );
  }
  if (imp.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">Not added.</p>;
  return (
    <div className="mt-2 space-y-1.5 text-xs" data-goat-contacts>
      <label className="flex items-center gap-1.5">
        <span className="font-semibold">Category</span>
        <select className="rounded border border-[var(--line-soft)] bg-white px-1 py-0.5 text-xs" disabled={!open} onChange={(e) => onChange({ ...imp, category: e.target.value, categoryGuessed: false, rows: imp.rows.map((r) => ({ ...r, category: e.target.value })) })} value={imp.category}>
          <option value="">Choose…</option>
          {CONTACT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {imp.categoryGuessed && <span className="text-[11px] text-[var(--text-muted)]">guessed — please confirm</span>}
      </label>
      <div className="max-h-72 overflow-auto rounded-md border border-[var(--line-soft)] bg-white">
        <table className="w-full table-fixed border-collapse">
          <colgroup><col style={{ width: 24 }} /><col /><col style={{ width: 96 }} /><col /><col style={{ width: 92 }} /></colgroup>
          <thead className="sticky top-0 bg-[var(--bg-soft)] text-left text-[10px] uppercase text-[var(--text-muted)]">
            <tr>
              <th className="px-1 py-1"><input aria-label="Tick all" checked={checked.length === imp.rows.length} disabled={!open} onChange={(e) => onChange({ ...imp, rows: imp.rows.map((r) => ({ ...r, checked: e.target.checked })) })} type="checkbox" /></th>
              <th className="px-1 py-1">Name</th><th className="px-1 py-1">Phone</th><th className="px-1 py-1">Address</th><th className="px-1 py-1">Category</th>
            </tr>
          </thead>
          <tbody>
            {imp.rows.map((r) => (
              <tr className={`border-t border-[var(--line-soft)] align-top ${r.checked ? "" : "opacity-60"}`} key={r.key}>
                <td className="px-1 py-1"><input aria-label={`Add ${r.name}`} checked={r.checked} disabled={!open} onChange={(e) => setRow(r.key, { checked: e.target.checked })} type="checkbox" /></td>
                <td className="px-0.5 py-0.5">
                  <input aria-label="Name" className={cell} disabled={!open} onChange={(e) => setRow(r.key, { name: e.target.value })} value={r.name} />
                  {r.flag && <span className="block px-1 text-[10px] text-amber-700">{r.flag}</span>}
                  {(r.email || r.fax) && <span className="block truncate px-1 text-[10px] text-[var(--text-muted)]">{[r.email, r.fax && `fax ${r.fax}`].filter(Boolean).join(" · ")}</span>}
                </td>
                <td className="px-0.5 py-0.5"><input aria-label="Phone" className={cell} disabled={!open} onChange={(e) => setRow(r.key, { phone: e.target.value })} value={r.phone} /></td>
                <td className="px-0.5 py-0.5"><input aria-label="Address" className={cell} disabled={!open} onChange={(e) => setRow(r.key, { address: e.target.value })} title={r.address} value={r.address} /></td>
                <td className="px-0.5 py-0.5">
                  <select aria-label="Row category" className="w-full rounded border border-transparent bg-transparent text-[11px] hover:border-[var(--line-soft)]" disabled={!open} onChange={(e) => setRow(r.key, { category: e.target.value })} value={r.category || imp.category}>
                    <option value="">—</option>
                    {CONTACT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missingCat && <p className="text-[11px] text-amber-700">Pick a category before confirming.</p>}
      {!missingCat && badPhone && <p className="text-[11px] text-amber-700">Every ticked row needs a name and a 10-digit phone.</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white disabled:opacity-50`} disabled={!open || !checked.length || missingCat || badPhone} onClick={() => onConfirm(imp)} style={{ fontSize: 12 }} type="button">
          {imp.state === "saving" ? "Adding…" : `Add ${checked.length} contact${checked.length === 1 ? "" : "s"}`}
        </button>
        <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} disabled={!open} onClick={onCancel} style={{ fontSize: 12 }} type="button">Cancel</button>
        <span className="text-[11px] text-[var(--text-muted)]">{imp.rows.length - checked.length} will be skipped</span>
      </div>
    </div>
  );
}

function TodoCard({ draft, onConfirm, onCancel }: { draft: NonNullable<ChatMessage["todoDraft"]>; onConfirm: () => void; onCancel: () => void }) {
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold";
  const due = draft.dueDate ? `${draft.dueDate.slice(5, 7)}/${draft.dueDate.slice(8, 10)}/${draft.dueDate.slice(0, 4)}` : "no due date";
  if (draft.state === "saved") return <p className="mt-1.5 text-xs font-semibold text-emerald-700">✓ Added to To-Do · <Link className="text-[var(--brand-primary)] hover:underline" href="/tasks">Open To-Do ↗</Link></p>;
  if (draft.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">Not added.</p>;
  return (
    <div className="mt-2 space-y-1.5 text-xs" data-goat-todo>
      <p className="rounded-md bg-[#eef8fb] px-2 py-1"><span className="font-semibold">{draft.title}</span><br />Due: {due}{draft.patientName ? ` · Patient: ${draft.patientName}` : ""}</p>
      <div className="flex flex-wrap gap-1.5">
        <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`} onClick={onConfirm} style={{ fontSize: 12 }} type="button">Confirm</button>
        <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} onClick={onCancel} style={{ fontSize: 12 }} type="button">Cancel</button>
      </div>
    </div>
  );
}

function OmUndoCard({ undo, onConfirm, onCancel }: { undo: NonNullable<ChatMessage["omUndo"]>; onConfirm: () => void; onCancel: () => void }) {
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold";
  if (undo.state !== "open") return <p className={`mt-1.5 text-xs ${undo.state === "done" ? "font-semibold text-emerald-700" : "text-[var(--text-muted)]"}`}>{undo.result ?? "Kept as is."}</p>;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`} onClick={onConfirm} style={{ fontSize: 12 }} type="button">Confirm undo</button>
      <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} onClick={onCancel} style={{ fontSize: 12 }} type="button">Cancel</button>
    </div>
  );
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
  const doctors = officeSettings.doctors;
  useEffect(() => {
    // Doctors (Office Settings list) answer to "Dr. <First>" / "Dr. <Last>".
    onPeople(people.map((p) => ({ ...p, doctor: (doctors ?? []).some((d) => d.memberUserId === p.userId) })));
  }, [people, onPeople, doctors]);
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
  const [eyesOnly, setEyesOnly] = useState(false);
  const sig = signer ? signatureFor(signer) : "";
  const all = [{ label: draft.toLabel, userId: draft.toUserId }, ...(draft.alsoTo ?? [])];
  // No signature on messages (the author is shown); every recipient @mentioned.
  const body = `${all.map((p) => `@${p.label}`).join(" ")} ${draft.text.trim()}`;
  const allLabels = all.map((p) => p.label).join(" and ");
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold disabled:opacity-50";
  return (
    <div className="mt-2 space-y-1 text-xs" data-goat-message>
      <p>
        <span className="text-[var(--text-muted)]">To:</span> <strong>{all.map((p) => p.label).join(", ")}</strong>
      </p>
      <p>
        <span className="text-[var(--text-muted)]">Case:</span> {draft.caseLabel ?? "None (general message)"}
      </p>
      <p className="whitespace-pre-line rounded-md bg-[#eef8fb] px-2 py-1">{body}</p>
      <p className="text-[11px] text-[var(--text-muted)]">From: {sig ? sig.slice(1) : "you"}</p>
      {all.filter((p) => !p.userId).map((p) => <p className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-800" key={p.label}>{p.label} isn&apos;t linked to a login, so they won&apos;t get a notification. It still shows in Messages.</p>)}
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
              // Eyes only: just you and everyone @mentioned.
              privateTo: eyesOnly ? all.flatMap((p) => privateToFor("eyes-only", p.userId) ?? []) : privateToFor("general", draft.toUserId),
              authorLabel: isOwner ? (officeSettings.doctorName ?? "").trim() || "Admin" : getCurrentMembershipSync()?.label || "Team Member",
              patientId: draft.patientId,
              patientName: draft.caseLabel,
              // One message that notifies everyone @mentioned (same as the Messages composer).
              mentions: all.filter((p) => p.userId).map((p) => ({ userId: p.userId!, label: p.label })),
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
        <button
          aria-label={eyesOnly ? audienceLabel("eyes-only", allLabels) : "General (tap for Eyes only)"}
          aria-pressed={eyesOnly}
          className={`${btn} ${eyesOnly ? "border-amber-500 bg-amber-100 text-amber-900" : "border-[var(--line-soft)] bg-white text-[var(--text-muted)] opacity-70"}`}
          data-goat-eyes-only={eyesOnly ? "on" : "off"}
          disabled={sending || all.some((p) => !p.userId)}
          onClick={() => setEyesOnly((v) => !v)}
          style={{ fontSize: 12 }}
          title={!draft.toUserId ? `${draft.toLabel} has no login, so Eyes only isn't possible` : eyesOnly ? "Eyes only: just you and " + allLabels : "Posts to General. Tap for Eyes only"}
          type="button"
        >
          🔒{eyesOnly ? ` ${audienceLabel("eyes-only", allLabels)}` : ""}
        </button>
      </div>
    </div>
  );
}
