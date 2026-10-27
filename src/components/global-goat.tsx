"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { HOWTO_QUESTION, dayLabel, isBookingRequest } from "@/lib/goat-howto";
import { clarifyIntent } from "@/lib/goat-schedule-query";
import { answerHowToFull } from "@/lib/goat-howto-handbook";
import { PRACTICE_HELP, isPatientSpecific, isPracticeWide, yearOfDate, type PracticeData } from "@/lib/goat-practice";
import { buildInitialExamIndex, patientInitialExamIso } from "@/lib/initial-exam-date";
import { answerOffice, type OfficeMemory } from "@/lib/goat-office";
import { bookingRecord, draftSummary, finishDraft, planBooking, retime } from "@/lib/goat-booking";
import { loadScheduleSettings } from "@/lib/schedule-settings";
import { createAppointmentId, parseTimeFlexible } from "@/lib/schedule-appointments";
import { continueNewPatientBooking, startNewPatientBooking, type NewPatientCtx, type NewPatientStep } from "@/lib/goat-new-patient-booking";
import { loadAppointmentTypes } from "@/lib/schedule-appointment-types";
import { createPatientRecord } from "@/lib/mock-data";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { to12hLabel } from "@/lib/time-12h";
import { LAST_SIGNER_KEY, appendNote, defaultSigner, formatNote, isAddNoteRequest, loadSigners, matchPatientsByName, parseAddNote, signatureFor, signerFromLogin, stripNameTokens, type NoteSigner } from "@/lib/goat-notes";
import { expandFollowUp } from "@/lib/goat-followup";
import { buildTeam, isTellRequest, matchRecipient, parseTell, audienceLabel, privateToFor, type TeamPerson } from "@/lib/goat-message";
import { filterMentionPeople, mentionInsert, mentionQueryAt, parseMentions } from "@/lib/goat-mentions";
import { patientsMentionedInMessage } from "@/lib/goat-message";
import { dismissNudge, readDismissed, readRecall, recallLine, saveRecall } from "@/lib/goat-recall";
import { detectCorrection, findDate, findTime, normalizeForIntent, GOAT_ACTIONS, nameParts, phraseTemplate, understand, type ActionId, type Understood } from "@/lib/goat-understand";
import { planQuick, type QuickPlan } from "@/lib/goat-quick";
import { learnedMap, loadLearned, safeTemplate, saveLearned, withMiss, withPhrase } from "@/lib/goat-learned";
import { updatePatientRecordById } from "@/lib/mock-data";
import { cardDate, carryPatient, dailyBrief, normalizeCasual, nudges, splitSteps } from "@/lib/goat-assistant";
import { categoryPlural, clarifyFor, correctionReply, editNoteLine, followUpFor, importUndoText, recatAsk, recatConfirmText, withNoteDate, withNoteText, type LastAct } from "@/lib/goat-memory";
import { isClearFileQuestion } from "@/lib/goat-dialog";
import { canonicalBooking, canonicalTell, clarifyForPatient, isAddNote, isBooking, isTell } from "@/lib/goat-commands";
import { emptyDialog, goatTurn, type DialogState } from "@/lib/goat-dialog";
import { activeFirst, isActiveCase } from "@/lib/patient-name-match";
import { resolveSlashTodo } from "@/lib/goat-todo-resolve";
import { useWorkspacePeople, type WorkspacePerson } from "@/hooks/use-workspace-people";
import { useWorkspaceMessages } from "@/hooks/use-workspace-messages";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { caseNumberOf } from "@/lib/follow-up-queue";
import { getCaseNote, setCaseNote, STORAGE_KEY_CASE_NOTES } from "@/lib/case-notes";
import { notifyChange } from "@/lib/local-sync";
import { getCurrentMembershipSync } from "@/lib/workspace-membership";
import { loadTasks } from "@/lib/tasks";
import { clearedIdSet, taskClearId } from "@/lib/cleared-tasks";
import { caseReviewAnswer, detectPipeline, detectReview, pipelineAnswer, type PipelineKind, type ReviewAsk } from "@/lib/goat-pipeline";
import { buildFollowUpItems } from "@/lib/follow-up-queue";
import { caseFlowOptions } from "@/lib/case-flow-options";
import { loadDashboardWorkspaceSettings } from "@/lib/dashboard-workspace-settings";
import { loadCaseStatuses } from "@/lib/case-statuses";
import { loadPatientFollowUpOverridesMap } from "@/lib/patient-follow-up-overrides";
import { loadScheduleAppointments } from "@/lib/schedule-appointments";
import { loadContactDirectory } from "@/lib/contact-directory";
import { TEAM, caseQuestion, parseTeamMessage, type TeamMessageRequest } from "@/lib/goat-team-message";
import { GOAT_APP_PATH, GOAT_INSTALL_TIP_KEY, goatQueryPrefill, installTipKind, isStandalone } from "@/lib/goat-app";
import { isNoPatientName, pickTodoPatient, todoTitleForPagePatient, detectNewPatientRequest, detectNewVisitBooking, detectPlainTodo, findTodoPhone, newPatientIntakeText, newVisitBookingText, scheduleSlashToBooking, stashNewAppointmentPrefill } from "@/lib/goat-intents";
import { parseIntakeText, stashNewPatientPrefill, type IntakeDraft } from "@/lib/new-patient-intake";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { batchCategory, buildImportRows, categoryFromRequest, looksLikeContactPaste, parseContactPaste } from "@/lib/goat-contacts-import";
import { breaksFlow, continueFlow, isFlowToken, startFlow, type FlowCtx, type FlowTurn, type Pending } from "@/lib/goat-slash-flow";
import { GOAT_HANDBOOK_ANCHOR, goatHelpText, isGoatHelpQuestion } from "@/lib/handbook-goat";
import { CONTACT_CATEGORIES, type ContactCategory } from "@/lib/mock-data";
import { omTurn, planChanges, emptyOmMemory, isoToUs, usToIso, money, type OmMemory, type OmPlan, type OmData } from "@/lib/goat-om";
import { applyOmChanges, buildOmData, restoreOmSnapshot, snapshotFor } from "@/lib/goat-om-apply";
import { loadEncounterNoteRecords } from "@/lib/encounter-notes";
import { parseViewTarget, viewMatches, viewMessages, viewQuery, viewSchedule, viewTargetsFor, viewTodos, type ViewTarget, briefName, splitLinks } from "@/lib/goat-briefs";
import { isOfficeStatsQuestion, parseTimeframeReply } from "@/lib/goat-appt-stats";
import { adminStatsGate, isStatsOfficeKind } from "@/lib/goat-briefs";
import { ADMIN_ONLY_REPLY, CHIPS, appointmentCheck, briefAllowed, chipsFor, detectBrief, greetingFor, quickBiz, morningRundown, noteWording, parseSlash, parseTodo, slashMatches, takeDueDate, slashQuery, type BriefData } from "@/lib/goat-briefs";
import { useTasks } from "@/hooks/use-tasks";
import { useUnreadMessages } from "@/hooks/use-unread-messages";
import { useFormRequests } from "@/hooks/use-form-requests";
import { loadOfficeSettings } from "@/lib/office-settings";
import { loadPatientBillingMap } from "@/lib/patient-billing";

// Open/closed store + nav button live in a tiny module so the shell can
// render the button without downloading all of G.O.A.T. up front.
import { setGlobalGoatOpen, takePendingAsk, useGlobalGoatOpen } from "@/components/global-goat-button";
import { appConfirm } from "@/components/app-dialog";

export { askGlobalGoat, GlobalGoatButton, setGlobalGoatOpen } from "@/components/global-goat-button";

// ---------------------------------------------------------------------------
// Answers as chat text
// ---------------------------------------------------------------------------

