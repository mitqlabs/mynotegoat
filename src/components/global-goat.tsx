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
  type ChatPatient,
  type ChatState,
} from "@/lib/goat-ai/global-chat";
import { recFormatFromPrefs } from "@/lib/goat-answer-prefs";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { useGoatPatientContext } from "@/hooks/use-goat-patient-context";
import type { GoatFilesController } from "@/hooks/use-goat-files";
import { GoatAvatar } from "@/components/goat-avatar";
import { GoatStatusLine, PlusIntroCard, useGoatAiState, useSmartMode, type GoatStatus } from "@/components/goat-smart";
import { CopyButton } from "@/components/copy-button";
import { useGoatAnswerPrefs } from "@/hooks/use-goat-answer-prefs";
import { PLUS_NEEDED, PRACTICE_ANSWER_PROMPT, PRACTICE_HELP, SETTING_QUESTION, detectPracticeIntent, fallbackToolCalls, isPatientSpecific, parseToolCalls, runPracticeTool, toolPickPrompt, type PracticeData, type ToolResult } from "@/lib/goat-practice";
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
  return { id: p.id, fullName: p.fullName, dob: p.dob, dateOfLoss: p.dateOfLoss };
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
  smart: boolean;
  onPartial: (text: string) => void;
  onDone: (msg: Pick<ChatMessage, "text" | "quotes" | "warnings" | "ms" | "smart" | "copy">) => void;
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

