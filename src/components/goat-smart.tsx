"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { GoatContext } from "@/lib/goat";
import type { AssistedAnswer } from "@/lib/goat-ai/assist";
import { GOAT_AI_MODELS, goatAiModel, goatAiState, loadGoatAi, refreshGoatAiSupport, stopGoatAi, subscribeGoatAi, type GoatAiState } from "@/lib/goat-ai/engine";
import { GOAT_PLUS_INTRO_KEY, GOAT_SMART_AVAILABLE, GOAT_SMART_LOCAL_KEY } from "@/lib/goat-ai/flag";
import { useGoatAnswerPrefs } from "@/hooks/use-goat-answer-prefs";

const SERVER_STATE: GoatAiState = { status: "idle", progress: 0, progressText: "", message: "", cached: false, variant: null, model: "accurate" };

export function useGoatAiState(): GoatAiState {
  return useSyncExternalStore(subscribeGoatAi, goatAiState, () => SERVER_STATE);
}

// ---------------------------------------------------------------------------
// Small per-browser flags (not casemate.* keys: those are pushed to the cloud)
// ---------------------------------------------------------------------------

const flagListeners = new Set<() => void>();
/**
 * In-memory copy of each flag. Offices with big patient lists can fill
 * localStorage (the notes cache), and then setItem throws: the switch used to
 * silently stay off and "Turn on" did nothing. Memory wins for this tab, so
 * the click always takes effect; it's re-saved whenever storage allows.
 */
const memFlags = new Map<string, string>();
function readKey(key: string): string | null {
  if (memFlags.has(key)) return memFlags.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeKey(key: string, value: string) {
  memFlags.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`[goat+] couldn't save "${key}" to this browser's storage (it's full?). Keeping it for this tab only.`, e);
  }
  flagListeners.forEach((l) => l());
}
function subscribeFlags(l: () => void) {
  flagListeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === GOAT_SMART_LOCAL_KEY || e.key === GOAT_PLUS_INTRO_KEY) {
      if (e.key) memFlags.delete(e.key);
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    flagListeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}
const readSmart = () => readKey(GOAT_SMART_LOCAL_KEY) === "1";
const writeSmart = (on: boolean) => writeKey(GOAT_SMART_LOCAL_KEY, on ? "1" : "0");

/** + mode on/off for this browser (the model is downloaded per computer). Off unless the user turned it on. */
export function useSmartMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeFlags, readSmart, () => false);
  return [GOAT_SMART_AVAILABLE && on, writeSmart];
}

/** Whether the one-time "turn on + mode?" card still needs an answer on this computer. */
export function usePlusIntro(): { show: boolean; answer: (choice: "on" | "later") => void } {
  // Server render and first paint: not shown (no flash before localStorage is read).
  const answered = useSyncExternalStore(subscribeFlags, () => readKey(GOAT_PLUS_INTRO_KEY) !== null || readSmart(), () => true);
  const answer = useCallback((choice: "on" | "later") => writeKey(GOAT_PLUS_INTRO_KEY, choice), []);
  return { show: GOAT_SMART_AVAILABLE && !answered, answer };
}

/** Turn + mode on: check this computer can run it, then download / open the model (WebLLM's code is fetched only now). */
export async function turnOnPlusMode(): Promise<{ ok: boolean; message: string }> {
  await refreshGoatAiSupport();
  const s = goatAiState();
  if (s.status === "unsupported") {
    writeSmart(false);
    return { ok: false, message: s.message };
  }
  writeSmart(true);
  void loadGoatAi().catch((e) => console.error("[goat+] + mode failed to load", e));
  return { ok: true, message: "" };
}

