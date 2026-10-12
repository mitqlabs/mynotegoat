"use client";

/**
 * G.O.A.T. Smart mode (beta) — the private in-browser model.
 *
 * Models (4-bit MLC / WebLLM builds), picked per computer:
 *   "accurate": Qwen3-4B, about 2.3 GB, needs a stronger graphics chip (default)
 *   "fast":     Qwen2.5-1.5B-Instruct, about 880 MB, for weaker computers
 * It is downloaded once from Hugging Face's public model CDN (weights only:
 * the requests carry no patient data) and kept in this browser's Cache
 * Storage. The small model runtime file (.wasm) comes from MLC's public
 * build repo on GitHub (pinned commit, see GOAT_AI_LIB_BASE). Inference runs in a Web Worker on this computer's GPU via
 * WebGPU. Questions, patient data and answers never leave the browser: there
 * is no server call, no cloud AI and no telemetry anywhere in this path.
 */

import type { WebWorkerMLCEngine, AppConfig, InitProgressReport } from "@mlc-ai/web-llm";

/** Public weights host (one-time download). Self-host later by pointing this at our own storage. */
export const GOAT_AI_WEIGHTS_BASE = "https://huggingface.co/mlc-ai";
/**
 * The small model runtime files (.wasm, ~5-6 MB each), from MLC's public
 * build repo, pinned to one commit so they can't change underneath us.
 * Not committed to NoteGoat to keep large binaries out of the repo; to
 * self-host, copy the four files to /public/goat-ai/ and point this there.
 */
export const GOAT_AI_LIB_BASE =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base";

export type GoatAiModel = "accurate" | "fast";

/**
 * Local test harness only (stripped from production builds): replies recorded
 * from the same model + prompt on a machine without a GPU, so the UI can be
 * checked end to end. Never set in the app.
 */
function devReplay(): ((messages: Array<{ role: string; content: string }>) => string) | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  return (window as unknown as { __goatAiReplay?: (m: Array<{ role: string; content: string }>) => string }).__goatAiReplay ?? null;
}

export const GOAT_AI_MODELS: Record<
  GoatAiModel,
  { label: string; name: string; downloadMb: number; gpuMb: number; thinking: boolean; f16: { model_id: string; model_lib: string }; f32: { model_id: string; model_lib: string } }
