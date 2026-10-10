"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GoatContext } from "@/lib/goat";
import { answerSmart, type SmartAnswer } from "@/lib/goat-ai/answer";
import {
  GOAT_AI_MODELS,
  goatAiState,
  setGoatAiModel,
  loadGoatAi,
  refreshGoatAiSupport,
  stopGoatAi,
  subscribeGoatAi,
  type GoatAiModel,
  type GoatAiState,
} from "@/lib/goat-ai/engine";
import { GOAT_SMART_AVAILABLE, GOAT_SMART_LOCAL_KEY } from "@/lib/goat-ai/flag";
import { useGoatAnswerPrefs } from "@/hooks/use-goat-answer-prefs";
import type { AiSource } from "@/lib/goat-ai/sources";

const SERVER_STATE: GoatAiState = { status: "idle", progress: 0, progressText: "", message: "", cached: false, variant: null, model: "accurate" };

export function useGoatAiState(): GoatAiState {
  return useSyncExternalStore(subscribeGoatAi, goatAiState, () => SERVER_STATE);
}

const smartListeners = new Set<() => void>();
function readSmart(): boolean {
  try {
    return window.localStorage.getItem(GOAT_SMART_LOCAL_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribeSmart(l: () => void) {
  smartListeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === GOAT_SMART_LOCAL_KEY) l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    smartListeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}
function writeSmart(on: boolean) {
  try {
    window.localStorage.setItem(GOAT_SMART_LOCAL_KEY, on ? "1" : "0");
  } catch {
    // ignore
  }
  smartListeners.forEach((l) => l());
}

/** Smart mode on/off for this browser (the model is downloaded per computer). Shared by every G.O.A.T. panel. */
export function useSmartMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeSmart, readSmart, () => false);
  return [GOAT_SMART_AVAILABLE && on, writeSmart];
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#72bdcf] border-t-transparent align-[-2px] ${className}`}
    />
  );
}

/**
 * The "Smart mode (beta)" switch with its one-time download card and
 * progress bar. Turning it on the first time asks before downloading.
 */