function sizeLabel(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

/**
 * The one-time card in any G.O.A.T. panel: "Unlock G.O.A.T.'s full potential: turn on + mode?"
 * [Turn on] [Not now]. The choice is remembered on this computer; Settings → G.O.A.T. changes it later.
 */
export function PlusIntroCard() {
  const { show, answer } = usePlusIntro();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [started, setStarted] = useState(false);
  const ai = useGoatAiState();
  if (!show && !msg && started && ai.status !== "idle" && ai.status !== "ready") {
    // Right after "Turn on": always show what's happening (never a silent click).
    const text =
      ai.status === "checking"
        ? "Checking this computer…"
        : ai.status === "loading"
          ? ai.cached
            ? `Opening + mode… ${Math.round(ai.progress * 100)}%`
            : `Downloading ${Math.round(ai.progress * 100)}%… (one time, stays on this computer)`
          : ai.message;
    return <div className={`mt-2 rounded-xl p-2.5 text-xs ${ai.status === "error" || ai.status === "unsupported" ? "border border-amber-200 bg-amber-50 text-amber-900" : "bg-[var(--bg-soft)] text-[var(--text-muted)]"}`}>{text}</div>;
  }
  if (!show && !msg) return null;
  if (msg) {
    return (
      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
        {msg}{" "}
        <button className="font-semibold underline" onClick={() => setMsg("")} style={{ fontSize: 12 }} type="button">
          OK
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-xl border border-[#72bdcf] bg-[#eef8fb] p-2.5 text-sm" data-goat-plus-intro="">
      <p className="font-semibold">Unlock G.O.A.T.&apos;s full potential: turn on + mode?</p>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
        Runs privately on this computer. You can change this anytime in G.O.A.T. Settings. (One-time download, about{" "}
        {sizeLabel(GOAT_AI_MODELS[goatAiModel()].downloadMb)}.)
      </p>
      <div className="mt-2 flex gap-2">
        <button
          className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setStarted(true);
            answer("on");
            void turnOnPlusMode()
              .then((r) => {
                if (!r.ok) setMsg(r.message || "This computer can't run + mode. Regular G.O.A.T. still works.");
              })
              .finally(() => setBusy(false));
          }}
          style={{ fontSize: 12 }}
          type="button"
        >
          Turn on
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
          disabled={busy}
          onClick={() => answer("later")}
          style={{ fontSize: 12 }}
          type="button"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/**
 * + mode inside the regular answer: runs assistGoat (rules first, the model
 * fills gaps) and keeps the result for the question it was asked for.
 * assist (and with it the model code) is imported only when + mode runs.
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
        const { assistGoat } = await import("@/lib/goat-ai/assist");
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

/** One line under the answers while + mode works, or why it can't. */
export function SmartWorking({ working, status, ai }: { working: boolean; status: string; ai: GoatAiState }) {
  if (ai.status === "unsupported" || ai.status === "error") return <p className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{ai.message}</p>;
  if (!working || !status) return null;
  return <p className="text-xs text-[var(--text-muted)]">{status}</p>;
}

export type GoatStatus = "ready" | "searching" | "reading" | "plus" | "found" | "notFound";

/** "Ready" / "Searching…" / "Found it" / "Couldn't find that", like Lexi. Static: no animation. */
export function statusLabel(s: GoatStatus, ai?: GoatAiState): string {
  switch (s) {
    case "searching":
      return "Searching…";
    case "reading":
      return "Reading files…";
    case "plus":
      return ai?.status === "loading" ? `Getting + mode ready… ${Math.round((ai.progress ?? 0) * 100)}%` : "Searching… (+ mode)";
    case "found":
      return "Found it";
    case "notFound":
      return "Couldn't find that";
    default:
      return "Ready";
  }
}

const DOT: Record<GoatStatus, string> = {
  ready: "bg-emerald-500",
  searching: "bg-amber-400",
  reading: "bg-amber-400",
  plus: "bg-amber-400",
  found: "bg-emerald-500",
  notFound: "bg-slate-400",
};

export function GoatStatusLine({ status, ai, className = "" }: { status: GoatStatus; ai?: GoatAiState; className?: string }) {
  return (
    <span aria-live="polite" className={`inline-flex items-center gap-1.5 text-xs font-semibold ${className}`} data-goat-status={status} role="status">
      <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${DOT[status]}`} />
      {statusLabel(status, ai)}
    </span>
  );
}