function ruleAnswerToMessage(result: GoatResult): Pick<ChatMessage, "text" | "quotes" | "warnings" | "copy" | "originals"> {
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
  const originals = result.answers.flatMap((a) => (a.groups ?? []).filter((g) => g.original).map((g) => ({ label: `${g.lead}`.replace(/:$/, ""), text: g.original! })));
  return {
    copy,
    ...(originals.length ? { originals } : {}),
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
  onDone: (msg: Pick<ChatMessage, "text" | "quotes" | "warnings" | "ms" | "copy" | "originals">) => void;
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
        originals: answers.some((a) => a.originals?.length) ? answers.flatMap((a) => a.originals ?? []) : undefined,
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

/** A team message waiting on a step (who / what / which case). */
type TellPending = {
  req: TeamMessageRequest;
  stage: "to" | "text" | "case" | "caseName";
  /** undefined = not resolved yet; null = the whole team (General). */
  to?: { label: string; userId?: string } | null;
  options?: TeamPerson[];
  /** undefined = not asked yet; null = no case. */
  patientId?: string | null;
};
const TELL_TOKEN = "/:tm:";

/** Chrome/Android's install event (not in the DOM typings). */
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const ShareIcon = () => (
  <svg aria-label="Share" className="inline h-4 w-4 align-[-3px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
    <path d="M12 3v12M8 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" strokeLinecap="round" />
  </svg>
);
const AddBoxIcon = () => (
  <svg aria-label="Add to Home Screen" className="inline h-4 w-4 align-[-3px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
    <rect height="16" rx="3" width="16" x="4" y="4" />
    <path d="M12 8v8M8 12h8" strokeLinecap="round" />
  </svg>
);

/** Small, dismissible "put G.O.A.T. on your Home Screen" hint at the top of the chat. */
function InstallTip({ kind, onDismiss, onInstall, onGoatPage }: { kind: "ios" | "android"; onDismiss: () => void; onInstall: () => void; onGoatPage: boolean }) {
  return (
    <div className="flex items-start gap-2 border-b border-[var(--line-soft)] bg-[#eef8fb] px-3 py-2 text-xs text-[var(--text-main)]" data-goat-install={kind} role="note">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="" className="h-8 w-8 shrink-0 rounded-lg" height={32} src="/goat-app/icon-192.png" width={32} />
      <div className="min-w-0 flex-1 leading-snug">
        {kind === "ios" ? (
          <>
            <strong>Add G.O.A.T. to your Home Screen:</strong>{" "}
            {onGoatPage ? null : (
              <>
                open the <Link className="font-semibold text-[var(--brand-primary)] underline" href="/goat">G.O.A.T. app page</Link>, then{" "}
              </>
            )}
            tap Share <ShareIcon />, then Add to Home Screen <AddBoxIcon />.
          </>
        ) : (
          <>
            <strong>Install G.O.A.T.</strong> as an app on this device — opens straight to the chat.
            <button className="ml-2 rounded-md bg-[var(--brand-primary)] px-2 py-0.5 font-semibold text-white" onClick={onInstall} type="button">
              Install
            </button>
          </>
        )}
      </div>
      <button aria-label="Dismiss install tip" className="shrink-0 rounded px-1 text-base leading-none text-[var(--text-muted)] hover:bg-white" onClick={onDismiss} type="button">
        ×
      </button>
    </div>
  );
}

export function GlobalGoatPopup({
  patientsOverride,
  practiceOverride,
  contextOverride,
  fullScreen = false,
}: {
  /** The /goat home-screen app: always open, fills the screen, no site nav. */
  fullScreen?: boolean;
  /** Test harness only: a fixed patient list and contexts instead of the workspace's. */
  patientsOverride?: PatientRecord[];
  /** Test harness only: office data instead of this browser's stores. */
  practiceOverride?: () => PracticeData;
  contextOverride?: (patientId: string) => GoatContext | null;
} = {}) {
  const popupOpen = useGlobalGoatOpen();
  const open = popupOpen || fullScreen;
  const pathname = usePathname();
  const { canView } = useWorkspaceAccess();
  // Read once on the client; the popup only renders after a click, so there's no hydration mismatch.
  const [chat, setChat] = useState<ChatState>(() => loadChat());
  // /goat?q=… prefills the box (the user still taps Send). The portal only renders after auth on the client, so no SSR mismatch.
  const [input, setInput] = useState(() => (fullScreen && typeof window !== "undefined" ? goatQueryPrefill(window.location.search) : ""));
  // Home-screen install hint: iPhone Safari → Share → Add to Home Screen tip; Android/Chrome → a real Install button.
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(GOAT_INSTALL_TIP_KEY) === "dismissed";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const dismissInstallTip = () => {
    setInstallDismissed(true);
    try {
      // A "user" key: mirrored to the user's cloud prefs row, so it stays dismissed on every device.
      window.localStorage.setItem(GOAT_INSTALL_TIP_KEY, "dismissed");
    } catch {
      /* storage full: hidden for this session */
    }
  };
  const [job, setJobState] = useState<Job | null>(null);
  const jobRef = useRef<Job | null>(null);
  const setJob = useCallback((j: Job | null) => {
    jobRef.current = j;
    setJobState(j);
  }, []);
  const [partial, setPartial] = useState("");
  const practiceBusy = false;
  const { addAppointments, removeAppointment, updateAppointment } = useScheduleAppointments();
  const { addTask, tasks: openTaskRows } = useTasks();
  const { roleTier, roleKnown } = useWorkspaceAccess();
  /** Owner/admin: sees Appointment Check + Quick Biz. Fail closed: unknown/loading role = not admin. */
  const isGoatAdmin = roleKnown && isAdminTier(roleTier);
  /** Null when office stats are allowed, else the reply to give. */
  const statsGate = () => adminStatsGate(roleKnown, isAdminTier(roleTier));
  const { addContactsBulk, removeContactsByIds, updateContact } = useContactDirectory();
  /** The step a "/" command flow is waiting on (case pick, note text…). */
  const flowRef = useRef<Pending | null>(null);
  /** Set right before G.O.A.T. re-sends a message in its canonical wording (so it isn't re-read). */
  const understoodRef = useRef(false);
  /** One short question is waiting for a missing detail of this message. */
  const askRef = useRef<{ raw: string } | null>(null);
  /** Contact imports being saved (message ids). */
  const importingRef = useRef(new Set<string>());
  const unreadMessages = useUnreadMessages();
  // Questionnaires received, not reviewed yet (Morning Rundown line).
  const { rows: receivedForms } = useFormRequests({ awaitingReview: true }, !practiceOverride);
  // Shown under the greeting until the first message; computed when the popup opens.
  const [greeting] = useState(() => greetingFor(new Date().getHours()));
  // Dismissed nudges: this chat session only (nothing saved, so nothing is browser-only).
  // Hidden heads-ups are a cloud-backed user pref (casemate.goat-nudges-dismissed.v1).
  const [dismissedNudges, setDismissedNudges] = useState<string[]>(() => Object.keys(readDismissed()));
  const [showNudges, setShowNudges] = useState(false);
  // "Hide brief": a per-person setting backed up to the user's cloud prefs.
  const [briefHidden, setBriefHidden] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("casemate.goat-brief-hidden.v1") === "1");
  const toggleBrief = () => {
    const next = !briefHidden;
    setBriefHidden(next);
    try {
      window.localStorage.setItem("casemate.goat-brief-hidden.v1", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
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
  const formRouter = useRouter();
  const tellRef = useRef<TellPending | null>(null);
  const patientById = (id: string | null) => findPatient(patientsOverride, id);
  const current = patientById(chat.patientId);
  /** Who "his/her/them" means: the patient carried from earlier in this message, this chat's patient, the last one mentioned, else last session's. */
  const carryRef = useRef<{ id: string; until: number } | null>(null);
  const contextPatient = (): PatientRecord | null => {
    const carried = carryRef.current && carryRef.current.until > Date.now() ? patientById(carryRef.current.id) : null;
    if (carried) return carried;
    if (current) return current;
    const lastMentioned = [...chat.messages].reverse().find((m) => m.patientId)?.patientId ?? null;
    return patientById(lastMentioned) ?? patientById(readRecall()?.patientId ?? null) ?? null;
  };

  const push = useCallback((m0: Omit<ChatMessage, "id" | "at">, patientId?: string | null) => {
    let m = m0;
    if (m.role === "user" && shownAsRef.current) {
      m = { ...m, text: shownAsRef.current };
      shownAsRef.current = null;
    }
    setChat((c) => ({ messages: [...c.messages, { ...m, id: newId(), at: nowIso() }], patientId: patientId === undefined ? c.patientId : patientId }));
    // Cross-session memory (cloud-backed user pref): the last patient + action.
    const rec = m.booking?.patientId
      ? { patientId: m.booking.patientId, patientName: m.booking.patientName, action: "visit booking" }
      : m.todoDraft?.patientId && m.todoDraft.patientName
        ? { patientId: m.todoDraft.patientId, patientName: m.todoDraft.patientName, action: "to-do" }
        : m.noteDraft?.patientId
          ? { patientId: m.noteDraft.patientId, patientName: m.noteDraft.patientName, action: "notes" }
          : null;
    if (rec) saveRecall(rec);
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
    saveRecall({ patientId: patient.id, patientName: patient.fullName, action: "file" });
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
    const listYear = (p: PatientRecord) => yearOfDate(p.matrix?.initialExam?.trim() ? p.matrix.initialExam : patientInitialExamIso(p, index)) || yearOfDate(p.dateOfLoss) || yearOfDate(p.lastUpdate ?? "");
    return {
      patients: allPatients().filter((p) => !(p as { deleted?: boolean }).deleted).map((p) => ({ ...p, listYear: listYear(p), cash: Boolean(p.isCashPatient) })),
      // Cleared ("Clear task") to-dos never show in G.O.A.T.
      tasks: (() => { const c = clearedIdSet(); return loadTasks().filter((t) => !c.has(taskClearId(t.id))); })(),
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
    const gate = isStatsOfficeKind(ans.memory?.kind) ? statsGate() : null;
    if (gate) {
      push({ role: "goat", text: gate, practice: true });
      return true;
    }
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
      push({ role: "goat", text: `What day should I book ${name}? (e.g. "Thursday at 3" or "10/20 9:30am")`, patientName: name, bookingAsk: { patientId: patient.id, question }, formLaunch: { kind: "newAppointment", label: "Or open New Appointment", patientId: patient.id } });
      return;
    }
    if (step.kind === "needTime") {
      push({ role: "goat", text: `What time on ${dayLabel(step.date)} for ${name}? (e.g. "3" or "9:30am")`, patientName: name, bookingAsk: { patientId: patient.id, question }, formLaunch: { kind: "newAppointment", label: "Or open New Appointment", patientId: patient.id, date: step.date } });
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
    let draftForRecord = { ...fresh, override };
    const np = b.newPatient;
    if (np) {
      // Same as the New Patient popup: add the patient (cloud-saved by the patients store), then book.
      // Saved twice? The patient id is remembered on the card, so no duplicate patient or visit.
      let pid = np.patientId;
      if (!pid) {
        const created = createPatientRecord({ firstName: np.firstName, lastName: np.lastName, phone: np.phone || undefined, dateOfLoss: "" });
        if (!created) {
          push({ role: "goat", text: "I couldn't add the new patient. Nothing was saved. Try Edit in New Appointment.", practice: true });
          return;
        }
        pid = created.id;
        updateBooking(msg.id, { ...b, newPatient: { ...np, patientId: pid } });
      }
      draftForRecord = { ...draftForRecord, patientId: pid, patientName: patientById(pid)?.fullName ?? draftForRecord.patientName };
    }
    const base = bookingRecord(draftForRecord, createAppointmentId(), data.appointments);
    const record = np ? { ...base, provider: base.provider || np.provider, location: base.location || np.location } : base;
    addAppointments([record]);
    // "make it 2pm instead" after it was booked: the new time replaces the old appointment.
    if (b.replacesId) removeAppointment(b.replacesId);
    updateBooking(msg.id, { ...draftForRecord, override, state: "booked", appointmentId: record.id, replacesId: b.replacesId, newPatient: np ? { ...np, patientId: record.patientId } : undefined });
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
      if (m.contactRecat) {
        if (m.contactRecat.state === "done" && m.contactRecat.mode === "recat") return { kind: "contactImport", msgId: m.contactRecat.importMsgId, ids: m.contactRecat.ids, category: m.contactRecat.to };
        if (m.contactRecat.state === "done") return null;
        continue;
      }
      if (m.contactImport) return m.contactImport.state === "saved" && m.contactImport.addedIds?.length ? { kind: "contactImport", msgId: m.id, ids: m.contactImport.addedIds, category: m.contactImport.rows.find((r) => r.checked)?.category || m.contactImport.category } : null;
      if (m.todoDraft) return m.todoDraft.state === "saved" ? { kind: "todo", msgId: m.id, title: m.todoDraft.title } : null;
    }
    return null;
  };

  /** Act on a follow-up to the last action. True if handled. */
  const tryFollowUp = (question: string): boolean => {
    const last = lastAct();
    const fixAsk = /^fix the (time|recipient|to-do)$/i.exec(question.trim());
    if (fixAsk && last) {
      push({ role: "user", text: question, practice: true });
      const say = fixAsk[1] === "time" ? `Sure — what time works better?` : fixAsk[1] === "recipient" ? `No problem — who should get it?` : "You can change or remove it in To-Do.";
      push({ role: "goat", text: say, practice: true, links: fixAsk[1] === "to-do" ? [{ label: "Open To-Do", href: "/patients?view=toDo" }] : undefined });
      return true;
    }
    const f = followUpFor(question, last, practiceData().today);
    if (!f || !last) return false;
    push({ role: "user", text: question, practice: true });
    if (f.kind === "leave") {
      push({ role: "goat", text: "Okay, I'll leave it as is.", practice: true });
      return true;
    }
    if (f.kind === "correct") {
      const r = correctionReply(last);
      push({ role: "goat", text: r.say, practice: true, choices: r.choices });
      return true;
    }
    if (last.kind === "contactImport" && (f.kind === "importRecat" || f.kind === "importUndo")) {
      if (f.kind === "importUndo") {
        push({ role: "goat", text: importUndoText(last.ids.length), practice: true, contactRecat: { importMsgId: last.msgId, ids: last.ids, from: last.category, to: "", mode: "undo", state: "open" } });
        return true;
      }
      if (!f.to) {
        const names = loadContactDirectory().filter((c) => last.ids.includes(c.id)).map((c) => ({ name: c.name }));
        const r = recatAsk(last, f.noSuggest ? "" : batchCategory(names), CONTACT_CATEGORIES);
        push({ role: "goat", text: r.say, practice: true, choices: r.choices });
        return true;
      }
      push({ role: "goat", text: recatConfirmText(last.ids.length, last.category, f.to), practice: true, contactRecat: { importMsgId: last.msgId, ids: last.ids, from: last.category, to: f.to, mode: "recat", state: "open" } });
      return true;
    }
    if (f.kind === "importRecat" || f.kind === "importUndo") return true;
    if (last.kind !== "note" && /^fix the (time|recipient|to-do)$/i.test(question.trim())) return true;
    if (last.kind === "note" && /^fix the note$/i.test(question.trim())) {
      push({ role: "goat", text: `Sure — what should it say? Or tell me the right date, like "it was yesterday".`, practice: true });
      return true;
    }
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
    // Money / case-list answers are office stats: admins only (fail closed).
    const gate = r.kind === "answer" ? statsGate() : null;
    if (gate) push({ role: "goat", text: gate, practice: true });
    else if (r.kind === "answer") push({ role: "goat", text: r.text, practice: true, omListed: r.listed });
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
    const index = buildInitialExamIndex(d.appointments, loadEncounterNoteRecords());
    const locations = practiceOverride ? [] : (loadOfficeSettings().locations ?? []);
    return {
      today: d.today,
      appointments: d.appointments,
      tasks: d.tasks,
      unreadMessages,
      questionnaires: practiceOverride
        ? []
        : receivedForms.map((r) => ({
            patientId: r.patient_id,
            patientName: allPatients().find((p) => p.id === r.patient_id)?.fullName ?? "a patient",
            formName: r.form_name,
          })),
      locations: locations.map((l) => ({ id: l.id, name: l.name, nickname: l.nickname })),
      patients: allPatients().map((p) => ({
        id: p.id,
        fullName: briefName(p.fullName, p.id),
        caseStatus: p.caseStatus,
        locationId: p.locationId,
        firstVisit: p.matrix?.initialExam?.trim() || patientInitialExamIso(p, index),
        billed: billing[p.id]?.billedAmount,
        paid: billing[p.id]?.paidAmount ?? (Number.parseFloat(p.matrix?.paidAmount ?? "") || 0),
        paidDate: billing[p.id]?.paidDate || (p.matrix?.paidDate ?? "").replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1"),
      })),
    };
  };
  /** Case pipeline lists: the Case Flow screen's own rules (lib/case-flow-options), cleared tasks left out. */
  const pipelineData = () => {
    const d = practiceData();
    const index = buildInitialExamIndex(d.appointments);
    const pts = d.patients as unknown as PatientRecord[];
    const closed = practiceOverride ? [] : loadCaseStatuses().filter((c) => c.isCaseClosed).map((c) => c.name);
    const items = buildFollowUpItems(pts.filter((p) => !p.isCashPatient), practiceOverride ? {} : caseFlowOptions(loadDashboardWorkspaceSettings().patientFollowUp, closed, loadPatientFollowUpOverridesMap()));
    return {
      today: d.today,
      items,
      closedStatuses: closed,
      patients: pts.map((p) => ({ id: p.id, fullName: p.fullName, caseStatus: p.caseStatus, attorney: p.attorney, dateOfLoss: p.dateOfLoss, initialExam: p.matrix?.initialExam?.trim() || patientInitialExamIso(p, index), rbSent: p.matrix?.rbSent, discharge: p.matrix?.discharge, cash: Boolean(p.isCashPatient) })),
    };
  };
  /** Admin-only (case status lists, like PR #96): staff get the polite reply. */
  const runPipeline = (kind: PipelineKind, question: string | null) => {
    if (question !== null) push({ role: "user", text: question, practice: true });
    if (!isGoatAdmin) {
      push({ role: "goat", text: statsGate() ?? ADMIN_ONLY_REPLY, practice: true, choices: [{ label: "Morning Rundown", question: "Morning Rundown" }] });
      return;
    }
    const a = pipelineAnswer(kind, pipelineData());
    push({ role: "goat", text: a.text, practice: true, todoRows: a.rows, textAfter: a.textAfter, choices: a.choices });
  };
  const runReview = (ask: ReviewAsk, question: string | null) => {
    if (question !== null) push({ role: "user", text: question, practice: true });
    if (!isGoatAdmin) {
      push({ role: "goat", text: statsGate() ?? ADMIN_ONLY_REPLY, practice: true, choices: [{ label: "Morning Rundown", question: "Morning Rundown" }] });
      return;
    }
    const d = pipelineData();
    let patient: { id: string; fullName: string } | undefined;
    if (ask.mode === "patient") {
      const m = matchPatientsByName(ask.name, d.patients);
      if (m.length > 1) {
        push({ role: "goat", text: `Which case? (${m.length} match)`, practice: true, choices: m.slice(0, 8).map((p) => ({ label: `${p.fullName} · ${p.caseStatus || "No status"}`, question: `case review for ${p.fullName}` })) });
        return;
      }
      patient = m[0];
    }
    const a = caseReviewAnswer(ask, d, patient);
    push({ role: "goat", text: a.text, practice: true, todoRows: a.rows, textAfter: a.textAfter, choices: a.choices });
  };
  const tryPipeline = (question: string): boolean => {
    const review = detectReview(question);
    if (review) {
      runReview(review, question);
      return true;
    }
    const kind = detectPipeline(question);
    if (!kind) return false;
    runPipeline(kind, question);
    return true;
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
    if (target === "review") {
      runReview({ mode: "summary" }, null);
      return;
    }
    if (target.startsWith("pipeline:")) {
      runPipeline(target.slice("pipeline:".length) as PipelineKind, null);
      return;
    }
    const kind: Record<string, "rundown" | "apptCheck" | "business"> = { todo: "rundown", schedule: "rundown", messages: "rundown", apptCheck: "apptCheck", business: "business" };
    if (!briefAllowed(kind[target], isGoatAdmin)) {
      push({ role: "goat", text: statsGate() ?? ADMIN_ONLY_REPLY, practice: true });
      return;
    }
    const data = briefData();
    const a = target === "todo" ? viewTodos(data) : target === "schedule" ? viewSchedule(data) : target === "messages" ? viewMessages(data) : target === "apptCheck" ? appointmentCheck(data) : quickBiz(data);
    push({ role: "goat", text: a.text, practice: true, links: a.links, todoRows: a.todoRows, textAfter: a.textAfter });
  };
  /** Greeting chip tap: drop any waiting step and run the brief directly. */
  const runChip = (chip: string) => {
    flowRef.current = null;
    if (job || practiceBusy) return;
    if (!tryBrief(chip)) tryPipeline(chip);
  };
  const tryBrief = (question: string): boolean => {
    const kind = detectBrief(question);
    if (!kind) return false;
    if (!briefAllowed(kind, isGoatAdmin)) {
      push({ role: "user", text: question, practice: true });
      push({ role: "goat", text: statsGate() ?? ADMIN_ONLY_REPLY, practice: true, choices: [{ label: "Morning Rundown", question: "Morning Rundown" }] });
      return true;
    }
    const data = briefData();
    const a = kind === "rundown" ? morningRundown(data) : kind === "apptCheck" ? appointmentCheck(data) : quickBiz(data);
    push({ role: "user", text: question, practice: true });
    push({ role: "goat", text: a.text, practice: true, links: a.links, todoRows: a.todoRows, textAfter: a.textAfter });
    return true;
  };
  // ── Team message in plain words ("message hannah about john smith", "let the team know …") ──
  // Steps: who (ask if several / none) → what (ask if missing) → which case (ALWAYS confirmed when one is named) → confirm card.
  const tellNext = (st0: TellPending) => {
    const st: TellPending = { ...st0 };
    if (st.to === undefined) {
      if (st.req.to === TEAM) st.to = null;
      else {
        const team = buildTeam(loadSigners(), teamLogins);
        const hits = matchRecipient(st.req.to, team);
        if (!hits.length) {
          const options = team.slice(0, 8);
          tellRef.current = { ...st, stage: "to", options };
          push({
            role: "goat",
            text: `I couldn't find a team member named "${st.req.to}". Who should get it?`,
            practice: true,
            choices: [...options.map((p, i) => ({ label: p.label, question: `${TELL_TOKEN}to:${i}` })), { label: "The whole team (General)", question: `${TELL_TOKEN}team` }],
            links: [{ label: "Add team members (G.O.A.T. Settings)", href: "/settings/goat" }],
          });
          return;
        }
        if (hits.length > 1) {
          tellRef.current = { ...st, stage: "to", options: hits };
          push({ role: "goat", text: `Which ${st.req.to}?`, practice: true, choices: hits.map((p, i) => ({ label: p.lastName ? `${p.label} ${p.lastName}` : p.label, question: `${TELL_TOKEN}to:${i}` })) });
          return;
        }
        st.to = { label: hits[0].label, userId: hits[0].userId };
      }
    }
    const who = st.to ? st.to.label : "the team";
    if (!st.req.text.trim()) {
      tellRef.current = { ...st, stage: "text" };
      push({ role: "goat", text: `What should I tell ${who}?`, practice: true });
      return;
    }
    if (st.patientId === undefined) {
      const pool = allPatients().filter((p) => !(p as { deleted?: boolean }).deleted).map(toChatPatient);
      let cands: ChatPatient[] = [];
      if (st.req.patientName) {
        const f = findPatientsInQuestion(`about ${st.req.patientName} `, pool);
        cands = f.confident ? [f.confident.patient] : [...f.candidates, ...f.inactive].map((c) => c.patient);
      } else {
        cands = patientsMentionedInMessage(st.req.text, pool);
      }
      if (!cands.length && st.req.patientName) {
        tellRef.current = { ...st, stage: "case" };
        push({ role: "goat", text: `I couldn't find a patient named "${st.req.patientName}". Pick the patient, or send it with no case?`, practice: true, choices: [{ label: "Pick a patient", question: `${TELL_TOKEN}case:other` }, { label: "No patient (general)", question: `${TELL_TOKEN}case:none` }] });
        return;
      }
      if (cands.length) {
        // Always confirmed, even with one match: the message gets linked to that case.
        tellRef.current = { ...st, stage: "case" };
        const shown = cands.slice(0, 6);
        push({
          role: "goat",
          text: caseQuestion(shown.map((c) => ({ label: choiceLabel(c) }))),
          practice: true,
          choices: [
            ...shown.map((c) => ({ label: shown.length === 1 ? `Yes — ${choiceLabel(c)}` : choiceLabel(c), question: `${TELL_TOKEN}case:${c.id}` })),
            { label: "Different patient", question: `${TELL_TOKEN}case:other` },
            { label: "No patient (general)", question: `${TELL_TOKEN}case:none` },
          ],
        });
        return;
      }
      st.patientId = null;
    }
    tellRef.current = null;
    const pt = st.patientId ? allPatients().map(toChatPatient).find((p) => p.id === st.patientId) ?? null : null;
    const caseNo = pt ? caseNumberOf(pt) : "";
    push({
      role: "goat",
      text: "Send this message?",
      practice: true,
      msgDraft: {
        toTeam: st.to ? undefined : true,
        toLabel: st.to ? st.to.label : "Everyone (General)",
        toUserId: st.to?.userId,
        text: st.req.text.trim(),
        patientId: pt?.id,
        patientName: pt?.fullName,
        caseLabel: pt ? (caseNo ? `${caseNo} ${pt.fullName}` : pt.fullName) : undefined,
        state: "open",
      },
    });
  };
  /** A tapped step button ("/:tm:…"). */
  const tellToken = (token: string) => {
    const st = tellRef.current;
    if (!st) {
      push({ role: "goat", text: "That message was already finished or canceled. Say it again and I'll start over.", practice: true });
      return;
    }
    const v = token.slice(TELL_TOKEN.length);
    if (v === "team") return tellNext({ ...st, to: null });
    if (v.startsWith("to:")) {
      const p = st.options?.[Number(v.slice(3))];
      if (p) return tellNext({ ...st, to: { label: p.label, userId: p.userId } });
      return;
    }
    if (v === "case:none") return tellNext({ ...st, patientId: null });
    if (v === "case:other") {
      tellRef.current = { ...st, stage: "caseName" };
      push({ role: "goat", text: "Which patient? Type their name.", practice: true });
      return;
    }
    if (v.startsWith("case:")) return tellNext({ ...st, patientId: v.slice(5) });
  };
  /** Typed reply while a team message is waiting on a step. True if it was used. */
  const tellReply = (question: string): boolean => {
    const st = tellRef.current;
    if (!st) return false;
    if (/^(cancel|never ?mind|stop|forget it)\b/i.test(question)) {
      tellRef.current = null;
      push({ role: "user", text: question, practice: true });
      push({ role: "goat", text: "OK, not sent.", practice: true });
      return true;
    }
    // A new request ("/", "@", a chip, or another team message) drops the waiting step.
    if (question.startsWith("/") || question.startsWith("@") || (CHIPS as readonly string[]).includes(question) || parseTeamMessage(question) || detectPlainTodo(question)) {
      tellRef.current = null;
      return false;
    }
    push({ role: "user", text: question, practice: true });
    if (st.stage === "text") tellNext({ ...st, req: { ...st.req, text: question } });
    else if (st.stage === "to") tellNext({ ...st, to: undefined, req: { ...st.req, to: question } });
    else tellNext({ ...st, patientId: undefined, req: { ...st.req, patientName: question } });
    return true;
  };
  const tryTeamMessage = (question: string): boolean => {
    const req = parseTeamMessage(question);
    if (!req) return false;
    push({ role: "user", text: question, practice: true });
    tellNext({ req, stage: "to" });
    return true;
  };

  /** New patient request → a card that opens the existing New Patient form prefilled. Never creates the patient. */
  const newPatientCard = (raw: string, shownAs?: string) => {
    push({ role: "user", text: shownAs ?? raw, practice: true });
    const settings = scheduleSettings() ?? loadScheduleSettings();
    const attorneys = practiceOverride ? [] : loadContactDirectory().filter((c) => c.category.toLowerCase() === "attorney").map((c) => c.name);
    const parsed = parseIntakeText(newPatientIntakeText(raw), { todayIso: practiceData().today, attorneys, settings });
    const d = parsed.draft;
    // A visit day/time in the request → New Appointment (New patient), which books it.
    // The New Patient form itself is patient info only.
    if (d.apptDate) {
      newVisitFlow(raw, newPatientIntakeText(raw), true, false);
      return;
    }
    const name = [d.firstName, d.lastName].filter(Boolean).join(" ");
    const lines = [
      name && `- Name: ${name}`,
      d.phone && `- Phone: ${d.phone}`,
      d.attorney && `- Attorney: ${d.attorney}`,
      d.nonPi && "- Non-PI (cash)",
      d.dateOfInjury && `- Date of Injury: ${d.dateOfInjury}`,
      d.apptDate && `- New Patient Evaluation: ${dayLabel(d.apptDate)}${d.apptTime ? ` at ${to12hLabel(d.apptTime)}` : ""}`,
      d.note && `- Note: ${d.note}`,
    ].filter(Boolean);
    const text = [
      lines.length ? "New patient — I'll fill in the New Patient form with:" : "New patient — I'll open the New Patient form.",
      ...lines,
      parsed.ask.length ? `Please check: ${parsed.ask.join(" ")}` : "",
      "Nothing is saved until you click Create Patient.",
    ].filter(Boolean).join("\n");
    // Already a patient with that name? Offer to book them instead (never required).
    const existing = name ? matchPatientsByName(name, allPatients()).slice(0, 3) : [];
    const when = d.apptDate ? ` ${d.apptDate.slice(5, 7)}/${d.apptDate.slice(8, 10)}${d.apptTime ? ` at ${to12hLabel(d.apptTime)}` : ""}` : "";
    push({
      role: "goat",
      text,
      practice: true,
      formLaunch: { kind: "newPatient", label: "Open New Patient form", draft: d as Record<string, string | boolean | number | undefined>, ask: parsed.ask },
      choices: existing.length ? existing.map((p) => ({ label: `${choiceLabel(toChatPatient(p))} is already a patient — book them instead`, question: `book ${p.fullName.replace(/,/g, "")}${when}` })) : undefined,
    });
  };
  /**
   * Booking someone who may be new ("schedule armen barmen for new appt next Thursday at 3pm"):
   * an existing match → "Existing patient … or a new patient?" (unless they said "new patient");
   * otherwise a button that opens New Appointment in New-patient mode, prefilled (phone from a
   * matching open "call …" to-do). Nothing is created until Save Appointment.
   */
  const newVisitFlow = (shown: string, text: string, saysNewPatient: boolean, pushUser = true) => {
    if (pushUser) push({ role: "user", text: shown, practice: true });
    const settings = scheduleSettings() ?? loadScheduleSettings();
    const attorneys = practiceOverride ? [] : loadContactDirectory().filter((c) => c.category.toLowerCase() === "attorney").map((c) => c.name);
    const parsed = parseIntakeText(text, { todayIso: practiceData().today, attorneys, settings });
    const d = parsed.draft;
    const name = [d.firstName, d.lastName].filter(Boolean).join(" ");
    const people = allPatients();
    let existing = name ? matchPatientsByName(name, people) : [];
    if (!existing.length) {
      const f = findPatientsInQuestion(shown, people.map(toChatPatient));
      existing = (f.confident ? [f.confident.patient] : f.candidates.map((c) => c.patient)).map((c) => patientById(c.id)).filter((p): p is PatientRecord => Boolean(p));
    }
    existing = existing.slice(0, 3);
    const when = d.apptDate ? ` ${d.apptDate.slice(5, 7)}/${d.apptDate.slice(8, 10)}${d.apptTime ? ` at ${to12hLabel(d.apptTime)}` : ""}` : "";
    const bookExisting = (p: PatientRecord) => `book ${p.fullName.split(",").map((x) => x.trim()).reverse().join(" ")}${when}`;
    if (existing.length && !saysNewPatient) {
      const who = existing.length === 1 ? `Existing patient ${displayName(existing[0].fullName)}` : "One of these existing patients";
      push({
        role: "goat",
        text: `${who}, or a new patient?`,
        practice: true,
        choices: [
          ...existing.map((p) => ({ label: `Existing: ${choiceLabel(toChatPatient(p))}`, question: bookExisting(p) })),
          { label: "New patient", question: `schedule new patient ${name || displayName(existing[0].fullName)}${when}` },
        ],
      });
      return;
    }
    const todo = findTodoPhone(d, openTaskRows);
    const phone = d.phone || todo?.phone || "";
    const lines = [
      name && `- Name: ${name}`,
      phone && `- Phone: ${phone}${!d.phone && todo ? " (from your to-do)" : ""}`,
      d.attorney && `- Attorney: ${d.attorney}`,
      d.dateOfInjury && `- Date of Injury: ${d.dateOfInjury}`,
      d.apptDate && `- Visit: ${dayLabel(d.apptDate)}${d.apptTime ? ` at ${to12hLabel(d.apptTime)}` : ""} (New Patient)`,
      d.note && `- Note: ${d.note}`,
    ].filter(Boolean);
    const ask = parsed.ask.filter((a) => !/patient's name|last name/i.test(a) || !name);
    push({
      role: "goat",
      text: [
        `New patient visit — I'll open New Appointment in New-patient mode${lines.length ? " with:" : "."}`,
        ...lines,
        ask.length ? `Please check: ${ask.join(" ")}` : "",
        "Fill in the rest; Save Appointment adds the patient and books the visit.",
      ].filter(Boolean).join("\n"),
      practice: true,
      formLaunch: {
        kind: "newAppointment",
        label: "Open New Appointment (new patient)",
        date: d.apptDate,
        time: d.apptTime,
        newPatient: { lastName: d.lastName, firstName: d.firstName, phone, attorney: d.attorney, dateOfLoss: d.dateOfInjury, notes: d.note },
        taskId: todo?.taskId,
      },
      choices: existing.length ? existing.map((p) => ({ label: `${choiceLabel(toChatPatient(p))} is already a patient — book them instead`, question: bookExisting(p) })) : undefined,
    });
  };
  const npCtx = (): NewPatientCtx => {
    const office = loadOfficeSettings();
    let types: Array<{ name: string; durationMin: number }> = [];
    try { types = loadAppointmentTypes().filter((t) => (t as { active?: boolean }).active !== false).map((t) => ({ name: t.name, durationMin: t.durationMin })); } catch { types = []; }
    const data = practiceData();
    return { todayIso: data.today, settings: scheduleSettings() ?? loadScheduleSettings(), appointments: data.appointments, types, provider: office.doctorName?.trim() ?? "", location: office.officeName?.trim() ?? "" };
  };
  /** Show the next step of the in-chat new patient + New Patient visit. */
  const showNewPatientStep = (step: NewPatientStep) => {
    if (step.kind === "ask") {
      push({ role: "goat", text: step.say, practice: true, npAsk: { field: step.field, pending: step.pending, state: "open" } });
      return;
    }
    const c = step.card;
    const d = c.draft;
    const lines = [
      `New patient: ${c.firstName} ${c.lastName} · ${c.phone}`,
      `${d.type}: ${dayLabel(d.date)} at ${to12hLabel(d.time)}${c.provider ? ` · ${c.provider}` : ""}${c.location ? ` · ${c.location}` : ""}`,
      d.taken ? "That time is taken. Pick an open time below, or override." : d.outsideHours ? "That's outside office hours. Pick an open time below, or override." : "Confirm adds the patient and books the visit.",
      ...d.notes,
    ];
    push({
      role: "goat",
      text: lines.join("\n"),
      practice: true,
      booking: { ...d, state: "open", newPatient: { firstName: c.firstName, lastName: c.lastName, phone: c.phone, provider: c.provider, location: c.location } },
      formLaunch: { kind: "newAppointment", label: "Edit in New Appointment", date: d.date, time: d.time, newPatient: { lastName: c.lastName, firstName: c.firstName, phone: c.phone } },
    });
  };
  /** Open the form behind a formLaunch button (prefill handed over in sessionStorage). */
  const openForm = (f: NonNullable<ChatMessage["formLaunch"]>) => {
    if (f.kind === "newPatient") {
      stashNewPatientPrefill({ draft: f.draft as Partial<IntakeDraft>, ask: f.ask });
      formRouter.push("/patients?new=1");
      return;
    }
    stashNewAppointmentPrefill({ patientId: f.patientId, date: f.date, time: f.time, newPatient: f.newPatient, taskId: f.taskId });
    formRouter.push("/appointments?new=1");
    // Already on the Schedule: the URL change alone doesn't remount it.
    window.setTimeout(() => window.dispatchEvent(new Event("goat:new-appointment")), 60);
  };
  /** Plain wording, no "/" needed: "add to-do call vartan …", "schedule new patient John Smith next Wednesday at 10". */
  const tryPlainIntent = (question: string): boolean => {
    const td = detectPlainTodo(question);
    if (td) {
      push({ role: "user", text: question, practice: true });
      if (!td.text) {
        push({ role: "goat", text: 'What\'s the to-do? e.g. "add to-do call Mock Law about records friday"', practice: true });
        return true;
      }
      const t = parseTodo(td.text, practiceData().today);
      const people = allPatients();
      // "Name: text" picks the case outright; otherwise the text stays as typed and a match is only offered.
      const named = t.name && !isNoPatientName(t.name) ? matchPatientsByName(t.name, people) : [];
      if (named.length === 1) {
        const p = named[0];
        push({ role: "goat", text: "Add to To-Do?", practice: true, patientName: displayName(p.fullName), todoDraft: { title: t.title, dueDate: t.due, patientId: p.id, patientName: p.fullName, state: "open" } });
        return true;
      }
      const title = t.name ? takeDueDate(td.text, practiceData().today).rest.replace(/[,\-–—\s]+$/, "") : t.title;
      const found = findPatientsInQuestion(title, people.map(toChatPatient));
      // Opened on a patient's page: "her" / "this patient" / no name → that patient (one confirm).
      const pagePt = patientById(openPatientId);
      if (pagePt) {
        const pick = pickTodoPatient({
          text: title,
          page: pagePt,
          confident: found.confident ? people.find((x) => x.id === found.confident!.patient.id) ?? null : null,
          candidates: found.candidates.map((c) => people.find((x) => x.id === c.patient.id)).filter((x): x is NonNullable<typeof x> => Boolean(x)),
        });
        if (pick.patient) {
          const p = pick.patient;
          const finalTitle = p.id === pagePt.id ? todoTitleForPagePatient(title, p.fullName) : title;
          push({ role: "goat", text: "Add to To-Do?", practice: true, patientName: displayName(p.fullName), todoDraft: { title: finalTitle, dueDate: t.due, patientId: p.id, patientName: p.fullName, state: "open" } });
          return true;
        }
      }
      // "…and remind me to call his lawyer" / "call her back": link to the patient already in play.
      const ctxPt = contextPatient();
      const carried = carryRef.current && carryRef.current.until > Date.now() ? carryRef.current.id : null;
      const pronoun = /\b(his|her|hers|him|their|them|this patient)\b/i.test(title) && !found.named;
      if (ctxPt && ((carried === ctxPt.id && found.confident?.patient.id === ctxPt.id) || pronoun)) {
        const linked = pronoun ? carryPatient(title, ctxPt.fullName.includes(",") ? `${ctxPt.fullName.split(",")[1].trim()} ${ctxPt.fullName.split(",")[0].trim()}` : ctxPt.fullName) : title;
        const finalTitle = linked.charAt(0).toUpperCase() + linked.slice(1);
        push({ role: "goat", text: `Add to To-Do for ${displayName(ctxPt.fullName)}?`, practice: true, patientName: displayName(ctxPt.fullName), todoDraft: { title: finalTitle, dueDate: t.due, patientId: ctxPt.id, patientName: ctxPt.fullName, state: "open" } });
        return true;
      }
      const offer = found.confident ? [found.confident.patient] : found.candidates.slice(0, 4).map((c) => c.patient);
      push({
        role: "goat",
        text: offer.length ? "Add to To-Do? (Not linked to a patient — tap one below to link it.)" : "Add this to-do?",
        practice: true,
        todoDraft: { title, dueDate: t.due, state: "open" },
        choices: offer.length ? offer.map((c) => ({ label: `Link to ${choiceLabel(c)}`, question: `/todo ${c.fullName.replace(/,/g, "")}: ${td.text}` })) : undefined,
      });
      return true;
    }
    const nv = detectNewVisitBooking(question);
    if (nv) {
      newVisitFlow(question, nv.text, nv.saysNewPatient);
      return true;
    }
    if (detectNewPatientRequest(question)) {
      newPatientCard(question);
      return true;
    }
    return false;
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
    if (sl.cmd === "new") {
      newPatientCard(sl.rest, question);
      return true;
    }
    if (sl.cmd === "schedule") {
      if (!sl.rest) {
        push({ role: "user", text: question, practice: true });
        push({ role: "goat", text: 'Who and when? e.g. "/schedule John Smith friday at 3". For a new patient: "/new Jane Doe 817-555-0100 appt tomorrow 3pm".', practice: true, formLaunch: { kind: "newAppointment", label: "Open New Appointment" } });
        return true;
      }
      const nv = detectNewVisitBooking(`schedule ${sl.rest}`);
      if (nv) {
        newVisitFlow(question, nv.text, nv.saysNewPatient);
        return true;
      }
      shownAsRef.current = question;
      send(scheduleSlashToBooking(sl.rest));
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
    const plan = resolveSlashTodo(sl.rest, practiceData().today, allPatients().map(toChatPatient));
    if (plan.kind === "needText") {
      push({ role: "goat", text: 'What\'s the to-do? e.g. "/todo call Nazaryan for John Smith tomorrow" or "/todo John Smith: request records"', practice: true });
      return true;
    }
    if (plan.kind === "notFound") {
      push({ role: "goat", text: `I couldn't find a patient named "${plan.name}". Check the name, or leave it off for a to-do with no patient.`, practice: true });
      return true;
    }
    if (plan.kind === "ask") {
      const ch = (p: ChatPatient) => ({ label: choiceLabel(p), question: `/todo ${p.fullName.replace(/,/g, "")}: ${plan.chipText}` });
      const none = { label: "No patient", question: `/todo none: ${plan.chipText}` };
      const w = withInactive(plan.shown.map(ch), plan.hidden.map(ch));
      push({ role: "goat", text: `Which ${plan.name}?`, practice: true, ...w, choices: [...(w.choices ?? []), none] });
      return true;
    }
    const patient = plan.patient ? patientById(plan.patient.id) : null;
    if (plan.attach?.length) {
      const ch = (c: ChatPatient) => ({ label: `Attach to ${choiceLabel(c)}`, question: `/todo ${c.fullName.replace(/,/g, "")}: ${plan.attachText ?? sl.rest}` });
      push({ role: "goat", text: "Add this to-do? (Not attached to a case — tap one below to attach it.)", practice: true, todoDraft: { title: plan.title, dueDate: plan.due, state: "open" }, choices: plan.attach.map(ch) });
      return true;
    }
    push({ role: "goat", text: "Add to To-Do?", practice: true, patientName: patient ? displayName(patient.fullName) : undefined, todoDraft: { title: plan.title, dueDate: plan.due, patientId: patient?.id, patientName: patient?.fullName, state: "open" } });
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
      push({ role: "goat", text: "Add to To-Do?", practice: true, patientName: p ? displayName(p.fullName) : undefined, todoDraft: { title: a.title, dueDate: a.due, patientId: p?.id, patientName: p?.fullName, state: "open" } });
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
    const n = rows.length;
    const unticked = dupes ? ` ${dupes === 1 ? "One's" : `${dupes} are`} unticked — ${dupes === 1 ? "it looks like a duplicate or is missing info" : "they look like duplicates or are missing info"}.` : "";
    const say = guess
      ? asked
        ? `Got ${n} contact${n === 1 ? "" : "s"} — filing ${n === 1 ? "it" : "them"} under ${guess} like you said.${unticked} Look it over and tap Add.`
        : `Got ${n} contact${n === 1 ? "" : "s"}. ${guess === "Attorney" ? "They look like law firms" : `They look like ${categoryPlural(guess)}`}, so I put ${guess} — change it if I'm off.${unticked} Look it over and tap Add.`
      : `Got ${n} contact${n === 1 ? "" : "s"}. I'm not sure what kind ${n === 1 ? "it is" : "they are"} — pick a category in the card and I'll add ${n === 1 ? "it" : "them"}.${unticked}`;
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
    setMsg(msg.id, { contactImport: { ...imp, state: "saved", addedIds: res.added.map((c) => c.id), result: `Done! Added ${res.added.length}${skipped ? ` (skipped ${skipped}${why})` : ""}.` } });
  };
  const confirmContactRecat = (msg: ChatMessage) => {
    const r = msg.contactRecat;
    if (!r || r.state !== "open") return;
    if (r.mode === "undo") {
      const n = removeContactsByIds(r.ids);
      setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === msg.id ? { ...x, contactRecat: { ...r, state: "done", result: `Done — took out ${n === 1 ? "that one" : `all ${n}`}.` } } : x.id === r.importMsgId && x.contactImport ? { ...x, contactImport: { ...x.contactImport, state: "undone", result: `Undone: removed ${n}.` } } : x)) }));
      return;
    }
    const prev: Record<string, string> = {};
    let n = 0;
    for (const c of loadContactDirectory().filter((x) => r.ids.includes(x.id))) {
      prev[c.id] = JSON.stringify({ category: c.category, subCategory: c.subCategory ?? "" });
      const res = updateContact(c.id, { name: c.name, category: r.to as ContactCategory, phone: c.phone, fax: c.fax ?? "", email: c.email ?? "", address: c.address ?? "" });
      if (res.updated) n++;
    }
    setMsg(msg.id, { contactRecat: { ...r, prev, state: "done", result: `Done — ${n === 1 ? "it's" : `all ${n} are`} under ${r.to} now.` } });
  };
  const revertContactRecat = (msg: ChatMessage) => {
    const r = msg.contactRecat;
    if (!r || r.state !== "done" || !r.prev) return;
    for (const c of loadContactDirectory().filter((x) => r.prev![x.id])) {
      const was = JSON.parse(r.prev[c.id]) as { category: string; subCategory: string };
      updateContact(c.id, { name: c.name, category: was.category as ContactCategory, subCategory: was.subCategory || undefined, phone: c.phone, fax: c.fax ?? "", email: c.email ?? "", address: c.address ?? "" });
    }
    setMsg(msg.id, { contactRecat: { ...r, state: "reverted", result: `Okay, put ${r.ids.length === 1 ? "it" : "them"} back under ${r.from || "no category"}.` } });
  };
  const undoContactImport = (msg: ChatMessage, imp: NonNullable<ChatMessage["contactImport"]>) => {
    const n = removeContactsByIds(imp.addedIds ?? []);
    setMsg(msg.id, { contactImport: { ...imp, state: "undone", result: `Okay, took out the ${n === 1 ? "one" : n} I added.` } });
  };

  /** The last G.O.A.T. message is waiting on a reply of its own (a pick, a missing detail, a "/" step). */
  const replyPending = (): boolean => {
    const g = [...chat.messages].reverse().find((m) => m.role === "goat");
    if (!g) return false;
    return Boolean(g.bookingAsk || g.npAsk?.state === "open" || g.pendingQuestion || g.msgAsk || (g.choices?.length && !g.picked && !g.missed));
  };
  const runUnderstand = (text: string): Understood | null => {
    const people = allPatients().filter((p) => !(p as { deleted?: boolean }).deleted);
    return understand(text, {
      today: practiceData().today,
      patients: people.map((p) => ({ id: p.id, fullName: p.fullName, caseStatus: p.caseStatus })),
      lastPatientId: contextPatient()?.id ?? null,
      attorneys: loadContactDirectory().filter((c) => c.category === "Attorney").map((c) => c.name),
      learned: learnedMap(loadLearned()),
      names: workspaceNames(),
    });
  };
  /** Contact and attorney names, scrubbed from any wording G.O.A.T. saves. */
  const workspaceNames = (): string[] => loadContactDirectory().map((c) => c.name).filter(Boolean);
  /** Saved wording: patient, contact and attorney names, days, times and numbers become blanks. */
  const tplOf = (typed: string): string =>
    phraseTemplate(typed, allPatients().map((p) => ({ id: p.id, fullName: p.fullName })), practiceData().today, workspaceNames());
  /**
   * A typed correction right after a G.O.A.T. result ("no I wanted you to book it", "not a note,
   * a to-do", "no, move it to friday"): close the wrong card, remember the original wording →
   * the right action (cloud list), and redo it as one confirm card.
   */
  const handleCorrection = (question: string): boolean => {
    const fix = detectCorrection(question);
    if (!fix) return false;
    const idx = chat.messages.map((m) => m.role).lastIndexOf("goat");
    const g = idx >= 0 ? chat.messages[idx] : null;
    if (!g) return false;
    const original = g.replyTo ?? [...chat.messages.slice(0, idx)].reverse().find((m) => m.role === "user")?.text ?? "";
    if (!original || detectCorrection(original)) return false;
    // "no, cancel" on an open card just means "don't do it", not "cancel the visit".
    const openCard = [g.quick, g.booking, g.todoDraft, g.noteDraft, g.om].some((c) => c?.state === "open");
    if (fix.action === "cancel" && !fix.detail && openCard) return false;
    // "no, move it to friday" on a booking card that isn't saved yet = same booking, new day/time.
    if (fix.action === "reschedule" && g.booking?.state === "open" && fix.detail) {
      const today = practiceData().today;
      const tail = fix.detail.replace(/^to\s+/, "");
      const d2 = findDate(tail, today);
      const t2 = findTime(tail);
      let text = normalizeForIntent(original);
      const d0 = findDate(text, today);
      const t0 = findTime(text);
      const cuts = [d2 && d0 ? [d0.span, d2.words] : null, t2 && t0 ? [t0.span, t2.words] : null].filter(Boolean) as Array<[[number, number], string]>;
      for (const [[a0, b0], w] of cuts.sort((x, y) => y[0][0] - x[0][0])) text = `${text.slice(0, a0)}${w}${text.slice(b0)}`;
      if (d2 && !d0) text += ` ${d2.words}`;
      if (t2 && !t0) text += ` ${t2.words}`;
      setMsg(g.id, { booking: { ...g.booking, state: "canceled" } });
      const ub = runUnderstand(text);
      if (ub?.action === "book" && ub.canonical) resendAs(ub.canonical, question);
      else resendAs(text, question);
      return true;
    }
    const did = g.booking ? "book" : g.todoDraft ? "todo" : g.noteDraft ? "note" : g.om ? `om:${g.om.plan.kind}` : g.quick ? g.quick.kind : "reply";
    const tpl = tplOf(original);
    if (safeTemplate(tpl)) saveLearned((l) => withPhrase(withMiss(l, tpl, did), tpl, fix.action));
    const patch: Partial<ChatMessage> = { missed: { state: "picked", picked: fix.action } };
    if (g.quick?.state === "open") patch.quick = { ...g.quick, state: "canceled" };
    if (g.booking?.state === "open") patch.booking = { ...g.booking, state: "canceled" };
    if (g.todoDraft?.state === "open") patch.todoDraft = { ...g.todoDraft, state: "canceled" };
    if (g.noteDraft?.state === "open") patch.noteDraft = { ...g.noteDraft, state: "canceled" };
    if (g.om?.state === "open") patch.om = { ...g.om, state: "canceled" };
    setMsg(g.id, patch);
    const people = allPatients().filter((p) => !(p as { deleted?: boolean }).deleted);
    const combined = fix.detail ? `${original} ${fix.detail}` : original;
    const u = understand(combined, {
      today: practiceData().today,
      patients: people.map((p) => ({ id: p.id, fullName: p.fullName, caseStatus: p.caseStatus })),
      lastPatientId: contextPatient()?.id ?? null,
      attorneys: loadContactDirectory().filter((c) => c.category === "Attorney").map((c) => c.name),
      names: workspaceNames(),
      force: fix.action,
    });
    if (u && actOn(u, question)) return true;
    resendAs(u?.canonical ?? combined, question);
    return true;
  };
  /** Hand a canonical phrase to the existing path; the chat still shows what was typed. */
  const resendAs = (canonical: string, typed: string) => {
    shownAsRef.current = typed;
    understoodRef.current = true;
    send(canonical);
  };
  /** True when handled here (card, navigation or one short question). */
  const actOn = (u: Understood, typed: string): boolean => {
    if (u.ask) {
      // Right after one of G.O.A.T.'s own actions, a vague follow-up ("make it 3") belongs to that action.
      if (!u.patient && lastAct()) return false;
      push({ role: "user", text: typed, practice: true });
      push({ role: "goat", text: u.ask, practice: true, replyTo: typed });
      askRef.current = { raw: typed };
      return true;
    }
    const who = u.patient ? patientById(u.patient.id) : null;
    switch (u.action) {
      case "open": {
        if (!who) return false;
        push({ role: "user", text: typed, practice: true });
        push({ role: "goat", text: `Opening ${displayName(who.fullName)}'s case.`, practice: true, patientName: displayName(who.fullName), links: [{ label: `Open ${displayName(who.fullName)}`, href: `/patients/${who.id}` }], replyTo: typed }, who.id);
        saveRecall({ patientId: who.id, patientName: who.fullName, action: "file" });
        formRouter.push(`/patients/${who.id}`);
        return true;
      }
      case "reschedule":
      case "cancel":
      case "checkIn":
      case "checkOut":
      case "noShow":
      case "doi": {
        if (!who) return false;
        const data = practiceData();
        const plan = planQuick(u, { today: data.today, appointments: data.appointments, settings: scheduleSettings() ?? loadScheduleSettings(), currentDoi: who.dateOfLoss });
        push({ role: "user", text: typed, practice: true });
        if ("say" in plan) push({ role: "goat", text: plan.say, practice: true, replyTo: typed, links: [{ label: "Open Schedule", href: "/appointments" }] });
        else push({ role: "goat", text: plan.summary, practice: true, patientName: displayName(who.fullName), quick: { ...plan, state: "open" }, replyTo: typed }, who.id);
        return true;
      }
      case "book":
      case "note":
      case "attorney":
      case "status":
        if (!u.canonical) return false;
        // Typed wording already works as is → leave it (keeps every existing follow-up).
        if (u.canonical.toLowerCase() === typed.toLowerCase()) return false;
        resendAs(u.canonical, typed);
        return true;
      case "todo":
        if (!u.canonical || detectPlainTodo(typed)) return false;
        resendAs(u.canonical, typed);
        return true;
      default:
        return false;
    }
  };
  /** Confirm on a quick card: apply through the Schedule's / patient record's own save path. */
  const confirmQuick = (msg: ChatMessage, time?: string) => {
    const q = msg.quick;
    if (!q || q.state !== "open") return;
    const plan: QuickPlan = time ? { ...q, time } : q;
    let result = "";
    if (plan.kind === "doi" && plan.doi) {
      updatePatientRecordById(plan.patientId, { dateOfLoss: plan.doi });
      result = `✓ Date of injury set to ${cardDate(plan.doi)}.`;
    } else if (plan.appointmentId) {
      const status = { cancel: "Canceled", checkIn: "Check In", checkOut: "Check Out", noShow: "No Show" } as const;
      updateAppointment(plan.appointmentId, (a) =>
        plan.kind === "reschedule" ? { ...a, date: plan.date ?? a.date, startTime: plan.time ?? a.startTime, status: "Scheduled" } : { ...a, status: status[plan.kind as keyof typeof status] },
      );
      const first = nameParts(plan.patientName).first;
      result = plan.kind === "reschedule" ? `✓ Moved to ${cardDate(plan.date!)} at ${to12hLabel(plan.time!)}.` : plan.kind === "cancel" ? "✓ Canceled." : plan.kind === "checkIn" ? `✓ ${first} is checked in.` : plan.kind === "checkOut" ? `✓ ${first} is checked out.` : "✓ Marked no-show.";
    }
    setMsg(msg.id, { quick: { ...plan, state: "done", result } });
  };
  /** "That's not what I meant" → log the miss (workspace cloud list), then offer the actions. */
  const markMissed = (msg: ChatMessage) => {
    const typed = msg.replyTo ?? [...chat.messages].slice(0, chat.messages.findIndex((x) => x.id === msg.id)).reverse().find((x) => x.role === "user")?.text ?? "";
    const tpl = tplOf(typed);
    const did = msg.booking ? "book" : msg.todoDraft ? "todo" : msg.noteDraft ? "note" : msg.om ? `om:${msg.om.plan.kind}` : msg.quick ? msg.quick.kind : "reply";
    if (safeTemplate(tpl)) saveLearned((l) => withMiss(l, tpl, did));
    setMsg(msg.id, { missed: { state: "open" }, replyTo: typed });
  };
  /** The user picked the right action: remember the phrase → action (names stay slots) and redo it. */
  const pickMeant = (msg: ChatMessage, action: ActionId | "none") => {
    const typed = msg.replyTo ?? "";
    if (action === "none") {
      setMsg(msg.id, { missed: { state: "noted" } });
      return;
    }
    const tpl = tplOf(typed);
    if (safeTemplate(tpl)) saveLearned((l) => withPhrase(l, tpl, action));
    setMsg(msg.id, { missed: { state: "picked", picked: action } });
    if (typed) window.setTimeout(() => sendRef.current(typed), 50);
  };
  const send = (raw: string, opts?: { to?: TeamPerson[]; display?: string; prefix?: string }) => {
    // Typos and texting shorthand ("tmrw", "pls", "remind me 2", "lawer") → plain words first.
    const casual = !opts && !raw.includes("\n") && !isFlowToken(raw.trim()) && !raw.trim().startsWith("/") && !raw.trim().startsWith("@");
    const question = casual ? normalizeCasual(raw) : raw.trim();
    if (!question || job || practiceBusy) return;
    // Two requests in one message: "book John Wed 2pm and remind me to call his lawyer".
    // Each step runs on its own (each still gets its own confirm card); "his/him" carries the patient.
    if (casual) {
      const steps = splitSteps(question);
      if (steps.length > 1) {
        const hit = findPatientsInQuestion(steps[0], allPatients().map(toChatPatient)).confident?.patient;
        const rest = steps.slice(1).map((st) => (hit ? carryPatient(st, hit.fullName) : st));
        if (hit) carryRef.current = { id: hit.id, until: Date.now() + 450 * steps.length + 1500 };
        send(steps[0]);
        rest.forEach((st, i) => window.setTimeout(() => sendRef.current(st), 450 * (i + 1)));
        return;
      }
    }
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
    // Understand first, then act: straight to one confirm card (or one short question).
    const skipUnderstand = understoodRef.current;
    understoodRef.current = false;
    if (casual && !skipUnderstand && !flowRef.current && handleCorrection(question)) return;
    if (casual && !skipUnderstand && !flowRef.current && !replyPending()) {
      if (askRef.current) {
        const merged = `${askRef.current.raw} ${question}`;
        const u2 = runUnderstand(merged);
        askRef.current = null;
        if (u2 && !u2.ask && actOn(u2, question)) return;
      }
      const u = runUnderstand(question);
      if (u && actOn(u, question)) return;
    }
    // Office-wide count/list by status ("how many canceled appts do we have") is a schedule
    // question: answer it from the schedule before any patient-name guessing.
    if (casual && !flowRef.current && !replyPending() && isOfficeStatsQuestion(question, practiceData().today, allPatients().map((p) => p.fullName)) && tryPractice(question, false)) return;
    // "For which time frame?" is waiting: a typed "this week" / "today" answers it.
    if (casual && !flowRef.current && !replyPending() && lastOffice()?.kind === "apptStatsAsk" && parseTimeframeReply(question, practiceData().today) && tryPractice(question, false)) return;
    const people = allPatients().map(toChatPatient);
    const found = findPatientsInQuestion(question, people);
    const waitingForName = waitingQuestion();
    // "/note", "/todo" and the greeting chips (Morning Rundown, Appointment Check, Quick Biz).
    if (!opts && isGoatHelpQuestion(question)) {
      push({ role: "user", text: question, practice: true });
      push({ role: "goat", text: goatHelpText(), practice: true, links: [{ label: "Handbook → G.O.A.T.", href: GOAT_HANDBOOK_ANCHOR }] });
      return;
    }
    // In-chat new patient: the answer to "What's John's phone number?" / "What time?".
    if (!opts) {
      const lastG = [...chat.messages].reverse().find((m) => m.role === "goat");
      if (lastG?.npAsk?.state === "open") {
        const ask = lastG.npAsk;
        setChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === lastG.id ? { ...m, npAsk: { ...ask, state: "done" } } : m)) }));
        if (!/^(cancel|never ?mind|stop|no)\b/i.test(question.trim())) {
          const step = continueNewPatientBooking(ask.pending, ask.field, question, npCtx());
          push({ role: "user", text: question, practice: true });
          if (step) showNewPatientStep(step);
          else push({ role: "goat", text: ask.field === "phone" ? `I need a 10-digit phone number for ${ask.pending.firstName}.` : ask.field === "day" ? "Which day? (e.g. \"Thursday\" or \"10/22\")" : "What time? (e.g. \"10am\" or \"2:30pm\")", practice: true, npAsk: { ...ask, state: "open" } });
          return;
        }
        push({ role: "user", text: question, practice: true });
        push({ role: "goat", text: "Okay, I won't add them.", practice: true });
        return;
      }
    }
    // "you did it wrong" / "you put them under acute care" / "undo that" refer to G.O.A.T.'s LAST
    // action — they win over any older patient context (never the patient's note/bill/booking menu).
    if (!opts && !isFlowToken(question) && !question.startsWith("/")) {
      const fu = followUpFor(question, lastAct(), practiceData().today);
      if ((fu && ["correct", "leave", "importRecat", "importUndo"].includes(fu.kind)) || /^fix the (time|recipient|to-do)$/i.test(question.trim())) {
        flowRef.current = null;
        if (tryFollowUp(question)) return;
      }
    }
    // Team-message steps (tapped buttons, or the typed answer to "What should I tell Hannah?").
    if (question.startsWith(TELL_TOKEN)) {
      tellToken(question);
      return;
    }
    if (!opts && tellReply(question)) return;
    // Plain-language to-do / new patient / team message (no "/" needed).
    if (!opts && !isFlowToken(question) && !question.startsWith("/") && tryPlainIntent(question)) return;
    if (!opts && !isFlowToken(question) && tryTeamMessage(question)) return;
    if (!opts && !isFlowToken(question) && detectBrief(question)) {
      flowRef.current = null;
      if (tryBrief(question)) return;
    }
    // Case pipeline ("who needs an mri", "ready to submit?", chips) — office-wide, admin-only.
    if (!opts && !isFlowToken(question) && (detectReview(question) || detectPipeline(question))) {
      flowRef.current = null;
      if (tryPipeline(question)) return;
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
      // Case counts reached through the dialog are office stats too (admins only, fail closed).
      const dialogGate = r.kind === "office" && isStatsOfficeKind(turn.state.office?.kind) ? statsGate() : null;
      if (dialogGate) {
        push({ role: "user", text: question, practice: true });
        push({ role: "goat", text: dialogGate, practice: true });
        return;
      }
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
        // Generic note/bill/booking buttons only when this message names the patient —
        // never for a "them/it" that most likely means something G.O.A.T. just did.
        const named = p ? p.fullName.split(/[,\s]+/).filter((w) => w.length > 2).some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question)) : false;
        const opts = r.kind === "clarify" && p && named ? clarifyForPatient(p.fullName, question.replace(new RegExp(p.fullName.split(" ")[0], "i"), "").replace(new RegExp(p.fullName.split(" ").slice(1).join(" ") || "^$", "i"), "").trim()).options : [];
        push({
          role: "goat",
          text: r.kind === "clarify" && p && !named ? `Sorry, I didn't catch that — is this about ${displayName(p.fullName).split(/\s+/)[0]}?` : r.say,
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
        const caseNo = pt ? caseNumberOf(pt) : "";
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
    const how = HOWTO_QUESTION.test(question) && !waitingForName ? answerHowToFull(question, { admin: isGoatAdmin, manager: isGoatAdmin || roleTier === "manager", canView: (f) => canView(f as never) }) : null;
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
      if (found.named) {
        // No patient with that full name → add them as a new patient right here in chat.
        if (found.named.trim().split(/\s+/).length >= 2) {
          const ctx = npCtx();
          const step = startNewPatientBooking(found.named, question, ctx);
          const first = found.named.trim().split(/\s+/)[0];
          push({ role: "goat", text: `No ${found.named} yet — I'll add ${first} as a new patient.`, practice: true });
          showNewPatientStep(step);
          return;
        }
        // Only one name given: New Appointment in New-patient mode, prefilled.
        push({ role: "goat", text: `I couldn't find an existing patient named "${found.named}".`, practice: true });
        newVisitFlow(question, newVisitBookingText(question), true, false);
        return;
      }
      push({ role: "goat", text: "Who should I book? Type their name, the day and the time.", formLaunch: { kind: "newAppointment", label: "Open New Appointment" } });
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
        text: "Which one did you mean?",
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
      { const cp = contextPatient(); const c = clarifyIntent(question, { name: cp ? displayName(cp.fullName).split(/\s+/)[0] : null }); push({ role: "goat", text: c.text, practice: true, choices: c.choices.length ? c.choices : undefined }); }
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
      else { const cp = contextPatient(); const c = clarifyIntent(question, { name: cp ? displayName(cp.fullName).split(/\s+/)[0] : null }); push({ role: "goat", text: c.text, practice: true, choices: c.choices.length ? c.choices : undefined }); }
      return;
    }
    // Not clearly about the file: never "I couldn't find that in this patient's file".
    if (!isClearFileQuestion(question)) {
      push({ role: "goat", text: clarifyFor(lastAct()), practice: true });
      return;
    }
    startAnswer(p, question, Boolean(current));
  };
  // Opening brief + nudges, from real data (read-only). Only while the chat is empty.
  const chatEmpty = chat.messages.length === 0;
  const opening = useMemo(() => {
    if (!chatEmpty || practiceOverride) return null;
    try {
      const data = briefData();
      const people = allPatients()
        .filter((p) => !(p as { deleted?: boolean }).deleted)
        .map((p) => ({ id: p.id, fullName: p.fullName, caseStatus: p.caseStatus, attorney: p.attorney, cash: p.isCashPatient, firstVisit: data.patients.find((x) => x.id === p.id)?.firstVisit }));
      const rc = readRecall();
      const recall = rc && patientById(rc.patientId) ? recallLine(rc) : null;
      return { brief: dailyBrief(data, new Date().getHours(), isGoatAdmin), nudges: nudges(data, people), recall };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatEmpty, isGoatAdmin, practiceOverride]);
  const liveNudges = opening ? opening.nudges.filter((x) => !dismissedNudges.includes(x.id)) : [];
  // Patient-page box handed us an action ("remind me to do his report"): send it here.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  const isOpenNow = useGlobalGoatOpen();
  useEffect(() => {
    if (!(isOpenNow || fullScreen)) return;
    const text = takePendingAsk();
    if (!text) return;
    const t = window.setTimeout(() => sendRef.current(text), 0);
    return () => window.clearTimeout(t);
  }, [isOpenNow, fullScreen]);

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
  const onDone = (m: Pick<ChatMessage, "text" | "quotes" | "warnings" | "ms" | "copy" | "originals">) => {
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

  if (!canView("patients")) {
    return fullScreen ? (
      <div className="flex min-h-[100dvh] items-center justify-center p-6 text-center text-sm text-[var(--text-muted)]">
        G.O.A.T. isn&apos;t turned on for your account. Ask the office owner for Patients access.
      </div>
    ) : null;
  }
  const installKind = open && typeof window !== "undefined"
    ? installTipKind({ ua: window.navigator.userAgent, standalone: isStandalone(), hasPrompt: Boolean(installEvt), dismissed: installDismissed, maxTouchPoints: window.navigator.maxTouchPoints })
    : null;
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
          className={
            fullScreen
              ? "fixed inset-0 z-[60] flex h-[100dvh] flex-col overflow-hidden bg-white pb-[env(safe-area-inset-bottom)]"
              : "fixed inset-x-2 bottom-2 z-[60] flex h-[min(97.5vh,calc(100dvh-1rem))] flex-col overflow-hidden rounded-2xl border border-[var(--line-soft)] bg-white shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:h-[min(700px,calc(100dvh-2rem))] sm:w-[min(600px,calc(100vw-2rem))]"
          }
          data-goat-app={fullScreen ? "" : undefined}
          data-goat-panel
          data-goat-section="global-goat"
        >
          <header className={`flex items-center gap-2.5 bg-[#72bdcf] px-3 py-2 text-white ${fullScreen ? "pt-[max(0.5rem,env(safe-area-inset-top))]" : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="G.O.A.T." className={`shrink-0 rounded-full bg-white/80 object-cover ${fullScreen ? "h-[46px] w-[46px] ring-2 ring-white/55" : "h-11 w-11"}`} height={44} src="/goat-avatar/tablet-128.png" srcSet="/goat-avatar/tablet-128.png 1x, /goat-avatar/tablet-256.png 2x" width={44} />
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
                  fullScreen ? "Ask about any patient" : "Ask about any patient by name"
                )}
              </div>
            </div>
            <button style={{ fontSize: 12 }}
              className={`rounded-lg px-2 py-1 text-xs font-semibold hover:bg-white/20 disabled:opacity-40 ${fullScreen ? "bg-white/15" : ""}`}
              disabled={!chat.messages.length || Boolean(job)}
              onClick={async () => {
                if ((await appConfirm("Clear this G.O.A.T. chat? It's only saved on this computer and can't be brought back."))) {
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
            {fullScreen ? (
              <Link aria-label="Close G.O.A.T. and open the full app" className="rounded-lg px-2 py-0.5 text-2xl font-light leading-none hover:bg-white/20" href="/patients" title="Open the full My Note Goat app">
                ×
              </Link>
            ) : (
              <button aria-label="Close G.O.A.T." className="rounded-lg px-2 py-0.5 text-xl leading-none hover:bg-white/20" onClick={() => setGlobalGoatOpen(false)} type="button">
                ×
              </button>
            )}
          </header>
          {installKind && (
            <InstallTip
              kind={installKind}
              onDismiss={dismissInstallTip}
              onInstall={async () => {
                const evt = installEvt;
                if (!evt) return;
                await evt.prompt();
                const choice = await evt.userChoice.catch(() => null);
                setInstallEvt(null);
                if (choice?.outcome === "accepted") dismissInstallTip();
              }}
              onGoatPage={pathname === GOAT_APP_PATH}
            />
          )}

          <div ref={listRef} className={`flex-1 space-y-2.5 overflow-y-auto px-3 py-3 ${fullScreen ? "bg-[#e4f0f7]" : "bg-[var(--bg-soft,#f6f9fa)]"}`}>
            {!chat.messages.length && (
              <div className="flex gap-2">
                <GoatAvatar size={28} />
                <div className="rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-sm" data-goat-greeting>
                  {/* Plain words first; "/" shortcuts still work when typed but aren't advertised. */}
                  <p data-goat-brief>
                    {opening && !briefHidden ? opening.brief : <><span className="font-semibold">{greeting}</span> What can I do for you?</>}
                    {opening && !briefHidden && liveNudges.length > 0 && (
                      <button className="ml-1 text-xs font-semibold text-[var(--brand-primary)]" data-goat-headsups onClick={() => setShowNudges((v) => !v)} type="button">
                        {showNudges ? "Hide heads-ups" : `${liveNudges.length} heads-up${liveNudges.length === 1 ? "" : "s"} ›`}
                      </button>
                    )}
                    {opening && (
                      <button className="ml-2 text-[11px] text-[var(--text-muted)] hover:underline" data-goat-brief-toggle onClick={toggleBrief} type="button">
                        {briefHidden ? "Show brief" : "Hide brief"}
                      </button>
                    )}
                  </p>
                  {opening && !briefHidden && showNudges && liveNudges.length > 0 && (
                    <ul className="mt-1.5 space-y-1" data-goat-nudges>
                      {opening.nudges.filter((x) => !dismissedNudges.includes(x.id)).map((x) => (
                        <li className="flex items-start gap-1.5 rounded-lg bg-[#fff8e6] px-2 py-1 text-xs" key={x.id}>
                          <span className="flex-1">
                            {x.href ? <Link className="hover:underline" href={x.href}>{x.text}</Link> : x.text}
                          </span>
                          <button aria-label="Dismiss" className="text-[var(--text-muted)] hover:text-[var(--text-main)]" onClick={() => setDismissedNudges(Object.keys(dismissNudge(x.id)))} title="Not now" type="button">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {opening?.recall && !briefHidden && showNudges && <p className="mt-1 text-xs" data-goat-recall>{opening.recall}</p>}
                  <div className={fullScreen ? "mt-2.5 flex flex-col gap-2" : "mt-2 flex flex-wrap gap-1.5"}>
                    {chipsFor(isGoatAdmin).map((c) => (
                      <button
                        className={
                          fullScreen
                            ? "flex items-center gap-2 rounded-xl border border-[#72bdcf] bg-[#eef8fb] px-3 py-2 text-left text-[13px] font-semibold text-[var(--text-main)] active:bg-[#dff1f6]"
                            : "rounded-full border border-[var(--brand-primary)]/40 bg-[#eef8fb] px-3 py-1 text-xs font-semibold text-[var(--brand-primary)] transition hover:bg-[var(--brand-primary)] hover:text-white"
                        }
                        data-goat-chip
                        key={c}
                        onClick={() => runChip(c)}
                        type="button"
                      >
                        {fullScreen && <span aria-hidden className="text-[15px]">{CHIP_ICONS[c] ?? "💬"}</span>}
                        {c}
                      </button>
                    ))}
                  </div>
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
                    {m.todoDraft?.state === "open" && <div className="mb-0.5 text-[11px] font-bold tracking-wide text-[#2f7f93]">NEW TO-DO</div>}
                    {m.patientName && <div className="mb-0.5 text-[11px] font-semibold text-[#2f7f93]">{m.patientName}</div>}
                    <LinkedText text={m.text} links={m.links} />
                    {m.todoRows && m.todoRows.length > 0 && <TodoRows rows={m.todoRows} />}
                    {m.textAfter && <div className="whitespace-pre-line leading-snug">{m.textAfter}</div>}
                    {splitLinks(m.text, m.links).rest.map((l) => (
                      <Link key={l.href} className="mt-1 block font-semibold text-[var(--brand-primary)] hover:underline" href={l.href} style={{ fontSize: 13 }}>
                        {l.label} ↗
                      </Link>
                    ))}
                    {m.formLaunch && (
                      <button
                        className="btn btn-primary btn-sm mt-2"
                        data-goat-form={m.formLaunch.kind}
                        onClick={() => openForm(m.formLaunch!)}
                        type="button"
                      >
                        {m.formLaunch.label} ↗
                      </button>
                    )}
                    {m.msgDraft && <MessageCard draft={m.msgDraft} onCancel={() => setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, msgDraft: { ...x.msgDraft!, state: "canceled" } } : x)) }))} onSent={(body) => setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, msgDraft: { ...x.msgDraft!, state: "sent", sent: body } } : x)) }))} />}
                    {m.noteEdit && <NoteEditCard edit={m.noteEdit} onCancel={() => setChat((c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, noteEdit: { ...x.noteEdit!, state: "canceled" } } : x)) }))} onConfirm={() => applyNoteEdit(m)} />}
                    {m.contactEdit && <ContactEditCard d={m.contactEdit} onCancel={() => setMsg(m.id, { contactEdit: { ...m.contactEdit!, state: "canceled" } })} onChange={(d) => setMsg(m.id, { contactEdit: d })} onConfirm={(d) => confirmContactEdit(m, d)} />}
                    {m.contactRecat && <ContactRecatCard r={m.contactRecat} onCancel={() => setMsg(m.id, { contactRecat: { ...m.contactRecat!, state: "canceled" } })} onConfirm={() => confirmContactRecat(m)} onUndo={() => revertContactRecat(m)} />}
                    {m.contactImport && <ContactImportCard imp={m.contactImport} onCancel={() => setMsg(m.id, { contactImport: { ...m.contactImport!, state: "canceled" } })} onChange={(imp) => setMsg(m.id, { contactImport: imp })} onConfirm={(imp) => void confirmContactImport(m, imp)} onUndo={() => undoContactImport(m, m.contactImport!)} />}
                    {m.quick && <QuickCard q={m.quick} onCancel={() => setMsg(m.id, { quick: { ...m.quick!, state: "canceled" } })} onConfirm={(t) => confirmQuick(m, t)} />}
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
                    {m.missed?.state === "open" && (
                      <div className="mt-2 rounded-lg bg-[#fff8e6] px-2 py-1.5 text-xs" data-goat-missed>
                        <p className="font-semibold">Sorry — what did you mean?</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {GOAT_ACTIONS.filter((a) => a.id !== "message").map((a) => (
                            <button className="rounded-full border border-[#72bdcf] bg-white px-2 py-0.5 text-[11px] font-semibold hover:bg-[#eef8fb]" key={a.id} onClick={() => pickMeant(m, a.id)} type="button">{a.label}</button>
                          ))}
                          <button className="rounded-full border border-[var(--line-soft)] bg-white px-2 py-0.5 text-[11px] text-[var(--text-muted)]" onClick={() => pickMeant(m, "none")} type="button">Something else</button>
                        </div>
                      </div>
                    )}
                    {m.missed?.state === "picked" && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Got it — saved to the G.O.A.T. Library. I&apos;ll read it that way from now on.</p>}
                    {m.missed?.state === "noted" && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Thanks — noted so it can be fixed.</p>}
                    {!m.missed && m.text && (
                      <button aria-label="That's not what I meant" className="mt-1 text-[11px] text-[var(--text-muted)] opacity-60 hover:opacity-100" data-goat-thumbsdown onClick={() => markMissed(m)} title="That's not what I meant" type="button">👎</button>
                    )}
                    {m.originals && m.originals.length > 0 && (
                      <details className="mt-1.5 text-xs">
                        <summary className="cursor-pointer font-semibold text-[var(--text-muted)]">Show original</summary>
                        {m.originals.map((o, i) => (
                          <div key={i} className="mt-1">
                            <p className="font-semibold">{o.label}</p>
                            <p className="whitespace-pre-wrap text-[var(--text-muted)]">{o.text}</p>
                          </div>
                        ))}
                      </details>
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

          <div className={`border-t border-[var(--line-soft)] bg-white px-3 ${fullScreen ? "pb-2 pt-2.5" : "pb-2 pt-2"}`}>
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
                  // 16px in the phone app: iOS zooms the page on focus for anything smaller.
                  className={fullScreen ? "h-11 w-full rounded-2xl border border-[var(--line-soft)] bg-white px-3.5 text-base" : "w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"}
                  enterKeyHint="send"
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
                  placeholder="Ask or say anything…"
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
              <button style={{ fontSize: fullScreen ? 15 : 14 }} className={fullScreen ? "h-11 rounded-2xl bg-[var(--brand-primary)] px-4 font-semibold text-white disabled:opacity-40" : "rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"} disabled={!input.trim() || Boolean(job) || practiceBusy} type="submit">
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

function ContactRecatCard({ r, onConfirm, onCancel, onUndo }: { r: NonNullable<ChatMessage["contactRecat"]>; onConfirm: () => void; onCancel: () => void; onUndo: () => void }) {
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold";
  if (r.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">No changes made.</p>;
  if (r.state === "done" || r.state === "reverted") {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs" data-goat-recat-result>
        <span className={`font-semibold ${r.state === "done" ? "text-emerald-700" : "text-[var(--text-muted)]"}`}>{r.state === "done" ? "✓ " : ""}{r.result}</span>
        <Link className="text-[var(--brand-primary)] hover:underline" href="/contacts">Open Contacts ↗</Link>
        {r.state === "done" && r.mode === "recat" && <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} onClick={onUndo} style={{ fontSize: 12 }} type="button">Undo</button>}
      </div>
    );
  }
  return (
    <div className="mt-2 flex gap-1.5" data-goat-recat>
      <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`} onClick={onConfirm} style={{ fontSize: 12 }} type="button">{r.mode === "undo" ? `Yes, remove ${r.ids.length}` : `Yes, switch ${r.ids.length}`}</button>
      <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} onClick={onCancel} style={{ fontSize: 12 }} type="button">Cancel</button>
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

/** "Call Armen Barmen 555-555-5588" → text "Call Armen Barmen" + phone (shown on its own line). Saved title is unchanged. */
function todoTitleParts(title: string): { text: string; phone: string } {
  const m = /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.exec(title);
  if (!m || title.trim().length - m[0].length < 3 || title.indexOf(m[0]) + m[0].length < title.trim().length - 1) return { text: title, phone: "" };
  return { text: title.slice(0, m.index).replace(/[\s,:-]+$/, ""), phone: m[0] };
}
const CHIP_ICONS: Record<string, string> = { "Morning Rundown": "☀️", "Appointment Check": "📅", "Quick Biz": "📊", "Case Review": "📋" };

function QuickCard({ q, onConfirm, onCancel }: { q: NonNullable<ChatMessage["quick"]>; onConfirm: (time?: string) => void; onCancel: () => void }) {
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold";
  if (q.state === "done") return <p className="mt-1.5 text-xs font-semibold text-emerald-700">{q.result}</p>;
  if (q.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">Left as is.</p>;
  return (
    <div className="mt-2 space-y-1.5 text-xs" data-goat-quick>
      {q.note && <p className="text-[11.5px] text-[var(--text-muted)]">{q.note}</p>}
      {q.options && q.options.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {q.options.map((t) => (
            <button className={`${btn} border-[#72bdcf] bg-[#eef8fb]`} key={t} onClick={() => onConfirm(t)} type="button">{to12hLabel(t)}</button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] px-3.5 text-white`} onClick={() => onConfirm()} style={{ fontSize: 13 }} type="button">Confirm</button>
        <button className={`${btn} border-[var(--line-soft)] bg-white px-3.5 text-[var(--text-muted)]`} onClick={onCancel} style={{ fontSize: 13 }} type="button">Cancel</button>
      </div>
    </div>
  );
}

function TodoCard({ draft, onConfirm, onCancel }: { draft: NonNullable<ChatMessage["todoDraft"]>; onConfirm: () => void; onCancel: () => void }) {
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold";
  if (draft.state === "saved") return <p className="mt-1.5 text-xs font-semibold text-emerald-700">✓ Added to To-Do · <Link className="text-[var(--brand-primary)] hover:underline" href="/patients?view=toDo">Open To-Do ↗</Link></p>;
  if (draft.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">Not added.</p>;
  return (
    <div className="mt-2 space-y-1.5 text-xs" data-goat-todo>
      <div className="rounded-lg bg-[#eef8fb] px-2.5 py-2 text-[13px] leading-snug">
        <span className="block font-semibold">{todoTitleParts(draft.title).text}</span>
        {todoTitleParts(draft.title).phone && <span className="font-semibold text-[var(--brand-primary)]">{todoTitleParts(draft.title).phone}</span>}
      </div>
      <p className="text-[11.5px] text-[var(--text-muted)]">{draft.dueDate ? `Due ${cardDate(draft.dueDate)}` : "No due date"}{draft.patientName ? ` · Patient: ${draft.patientName}` : " · No patient"}</p>
      <div className="flex flex-wrap gap-1.5">
        <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] px-3.5 text-white`} onClick={onConfirm} style={{ fontSize: 13 }} type="button">Confirm</button>
        <button className={`${btn} border-[var(--line-soft)] bg-white px-3.5 text-[var(--text-muted)]`} onClick={onCancel} style={{ fontSize: 13 }} type="button">Cancel</button>
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
        {draft.patientId && draft.caseLabel && (
          <p className="mt-1">
            Case:{" "}
            <Link className="font-semibold text-[var(--brand-primary)] hover:underline" href={`/patients/${encodeURIComponent(draft.patientId)}`}>{draft.caseLabel} ↗</Link>
          </p>
        )}
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
  // "Message the team": General, no @mention (everyone sees it in Messages).
  const all = draft.toTeam ? [] : [{ label: draft.toLabel, userId: draft.toUserId }, ...(draft.alsoTo ?? [])];
  // No signature on messages (the author is shown); every recipient @mentioned.
  const body = draft.toTeam ? draft.text.trim() : `${all.map((p) => `@${p.label}`).join(" ")} ${draft.text.trim()}`;
  const allLabels = all.map((p) => p.label).join(" and ");
  const btn = "rounded-xl border px-2.5 py-1 text-xs font-semibold disabled:opacity-50";
  return (
    <div className="mt-2 space-y-1 text-xs" data-goat-message>
      <p>
        <span className="text-[var(--text-muted)]">To:</span> <strong>{draft.toTeam ? draft.toLabel : all.map((p) => p.label).join(", ")}</strong>
      </p>
      <p>
        <span className="text-[var(--text-muted)]">Case:</span>{" "}
        {draft.caseLabel && draft.patientId ? (
          <Link className="font-semibold text-[var(--brand-primary)] hover:underline" href={`/patients/${encodeURIComponent(draft.patientId)}`}>{draft.caseLabel} ↗</Link>
        ) : (
          draft.caseLabel ?? "None (general message)"
        )}
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
          disabled={sending || !all.length || all.some((p) => !p.userId)}
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

/** Each to-do line opens that to-do (To-Do page, highlighted); the patient name inside links to the patient. */
function TodoRows({ rows }: { rows: NonNullable<ChatMessage["todoRows"]> }) {
  const router = useRouter();
  return (
    <ul className="mt-0.5 grid gap-0.5">
      {rows.map((r) => (
        <li
          className="cursor-pointer rounded-md px-1 leading-snug hover:bg-[rgba(13,121,191,0.08)]"
          key={r.id}
          onClick={() => router.push(r.href)}
          onKeyDown={(e) => { if (e.key === "Enter") router.push(r.href); }}
          role="link"
          tabIndex={0}
          title="Open this to-do"
        >
          - {r.before}
          {r.patientName && (r.patientHref ? (
            <Link className="font-semibold text-[var(--brand-primary)] hover:underline" href={r.patientHref} onClick={(e) => e.stopPropagation()}>
              {r.patientName}
            </Link>
          ) : r.patientName)}
          {r.after}
        </li>
      ))}
    </ul>
  );
}

/** Patient links whose name starts a "- " / "• " line in the reply render inline on that line; the rest stay below (no duplicate chip block). */
function LinkedText({ text, links }: { text: string; links?: Array<{ label: string; href: string }> }) {
  const { inline } = splitLinks(text, links);
  if (!inline.size) return <div className="whitespace-pre-line leading-snug">{text}</div>;
  return (
    <div className="leading-snug">
      {text.split("\n").map((line, i) => {
        const hit = inline.get(i);
        if (!hit) return <div key={i} className="min-h-[1em] whitespace-pre-line">{line}</div>;
        const at = line.indexOf(hit.label);
        return (
          <div key={i} className="whitespace-pre-line">
            {line.slice(0, at)}
            <Link className="font-semibold text-[var(--brand-primary)] hover:underline" href={hit.href}>{hit.label}</Link>
            {line.slice(at + hit.label.length)}
          </div>
        );
      })}
    </div>
  );
}