> = {
  accurate: {
    label: "More accurate",
    name: "Qwen3-4B (4-bit)",
    downloadMb: 2280,
    gpuMb: 3400,
    thinking: true,
    f16: { model_id: "Qwen3-4B-q4f16_1-MLC", model_lib: `${GOAT_AI_LIB_BASE}/Qwen3-4B-q4f16_1_cs1k-webgpu.wasm` },
    f32: { model_id: "Qwen3-4B-q4f32_1-MLC", model_lib: `${GOAT_AI_LIB_BASE}/Qwen3-4B-q4f32_1_cs1k-webgpu.wasm` },
  },
  fast: {
    label: "Smaller and faster",
    name: "Qwen2.5-1.5B-Instruct (4-bit)",
    downloadMb: 880,
    gpuMb: 1700,
    thinking: false,
    f16: { model_id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", model_lib: `${GOAT_AI_LIB_BASE}/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm` },
    f32: { model_id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", model_lib: `${GOAT_AI_LIB_BASE}/Qwen2-1.5B-Instruct-q4f32_1_cs1k-webgpu.wasm` },
  },
};

const MODEL_KEY = "notegoat.goat-smart-model.v1";
export const GOAT_AI_DEFAULT_MODEL: GoatAiModel = "accurate";

/** This computer's model choice (not synced: it depends on the computer's graphics chip). */
export function goatAiModel(): GoatAiModel {
  try {
    const v = window.localStorage.getItem(MODEL_KEY);
    return v === "fast" || v === "accurate" ? v : GOAT_AI_DEFAULT_MODEL;
  } catch {
    return GOAT_AI_DEFAULT_MODEL;
  }
}

/** Switch models. Unloads the current one; the other is downloaded on next use. */
export function setGoatAiModel(model: GoatAiModel) {
  if (model === goatAiModel() && state.model === model) return;
  try {
    window.localStorage.setItem(MODEL_KEY, model);
  } catch {
    // ignore
  }
  void engine?.unload().catch(() => undefined);
  engine = null;
  worker?.terminate();
  worker = null;
  set({ status: "idle", progress: 0, progressText: "", message: "", cached: false, model });
  void refreshGoatAiSupport();
}

/** Back-compat for UI copy: the chosen model's download size. */
export function goatAiDownloadMb(model: GoatAiModel = goatAiModel()): number {
  return GOAT_AI_MODELS[model].downloadMb;
}

export type GoatAiStatus = "idle" | "checking" | "unsupported" | "loading" | "ready" | "error";

export interface GoatAiState {
  status: GoatAiStatus;
  /** 0..1 while loading. */
  progress: number;
  progressText: string;
  /** Why it can't run (no WebGPU, not enough storage, …). */
  message: string;
  /** The weights are already in this browser (no download needed). */
  cached: boolean;
  /** Which build: "f16" on GPUs with 16-bit shader support, else "f32". */
  variant: "f16" | "f32" | null;
  model: GoatAiModel;
  /** No progress for STALL_MS while loading: show a plain message with Retry / smaller model. */
  stalled?: boolean;
}

/** No load progress for this long = stalled (shown to the user with Retry). */
export const GOAT_AI_STALL_MS = 3 * 60 * 1000;

/**
 * WebLLM reports several phases, and each one restarts at 0%..100%:
 *   "Start to fetch params" → "Fetching param cache[i/n]: … % completed" (download, by bytes)
 *   → "Loading model from cache[i/n]" (weights onto the graphics chip)
 *   → "Loading GPU shader modules[i/n]" (compiling for this computer; can take minutes on Macs)
 *   → "Finish loading on <GPU>".
 * Showing only report.progress made it look stuck near the end (e.g. 95%) while a later phase ran.
 */
export function goatAiPhaseText(raw: string, progress: number, cached: boolean): string {
  const pct = `${Math.round(progress * 100)}%`;
  if (/^Fetching param cache/i.test(raw)) return cached ? `Opening + mode… ${pct}` : `Downloading… ${pct} (one time, stays on this computer)`;
  if (/^Start to fetch/i.test(raw)) return cached ? "Opening + mode…" : "Starting the one-time download…";
  if (/^Loading model from cache/i.test(raw)) return `Loading into graphics… ${pct}`;
  if (/shader/i.test(raw)) return `Preparing the model on this computer… ${pct} (this can take a few minutes)`;
  if (/^Finish loading/i.test(raw)) return "Ready";
  return `Getting + mode ready… ${pct}`;
}

let state: GoatAiState = { status: "idle", progress: 0, progressText: "", message: "", cached: false, variant: null, model: GOAT_AI_DEFAULT_MODEL };
let lastProgressAt = 0;
let stallTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
let engine: WebWorkerMLCEngine | null = null;
let worker: Worker | null = null;
let loading: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function set(patch: Partial<GoatAiState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function goatAiState(): GoatAiState {
  return state;
}

export function subscribeGoatAi(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function appConfig(model: GoatAiModel, variant: "f16" | "f32"): AppConfig {
  const m = GOAT_AI_MODELS[model][variant];
  return {
    model_list: [
      {
        model: `${GOAT_AI_WEIGHTS_BASE}/${m.model_id}`,
        model_id: m.model_id,
        model_lib: m.model_lib,
        overrides: { context_window_size: 4096 },
      },
    ],
    cacheBackend: "cache",
  };
}

/** Can this browser run Smart mode? Picks the f16/f32 build. No download. */
export async function checkGoatAiSupport(
  model: GoatAiModel = goatAiModel(),
): Promise<{ ok: boolean; message: string; variant: "f16" | "f32" | null; cached: boolean }> {
  if (typeof window === "undefined") return { ok: false, message: "", variant: null, cached: false };
  if (devReplay()) return { ok: true, message: "", variant: "f16", cached: true };
  const downloadMb = GOAT_AI_MODELS[model].downloadMb;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu) {
    return {
      ok: false,
      message: "This browser can't run + mode (it needs WebGPU: a recent Chrome or Edge on a computer). Normal G.O.A.T. still works.",
      variant: null,
      cached: false,
    };
  }
  let adapter: { features: Set<string> } | null = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (e) {
    console.error("[goat+] WebGPU requestAdapter failed", e);
    adapter = null;
  }
  if (!adapter) {
    return { ok: false, message: "This computer's graphics can't run + mode (Chrome's WebGPU didn't start; see chrome://gpu). Normal G.O.A.T. still works.", variant: null, cached: false };
  }
  const variant = adapter.features.has("shader-f16") ? "f16" : "f32";
  let cached = false;
  try {
    const { hasModelInCache } = await import("@mlc-ai/web-llm");
    cached = await hasModelInCache(GOAT_AI_MODELS[model][variant].model_id, appConfig(model, variant));
  } catch (e) {
    console.error("[goat+] couldn't load the + mode code (web-llm chunk) or read its cache", e);
    cached = false;
  }
  if (!cached && navigator.storage?.estimate) {
    try {
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      if (quota && quota - usage < downloadMb * 1.2 * 1024 * 1024) {
        return { ok: false, message: `Not enough free browser storage for the one-time ${downloadMb} MB download. Normal G.O.A.T. still works.`, variant, cached };
      }
    } catch {
      // estimate isn't critical
    }
  }
  return { ok: true, message: "", variant, cached };
}

export async function refreshGoatAiSupport(): Promise<void> {
  if (state.status === "loading" || state.status === "ready") return;
  const model = goatAiModel();
  if (loading) return;
  set({ status: "checking", model });
  const s = await checkGoatAiSupport(model);
  // A Turn on (loadGoatAi) may have started while this check ran: don't
  // overwrite its "loading" state with "idle" (that hid the download progress).
  const now = goatAiState().status;
  if (loading || now === "loading" || now === "ready") return;
  set({ status: s.ok ? "idle" : "unsupported", message: s.message, variant: s.variant, cached: s.cached, model });
}

/** Download (first time) or open from cache, then load onto the GPU. */
export function loadGoatAi(): Promise<void> {
  if (engine) return Promise.resolve();
  if (devReplay()) {
    set({ status: "ready", progress: 1, cached: true });
    return Promise.resolve();
  }
  if (loading) return loading;
  loading = (async () => {
    const model = goatAiModel();
    set({ status: "checking", progressText: "Checking this computer…", message: "", model });
    console.info("[goat+] checking this computer for + mode", { model });
    const s = await checkGoatAiSupport(model);
    console.info("[goat+] support check", s);
    if (!s.ok || !s.variant) {
      set({ status: "unsupported", message: s.message, variant: s.variant });
      throw new Error(s.message || "unsupported");
    }
    set({ status: "loading", progress: 0, progressText: s.cached ? "Opening + mode…" : "Starting the one-time download…", variant: s.variant, cached: s.cached, model });
    startStallWatch();
    try {
      // Keep the download from being cleared when the browser runs low on space.
      void navigator.storage
        ?.persist?.()
        .then((granted) => console.info(`[goat+] persistent storage ${granted ? "granted" : "not granted"}`))
        .catch((e) => console.warn("[goat+] persistent storage request failed", e));
      void logStorage("before load");
      const webllm = await import("@mlc-ai/web-llm");
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("error", (ev) => console.error("[goat+] model worker error", ev.message || ev));
      worker.addEventListener("messageerror", (ev) => console.error("[goat+] model worker message error", ev));
      engine = await webllm.CreateWebWorkerMLCEngine(worker, GOAT_AI_MODELS[model][s.variant].model_id, {
        appConfig: appConfig(model, s.variant),
        initProgressCallback: (p: InitProgressReport) => {
          lastProgressAt = Date.now();
          // Every report (WebLLM already sends at most about one a second).
          console.info(`[goat+] ${p.text}`);
          set({ progress: p.progress, progressText: goatAiPhaseText(p.text, p.progress, s.cached), stalled: false });
        },
      });
      stopStallWatch();
      console.info("[goat+] + mode ready");
      set({ status: "ready", progress: 1, progressText: "", cached: true, stalled: false });
    } catch (e) {
      stopStallWatch();
      console.error("[goat+] + mode load failed", e);
      engine = null;
      worker?.terminate();
      worker = null;
      const msg = e instanceof Error ? e.message : String(e);
      set({
        status: "error",
        message: /quota/i.test(msg)
          ? "The browser ran out of storage space for the model. Normal G.O.A.T. still works."
          : /memory|OOM|buffer|device (was )?lost/i.test(msg) && model === "accurate"
          ? "This computer's graphics chip doesn't have enough memory for the more accurate model. Try \"Smaller and faster\" in Settings → G.O.A.T. → + mode. Normal G.O.A.T. still works."
          : /maxStorageBufferBindingSize|limit|adapter|feature/i.test(msg)
          ? `This computer's graphics can't run the more accurate model (${msg.slice(0, 120)}). Try "Smaller and faster" in Settings → G.O.A.T. → + mode. Normal G.O.A.T. still works.`
          : /fetch|network|load failed|404|403|cors/i.test(msg)
          ? `Download blocked: ${msg.slice(0, 160)}. Check the internet connection or any firewall / ad blocker, then try again. Normal G.O.A.T. still works.`
          : `+ mode couldn't load (${msg.slice(0, 160)}). Normal G.O.A.T. still works.`,
      });
      throw e;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Browser storage for this site (Cache API + IndexedDB + localStorage share it). */
async function logStorage(when: string) {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return;
    const mb = (b = 0) => Math.round(b / (1024 * 1024));
    const free = mb((e.quota ?? 0) - (e.usage ?? 0));
    console.info(`[goat+] storage ${when}: used ${mb(e.usage)} MB of ${mb(e.quota)} MB (${free} MB free)`);
    if (free < GOAT_AI_MODELS[goatAiModel()].downloadMb * 1.2) console.warn(`[goat+] only ${free} MB free for the ${GOAT_AI_MODELS[goatAiModel()].downloadMb} MB model: the download can fail or hang`);
  } catch (err) {
    console.warn("[goat+] storage estimate failed", err);
  }
}

function stopStallWatch() {
  if (stallTimer) clearInterval(stallTimer);
  stallTimer = null;
}

function startStallWatch() {
  stopStallWatch();
  lastProgressAt = Date.now();
  stallTimer = setInterval(() => {
    if (state.status !== "loading") return stopStallWatch();
    const idle = Date.now() - lastProgressAt;
    if (idle >= GOAT_AI_STALL_MS && !state.stalled) {
      console.warn(`[goat+] no load progress for ${Math.round(idle / 1000)}s at "${state.progressText}" (${Math.round(state.progress * 100)}%)`);
      void logStorage("stalled");
      set({ stalled: true });
    }
  }, 15000);
}

/** Stop a stuck load and start again (downloaded parts are kept in the browser cache). */
export function retryGoatAi(model?: GoatAiModel): Promise<void> {
  console.info("[goat+] retrying + mode load", { model: model ?? goatAiModel() });
  stopStallWatch();
  void engine?.unload().catch(() => undefined);
  engine = null;
  worker?.terminate();
  worker = null;
  loading = null;
  if (model && model !== goatAiModel()) {
    try {
      window.localStorage.setItem(MODEL_KEY, model);
    } catch (e) {
      console.warn("[goat+] couldn't save the model choice", e);
    }
  }
  set({ status: "idle", progress: 0, progressText: "", message: "", stalled: false, model: goatAiModel() });
  return loadGoatAi();
}

export interface GoatAiRun {
  text: string;
  ms: number;
  /** Time to first token. */
  firstTokenMs: number;
  tokens: number;
}

/**
 * Stream an answer. Runs one question at a time. `onText` gets the whole text so far.
 */
export function runGoatAi(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onText: (text: string) => void,
  opts: { maxTokens?: number } = {},
): Promise<GoatAiRun> {
  const job = queue.then(async () => {
    const replay = devReplay();
    if (replay) {
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 600));
      const text = replay(messages);
      onText(text);
      return { text, ms: performance.now() - t0, firstTokenMs: 300, tokens: 0 };
    }
    await loadGoatAi();
    if (!engine) throw new Error("+ mode isn't loaded");
    const t0 = performance.now();
    let first = 0;
    let text = "";
    let tokens = 0;
    const stream = await engine.chat.completions.create({
      messages,
      stream: true,
      temperature: 0,
      // Qwen3: answer directly (no hidden "thinking" pass) — faster, and the prompt already says how.
      ...(GOAT_AI_MODELS[state.model].thinking ? { extra_body: { enable_thinking: false } } : {}),
      max_tokens: opts.maxTokens ?? 500,
      stream_options: { include_usage: true },
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        if (!first) first = performance.now() - t0;
        text += delta;
        onText(text.replace(/<think>[\s\S]*?(<\/think>\s*|$)/g, ""));
      }
      if (chunk.usage) tokens = chunk.usage.completion_tokens;
    }
    text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
    return { text, ms: performance.now() - t0, firstTokenMs: first, tokens };
  });
  queue = job.catch(() => undefined);
  return job;
}

export function stopGoatAi() {
  void engine?.interruptGenerate();
}

// ---------------------------------------------------------------------------
// Removing the downloaded model from this computer
// ---------------------------------------------------------------------------

async function usageBytes(): Promise<number> {
  try {
    return (await navigator.storage?.estimate?.())?.usage ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Is any + mode model data in this browser? Looks only at storage names (Cache
 * Storage / IndexedDB), so WebLLM's code isn't loaded: used while + mode is off.
 */
export async function hasGoatAiDownload(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    if ((await caches.keys()).some((n) => /webllm|mlc/i.test(n))) return true;
  } catch {
    // Cache Storage unavailable
  }
  try {
    const dbs = await (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases?.();
    return (dbs ?? []).some((db) => Boolean(db.name && /webllm|mlc/i.test(db.name)));
  } catch {
    return false;
  }
}

/** Which models are downloaded in this browser (either build). */
export async function downloadedGoatAiModels(): Promise<GoatAiModel[]> {
  if (typeof window === "undefined") return [];
  if (devReplay()) return (window as unknown as { __goatAiReplayRemoved?: boolean }).__goatAiReplayRemoved ? [] : [goatAiModel()];
  try {
    const { hasModelInCache } = await import("@mlc-ai/web-llm");
    const out: GoatAiModel[] = [];
    for (const model of Object.keys(GOAT_AI_MODELS) as GoatAiModel[]) {
      for (const variant of ["f16", "f32"] as const) {
        if (await hasModelInCache(GOAT_AI_MODELS[model][variant].model_id, appConfig(model, variant)).catch(() => false)) {
          out.push(model);
          break;
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Delete every Smart mode model file from this browser (weights, runtime,
 * config: Cache Storage and IndexedDB entries) and unload it. Returns the MB
 * freed (from the browser's storage estimate; the model sizes when the
 * browser doesn't report it).
 */
export async function removeGoatAiModels(): Promise<{ freedMb: number; removed: GoatAiModel[] }> {
  const removed = await downloadedGoatAiModels();
  if (devReplay()) (window as unknown as { __goatAiReplayRemoved?: boolean }).__goatAiReplayRemoved = true;
  const before = await usageBytes();
  void engine?.unload().catch(() => undefined);
  engine = null;
  worker?.terminate();
  worker = null;
  loading = null;
  try {
    const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
    for (const model of Object.keys(GOAT_AI_MODELS) as GoatAiModel[]) {
      for (const variant of ["f16", "f32"] as const) {
        await deleteModelAllInfoInCache(GOAT_AI_MODELS[model][variant].model_id, appConfig(model, variant)).catch(() => undefined);
      }
    }
  } catch {
    // fall through to the cache sweep
  }
  // Anything left under WebLLM's cache names.
  try {
    for (const name of await caches.keys()) if (/webllm|mlc/i.test(name)) await caches.delete(name);
  } catch {
    // Cache Storage unavailable
  }
  try {
    const dbs = await (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases?.();
    for (const db of dbs ?? []) if (db.name && /webllm|mlc/i.test(db.name)) indexedDB.deleteDatabase(db.name);
  } catch {
    // IndexedDB listing unsupported
  }
  const after = await usageBytes();
  const measured = Math.max(0, Math.round((before - after) / (1024 * 1024)));
  const freedMb = measured || removed.reduce((n, m) => n + GOAT_AI_MODELS[m].downloadMb, 0);
  set({ status: "idle", progress: 0, progressText: "", message: "", cached: false });
  return { freedMb, removed };
}