function Answerer({ job, smart, onPartial, onDone, context, files }: AnswererProps & { context: GoatContext; files: GoatFilesController }) {
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
      if (smart) {
        try {
          // Rules first; + mode fills gaps in that same answer (one answer, regular format).
          // Its code (and the model) load only when + mode is on.
          const { assistGoat } = await import("@/lib/goat-ai/assist");
          const a = await assistGoat({ context: ctx, question: job.question, prefs, previous: job.previous, onText: onPartial, onStatus: onPartial });
          const r = ruleAnswerToMessage(a.result);
          const warnings = [...(r.warnings ?? []), ...a.warnings].slice(0, 3);
          onDone({ ...r, warnings: warnings.length ? warnings : undefined, ms: a.ms, smart: a.smartUsed });
          return;
        } catch {
          // fall through to normal G.O.A.T.
        }
      }
      const t1 = performance.now();
      const r = ruleAnswerToMessage(askGoat(ctx, job.question));
      onDone({ ...r, ms: performance.now() - t1, smart: false });
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
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [smartOn] = useSmartMode();
  const ai = useGoatAiState();
  const smartActive = smartOn && ai.status !== "unsupported" && ai.status !== "error";
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    saveChat(chat);
  }, [chat]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.messages.length, partial, open]);

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
    return {
      patients: allPatients().filter((p) => !(p as { deleted?: boolean }).deleted),
      tasks: loadTasks(),
      appointments: loadScheduleAppointments(),
      contacts: loadContactDirectory(),
      today: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    };
  };

  /**
   * + mode office question: the local model picks read-only tools, NoteGoat runs
   * them on this browser's data, then the model writes a natural answer from the
   * results (keeping the recent conversation for follow-ups).
   */
  const askPracticeModel = async (question: string) => {
    setPracticeBusy(true);
    setPartial("");
    const t0 = performance.now();
    const data = practiceData();
    let results: ToolResult[] = [];
    try {
      const { runGoatAi } = await import("@/lib/goat-ai/engine");
      const history = chat.messages.filter((m) => m.practice).slice(-6).map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.text }));
      const pick = await runGoatAi([{ role: "system", content: toolPickPrompt() }, ...history, { role: "user", content: question }], () => undefined, { maxTokens: 160 });
      let calls = parseToolCalls(pick.text);
      if (!calls || !calls.length) {
        if (calls === null) console.info("[goat+] tool pick wasn't valid JSON; using rules", pick.text.slice(0, 200));
        calls = fallbackToolCalls(question);
      }
      results = calls.map((c) => runPracticeTool(c, data));
      const choiceResult = results.find((r) => r.choices?.length);
      if (choiceResult) {
        push({ role: "goat", text: choiceResult.text, practice: true, choices: choiceResult.choices!.map((c) => ({ label: c.label, question: c.question })) });
        return;
      }
      const toolText = results.length ? results.map((r) => `[${r.name}]\n${r.text}`).join("\n\n") : "(no tool results)";
      const r = await runGoatAi(
        [{ role: "system", content: `${PRACTICE_ANSWER_PROMPT}\n\nTODAY: ${data.today}\n\nTOOL RESULTS:\n${toolText}` }, ...history, { role: "user", content: question }],
        (t) => setPartial(t),
        { maxTokens: 400 },
      );
      const links = results.flatMap((x) => x.links ?? []);
      push({ role: "goat", text: r.text.trim() || results.map((x) => x.text).join("\n") || PRACTICE_HELP, smart: true, practice: true, links: links.length ? links : undefined, ms: performance.now() - t0 });
    } catch (e) {
      console.error("[goat+] + mode office answer failed", e);
      const links = results.flatMap((x) => x.links ?? []);
      push({ role: "goat", text: results.map((x) => x.text).join("\n") || PRACTICE_HELP, practice: true, links: links.length ? links : undefined });
    } finally {
      setPartial("");
      setPracticeBusy(false);
    }
  };

  /** Office questions (to-do, schedule, cases, contacts, settings). True if handled. */
  const tryPractice = (question: string, confidentPatient: boolean): boolean => {
    const intent = detectPracticeIntent(question);
    const setting = SETTING_QUESTION.test(question);
    if (!intent && !setting) return false;
    if (confidentPatient && intent?.kind !== "contact" && !setting) return false;
    push({ role: "user", text: question, practice: true });
    // Regular G.O.A.T. is for patient questions only: office questions are a + mode feature.
    if (!smartActive) push({ role: "goat", text: PLUS_NEEDED, practice: true, plusLink: true });
    else void askPracticeModel(question);
    return true;
  };

  const send = (raw: string) => {
    const question = raw.trim();
    if (!question || job || practiceBusy) return;
    setInput("");
    const people = allPatients().map(toChatPatient);
    const found = findPatientsInQuestion(question, people);
    const waitingForName = waitingQuestion();
    if (!(waitingForName && found.named) && tryPractice(question, Boolean(found.confident))) return;
    // + mode: anything not clearly about a patient is an office question for the model (follow-ups included).
    if (smartActive && !found.confident && !found.candidates.length && !found.named && !isPatientSpecific(question) && !waitingForName) {
      push({ role: "user", text: question, practice: true });
      void askPracticeModel(question);
      return;
    }
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
        choices: found.candidates.map((c) => ({ patientId: c.patient.id, label: choiceLabel(c.patient) })),
        pendingQuestion: original,
      });
      return;
    }
    if (found.named) {
      push({ role: "goat", text: `I couldn't find a patient named "${found.named}" in the patient list. Type their name and I'll answer "${original}".`, pendingQuestion: original });
      return;
    }
    // No name: stay on the chat's patient, else the patient page that's open.
    const p = current ?? patientById(openPatientId);
    if (!p) {
      // Only ask "which patient" when the question is clearly about one; otherwise say what G.O.A.T. can answer.
      if (isPatientSpecific(question)) push({ role: "goat", text: "Which patient is this about? Type their name and I'll answer it.", pendingQuestion: question });
      else push({ role: "goat", text: smartActive ? PRACTICE_HELP : PLUS_NEEDED, practice: true, plusLink: !smartActive });
      return;
    }
    startAnswer(p, question, Boolean(current));
  };

  // A tapped patient answers the ORIGINAL question; nothing needs retyping.
  const pick = (msg: ChatMessage, patientId: string | undefined, question?: string) => {
    if (question) {
      setChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === msg.id ? { ...m, choices: undefined } : m)) }));
      send(question);
      return;
    }
    const p = patientById(patientId ?? null);
    if (!p || job) return;
    push({ role: "user", text: displayName(p.fullName) });
    setChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === msg.id ? { ...m, choices: undefined, pendingQuestion: undefined } : m)) }));
    startAnswer(p, msg.pendingQuestion ?? "", false);
  };

  // Plain functions: they only touch refs and functional state updates, so a stale copy is fine.
  const onPartial = (t: string) => setPartial(t);
  const onDone = (m: Pick<ChatMessage, "text" | "quotes" | "warnings" | "ms" | "smart" | "copy">) => {
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
    ? smartActive && ai.status === "loading"
      ? "plus"
      : "searching"
    : !lastGoat || lastGoat.choices || lastGoat.pendingQuestion
      ? "ready"
      : /^I couldn't find/.test(lastGoat.text) || lastGoat.text === PRACTICE_HELP || lastGoat.text === PLUS_NEEDED
        ? "notFound"
        : "found";

  if (!canView("patients")) return null;
  return (
    <>
      {jobPatient && job && (contextOverride ? (
        <Answerer context={contextOverride(jobPatient.id)!} files={NO_FILES} job={job} onDone={onDone} onPartial={onPartial} patient={jobPatient} smart={smartActive} />
      ) : (
        <PatientAnswerer job={job} onDone={onDone} onPartial={onPartial} patient={jobPatient} smart={smartActive} />
      ))}
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
                G.O.A.T. <GoatStatusLine ai={ai} className="font-medium text-white/95" status={status} />
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
            <PlusIntroCard />
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
                    {m.plusLink && (
                      <Link className="mt-1 inline-block font-semibold text-[var(--brand-primary)] hover:underline" href="/settings/goat" style={{ fontSize: 13 }}>
                        Turn on + mode in G.O.A.T. Settings
                      </Link>
                    )}
                    {m.choices && (
                      <div className="mt-2 space-y-1.5">
                        {m.choices.map((c) => (
                          <button style={{ fontSize: 12 }}
                            key={c.patientId ?? c.label}
                            className="block w-full rounded-xl border border-[#72bdcf] bg-[#eef8fb] px-2.5 py-1.5 text-left text-xs font-semibold hover:bg-[#dff1f6] disabled:opacity-50"
                            disabled={Boolean(job) || practiceBusy}
                            onClick={() => pick(m, c.patientId, c.question)}
                            type="button"
                          >
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
                          {m.smart ? "+ mode helped · check the sources" : "From NoteGoat"}
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
                      {smartActive && ai.status === "loading" ? `Getting + mode ready… ${Math.round(ai.progress * 100)}%` : "Searching…"}
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