export function SmartModeControl({ on, setOn }: { on: boolean; setOn: (on: boolean) => void }) {
  const ai = useGoatAiState();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (on) void refreshGoatAiSupport();
  }, [on]);
  // Already on and already downloaded: get it onto the GPU in the background.
  useEffect(() => {
    if (on && ai.status === "idle" && ai.cached) void loadGoatAi().catch(() => undefined);
  }, [on, ai.status, ai.cached]);

  if (!GOAT_SMART_AVAILABLE) return null;
  const toggle = () => {
    if (on) {
      setOn(false);
      setConfirming(false);
      return;
    }
    if (ai.cached || ai.status === "ready") {
      setOn(true);
      return;
    }
    setConfirming(true);
    void refreshGoatAiSupport();
  };
  return (
    <div className="mt-2 text-xs">
      <label className="inline-flex cursor-pointer items-center gap-2 font-semibold text-[var(--text-main)]">
        <button
          aria-checked={on}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-[var(--brand-primary)]" : "bg-slate-300"}`}
          onClick={toggle}
          role="switch"
          type="button"
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
        <span onClick={toggle}>Smart mode (beta)</span>
      </label>
      {confirming && !on && (
        <div className="mt-2 rounded-xl border border-[#72bdcf] bg-[#eef8fb] p-2.5 text-[13px] leading-snug">
          {ai.status === "unsupported" ? (
            <>
              <p>{ai.message}</p>
              <button className="mt-1.5 font-semibold text-[var(--brand-primary)] hover:underline" onClick={() => setConfirming(false)} type="button">
                OK
              </button>
            </>
          ) : (
            <>
              <p>
                Smart mode reads the patient&apos;s file with a private AI model that runs <strong>only on this computer</strong>. It&apos;s a
                one-time download that stays on this computer. Questions and patient information are never sent anywhere.
              </p>
              <div className="mt-2 space-y-1">
                {(Object.keys(GOAT_AI_MODELS) as GoatAiModel[]).map((m) => (
                  <label key={m} className="flex cursor-pointer items-start gap-2">
                    <input
                      checked={ai.model === m}
                      className="mt-0.5"
                      name="goat-ai-model"
                      onChange={() => setGoatAiModel(m)}
                      type="radio"
                    />
                    <span>
                      <strong>{GOAT_AI_MODELS[m].label}</strong> · about {(GOAT_AI_MODELS[m].downloadMb / 1000).toFixed(1)} GB
                      {m === "accurate" ? " · best answers, needs a newer computer" : " · for older or slower computers"}
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 font-semibold text-white disabled:opacity-40"
                  disabled={ai.status === "checking"}
                  onClick={() => {
                    setConfirming(false);
                    setOn(true);
                    void loadGoatAi().catch(() => undefined);
                  }}
                  type="button"
                >
                  Download and turn on
                </button>
                <button className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 font-semibold" onClick={() => setConfirming(false)} type="button">
                  Not now
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {on && <SmartStatus ai={ai} turnOff={() => setOn(false)} />}
    </div>
  );
}

function SmartStatus({ ai, turnOff }: { ai: GoatAiState; turnOff: () => void }) {
  if (ai.status === "loading") {
    const pct = Math.round(ai.progress * 100);
    return (
      <div className="mt-2 rounded-xl bg-[var(--bg-soft)] px-2.5 py-2 text-[var(--text-muted)]">
        <div className="flex justify-between gap-2">
          <span>{ai.cached ? "Opening Smart mode…" : "One-time download, stays on this computer"}</span>
          <span className="font-semibold">{pct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white">
          <div className="h-full rounded-full bg-[#72bdcf] transition-all" style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
      </div>
    );
  }
  if (ai.status === "unsupported" || ai.status === "error") {
    return <p className="mt-2 rounded-xl bg-amber-50 px-2.5 py-2 font-semibold text-amber-800">{ai.message}</p>;
  }
  if (ai.status === "ready") {
    const other: GoatAiModel = ai.model === "accurate" ? "fast" : "accurate";
    return (
      <p className="mt-1 text-[var(--text-muted)]">
        Smart mode is on ({GOAT_AI_MODELS[ai.model].label.toLowerCase()} model). Answers are written on this computer from the patient&apos;s file.{" "}
        <button className="font-semibold text-[var(--brand-primary)] hover:underline" onClick={() => {
            setGoatAiModel(other);
            turnOff();
          }}
          type="button"
        >
          Use {GOAT_AI_MODELS[other].label.toLowerCase()}
        </button>
      </p>
    );
  }
  return null;
}

function SourceList({ sources, answer }: { sources: AiSource[]; answer: SmartAnswer }) {
  const [open, setOpen] = useState(false);
  const bySource = new Map<string, typeof answer.check.supports>();
  for (const s of answer.check.supports) bySource.set(s.sourceId, [...(bySource.get(s.sourceId) ?? []), s]);
  const cited = sources.filter((s) => bySource.has(s.id));
  const list = cited.length ? cited : sources;
  return (
    <div className="mt-2 border-t border-[var(--line-soft)] pt-1.5">
      <div className="text-xs font-semibold text-[var(--text-muted)]">Sources</div>
      <ul className="mt-1 space-y-1.5">
        {list.map((s) => (
          <li key={s.id} className="text-xs">
            <div className="font-semibold text-[var(--text-main)]">
              {s.title}
              {s.date && (
                <span className="font-normal text-[var(--text-muted)]">
                  {" "}· {s.dateLabel === "dated" ? "Dated" : "Uploaded"} {s.date}
                </span>
              )}
              {s.kind === "file" && s.docType === "referral" && <span className="font-normal text-amber-800"> · Referral</span>}
            </div>
            {(bySource.get(s.id) ?? []).map((q, i) => (
              <div key={i} className="mt-0.5 flex gap-1.5 text-[var(--text-main)]">
                {q.page && <span className="w-7 shrink-0 text-[11px] text-[var(--text-muted)]">p.{q.page}</span>}
                <span>&ldquo;{q.quote}&rdquo;</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <button style={{ fontSize: 12 }} className="mt-1 text-xs font-semibold text-[var(--brand-primary)] hover:underline" onClick={() => setOpen((v) => !v)} type="button">
        {open ? "Hide what G.O.A.T. read" : "Show what G.O.A.T. read"}
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--bg-soft)] p-2 text-[11px] leading-snug">
          {sources.map((s) => `[${s.id}] ${s.title}\n${s.lines.map((l) => l.text).join("\n")}`).join("\n\n")}
        </pre>
      )}
    </div>
  );
}

/** The streamed answer text, then checks and sources. */
/** Small "Source: file.pdf · p.2" links under an answer (the default; quotes are a setting). */
function SourceLinks({ answer, onOpenFile }: { answer: SmartAnswer; onOpenFile?: (fileId: string, page?: number) => void }) {
  const firstPage = new Map<string, number | undefined>();
  for (const s of answer.check.supports) if (!firstPage.has(s.sourceId)) firstPage.set(s.sourceId, s.page);
  const all = answer.retrieval.sources;
  const cited = all.filter((s) => firstPage.has(s.id));
  const list = cited.length ? cited : all.slice(0, 2);
  if (!list.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--text-muted)]">
      <span>Source{list.length > 1 ? "s" : ""}:</span>
      {list.map((s) => {
        const page = firstPage.get(s.id);
        const label = `${s.kind === "file" ? s.title : s.title.replace(/\s*\(patient page.*$/, "") + " (patient page)"}${page ? ` · p.${page}` : ""}`;
        return s.kind === "file" && s.fileId && onOpenFile ? (
          <button
            key={s.id}
            className="font-semibold text-[var(--brand-primary)] hover:underline"
            onClick={() => onOpenFile(s.fileId!, page)}
            style={{ fontSize: 12 }}
            title="Open the file"
            type="button"
          >
            {label} ↗
          </button>
        ) : (
          <span key={s.id} className="font-semibold">
            {label}
          </span>
        );
      })}
    </div>
  );
}

export function SmartAnswerBody({
  text,
  answer,
  working,
  onOpenFile,
}: {
  text: string;
  answer: SmartAnswer | null;
  working: boolean;
  onOpenFile?: (fileId: string, page?: number) => void;
}) {
  const { prefs } = useGoatAnswerPrefs();
  return (
    <>
      <div className="whitespace-pre-line text-sm leading-snug">
        {text}
        {working && text && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[#72bdcf] align-[-2px]" />}
      </div>
      {answer && answer.check.mismatches.length > 0 && (
        <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
          Double-check: {answer.check.mismatches.join(" · ")}
        </p>
      )}
      {answer && answer.check.unverified.length > 0 && (
        <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
          Couldn&apos;t find {answer.check.unverified.map((n) => `"${n}"`).join(", ")} in the sources. Check before using.
        </p>
      )}
      {answer && !answer.skipped && answer.retrieval.sources.length > 0 &&
        (prefs.showQuotes ? <SourceList answer={answer} sources={answer.retrieval.sources} /> : <SourceLinks answer={answer} onOpenFile={onOpenFile} />)}
      {answer && (
        <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">
          {answer.skipped ? "Nothing in the file matched, so the model wasn't asked." : `Written on this computer in ${(answer.ms / 1000).toFixed(1)} s. Smart mode can make mistakes; check the quotes.`}
        </div>
      )}
    </>
  );
}

/** Run one Smart mode question and stream it. */
export function useSmartAsk() {
  const { prefs } = useGoatAnswerPrefs();
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<SmartAnswer | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const runId = useRef(0);
  const ask = useCallback(
    async (context: GoatContext, question: string, previous?: { question: string; answer: string } | null) => {
      const id = ++runId.current;
      setText("");
      setAnswer(null);
      setError("");
      setWorking(true);
      try {
        const a = await answerSmart({
          context,
          question,
          prefs,
          previous,
          onText: (t) => {
            if (runId.current === id) setText(t);
          },
        });
        if (runId.current !== id) return null;
        setText(a.text);
        setAnswer(a);
        return a;
      } catch (e) {
        if (runId.current === id) setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        if (runId.current === id) setWorking(false);
      }
    },
    [prefs],
  );
  const reset = useCallback(() => {
    runId.current++;
    if (working) stopGoatAi();
    setText("");
    setAnswer(null);
    setWorking(false);
    setError("");
  }, [working]);
  return { ask, text, answer, working, error, reset, prefs };
}
