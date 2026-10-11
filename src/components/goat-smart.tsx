"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { GoatContext } from "@/lib/goat";
import { assistGoat, type AssistedAnswer } from "@/lib/goat-ai/assist";
import { goatAiState, stopGoatAi, subscribeGoatAi, type GoatAiState } from "@/lib/goat-ai/engine";
import { GOAT_SMART_AVAILABLE, GOAT_SMART_LOCAL_KEY } from "@/lib/goat-ai/flag";
import { useGoatAnswerPrefs } from "@/hooks/use-goat-answer-prefs";

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
 * Smart mode inside the regular answer: runs assistGoat (rules first, the
 * model fills gaps) and keeps the result for the question it was asked for.
 */
export function useSmartAssist() {
  const { prefs } = useGoatAnswerPrefs();
  const [state, setState] = useState<{ question: string; working: boolean; status: string; text: string; answer: AssistedAnswer | null; error: string }>({
    question: "",
    working: false,
    status: "",
    text: "",
    answer: null,
    error: "",
  });
  const runId = useRef(0);
  const run = useCallback(
    async (context: GoatContext, question: string, previous?: { question: string; answer: string } | null): Promise<AssistedAnswer | null> => {
      const id = ++runId.current;
      setState({ question, working: true, status: "", text: "", answer: null, error: "" });
      try {
        const a = await assistGoat({
          context,
          question,
          prefs,
          previous,
          onStatus: (status) => runId.current === id && setState((s) => ({ ...s, status })),
          onText: (text) => runId.current === id && setState((s) => ({ ...s, text })),
        });
        if (runId.current === id) setState((s) => ({ ...s, working: false, answer: a }));
        return a;
      } catch (e) {
        if (runId.current === id) setState((s) => ({ ...s, working: false, error: e instanceof Error ? e.message : String(e) }));
        return null;
      }
    },
    [prefs],
  );
  const reset = useCallback(() => {
    runId.current++;
    stopGoatAi();
    setState({ question: "", working: false, status: "", text: "", answer: null, error: "" });
  }, []);
  return { ...state, run, reset };
}

/** One line under the answers while Smart mode works, or why it can't. */
export function SmartWorking({ working, status, ai }: { working: boolean; status: string; ai: GoatAiState }) {
  if (ai.status === "unsupported" || ai.status === "error") return <p className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{ai.message}</p>;
  if (!working) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      <Spinner />
      {ai.status === "loading" ? `Getting G.O.A.T.+ ready… ${Math.round(ai.progress * 100)}%` : status || "G.O.A.T.+ is checking the file…"}
    </p>
  );
}
