"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { patients as patientList, type PatientRecord } from "@/lib/mock-data";
import { askGoat, type GoatContext, type GoatResult } from "@/lib/goat";
import { GOAT_SMART_AVAILABLE } from "@/lib/goat-ai/flag";
import { answerSmart } from "@/lib/goat-ai/answer";
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
import { useGoatPatientContext } from "@/hooks/use-goat-patient-context";
import type { GoatFilesController } from "@/hooks/use-goat-files";
import { GoatAvatar } from "@/components/goat-avatar";
import { SmartModeControl, Spinner, useGoatAiState, useSmartMode } from "@/components/goat-smart";
import { useGoatAnswerPrefs } from "@/hooks/use-goat-answer-prefs";

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
  if (!GOAT_SMART_AVAILABLE) return null;
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

function ruleAnswerToMessage(result: GoatResult): Pick<ChatMessage, "text" | "quotes" | "warnings"> {
  const parts: string[] = [];
  for (const a of result.answers) {
    const lines = [...a.lines];
    for (const g of a.groups ?? []) {
      lines.push(g.lead);
      for (const b of g.blocks) {
        if (b.heading) lines.push(`${b.heading}:`);
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
  return {
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
  onDone: (msg: Pick<ChatMessage, "text" | "quotes" | "warnings" | "ms" | "smart">) => void;
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
      const ctx = ctxRef.current;
      if (smart) {
        try {
          const a = await answerSmart({ context: ctx, question: job.question, prefs, previous: job.previous, onText: onPartial });
          const warnings = [
            ...a.check.mismatches.map((m) => `Double-check: ${m}`),
            ...(a.check.unverified.length ? [`Couldn't find ${a.check.unverified.map((n) => `"${n}"`).join(", ")} in the sources. Check before using.`] : []),
          ];
          onDone({
            text: a.text,
            quotes: a.check.supports.map((s) => ({ title: s.title, page: s.page, quote: s.quote })),
            warnings: warnings.length ? warnings : undefined,
            ms: a.ms,
            smart: !a.skipped,
          });
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
  contextOverride,
}: {
  /** Test harness only: a fixed patient list and contexts instead of the workspace's. */
  patientsOverride?: PatientRecord[];
  contextOverride?: (patientId: string) => GoatContext | null;
} = {}) {
  const open = useGlobalGoatOpen();
  const pathname = usePathname();
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
  const [smartOn, setSmartOn] = useSmartMode();
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

  const send = (raw: string) => {
    const question = raw.trim();
    if (!question || job) return;
    setInput("");
    push({ role: "user", text: question });
    const people = allPatients().map(toChatPatient);
    const found = findPatientsInQuestion(question, people);
    if (found.named && !found.matches.length) {
      push({ role: "goat", text: `I couldn't find a patient named "${found.named}" in the patient list.` });
      return;
    }
    if (found.matches.length > 1) {
      push({
        role: "goat",
        text: `There are ${found.matches.length} patients named ${displayName(found.matches[0].fullName)}. Which one?`,
        choices: found.matches.map((p) => ({ patientId: p.id, label: choiceLabel(p) })),
        pendingQuestion: question,
      });
      return;
    }
    if (found.matches.length === 1) {
      const p = patientById(found.matches[0].id);
      if (p) startAnswer(p, question, p.id === chat.patientId);
      return;
    }
    // No name: stay on the chat's patient, else the patient page that's open.
    const p = current ?? patientById(openPatientId);
    if (!p) {
      push({ role: "goat", text: "Which patient is this about? Include their name, e.g. \"what did Dr. Armen recommend for John Smith?\"" });
      return;
    }
    startAnswer(p, question, Boolean(current));
  };

  const pick = (msg: ChatMessage, patientId: string) => {
    const p = patientById(patientId);
    if (!p || job) return;
    push({ role: "user", text: choiceLabel(toChatPatient(p)) });
    setChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === msg.id ? { ...m, choices: undefined } : m)) }));
    startAnswer(p, msg.pendingQuestion ?? "", false);
  };

  // Plain functions: they only touch refs and functional state updates, so a stale copy is fine.
  const onPartial = (t: string) => setPartial(t);
  const onDone = (m: Pick<ChatMessage, "text" | "quotes" | "warnings" | "ms" | "smart">) => {
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

  if (!GOAT_SMART_AVAILABLE) return null;
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
              <div className="text-lg font-semibold leading-tight">G.O.A.T.</div>
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
            <button
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
                  Hi! Ask me about a patient, like &ldquo;what did Dr. Armen recommend for John Smith?&rdquo; I only read NoteGoat, right here on
                  this computer. Nothing is sent anywhere.
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
                    {m.choices && (
                      <div className="mt-2 space-y-1.5">
                        {m.choices.map((c) => (
                          <button
                            key={c.patientId}
                            className="block w-full rounded-xl border border-[#72bdcf] bg-[#eef8fb] px-2.5 py-1.5 text-left text-xs font-semibold hover:bg-[#dff1f6] disabled:opacity-50"
                            disabled={Boolean(job)}
                            onClick={() => pick(m, c.patientId)}
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
                      <details className="mt-1.5 text-xs">
                        <summary className="cursor-pointer font-semibold text-[var(--text-muted)]">Sources ({m.quotes.length})</summary>
                        <ul className="mt-1 space-y-1">
                          {m.quotes.map((q, i) => (
                            <li key={i}>
                              <span className="font-semibold">{q.title}</span>
                              {q.page ? <span className="text-[var(--text-muted)]"> p.{q.page}</span> : null}: &ldquo;{q.quote}&rdquo;
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {m.patientId && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                        <span>{m.smart ? "Smart answer (beta) · check the sources" : "From NoteGoat"}</span>
                        <Link className="font-semibold text-[var(--brand-primary)] hover:underline" href={`/patients/${encodeURIComponent(m.patientId)}`} target="_blank">
                          Open patient file ↗
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
            {job && (
              <div className="flex gap-2">
                <GoatAvatar size={28} />
                <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-sm">
                  {jobPatient && <div className="mb-0.5 text-[11px] font-semibold text-[#2f7f93]">{displayName(jobPatient.fullName)}</div>}
                  {partial ? (
                    <div className="whitespace-pre-line leading-snug">
                      {partial}
                      <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[#72bdcf] align-[-2px]" />
                    </div>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                      <Spinner /> {smartActive && ai.status === "loading" ? "Getting Smart mode ready…" : "Searching…"}
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
                placeholder={current ? `Ask about ${displayName(current.fullName)}…` : "Ask about a patient…"}
                value={input}
              />
              <button className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={!input.trim() || Boolean(job)} type="submit">
                Ask
              </button>
            </form>
            <SmartModeControl on={smartOn} setOn={setSmartOn} />
          </div>
        </section>
      )}
    </>
  );
}
