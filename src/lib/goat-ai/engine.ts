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
}

let state: GoatAiState = { status: "idle", progress: 0, progressText: "", message: "", cached: false, variant: null, model: GOAT_AI_DEFAULT_MODEL };
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
  const downloadMb = GOAT_AI_MODELS[model].downloadMb;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu) {
    return {
      ok: false,
      message: "This browser can't run Smart mode (it needs WebGPU: a recent Chrome or Edge on a computer). Normal G.O.A.T. still works.",
      variant: null,
      cached: false,
    };
  }
  let adapter: { features: Set<string> } | null = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    adapter = null;
  }
  if (!adapter) {
    return { ok: false, message: "Smart mode couldn't start this computer's graphics chip (WebGPU). Normal G.O.A.T. still works.", variant: null, cached: false };
  }
  const variant = adapter.features.has("shader-f16") ? "f16" : "f32";
  let cached = false;
  try {
    const { hasModelInCache } = await import("@mlc-ai/web-llm");
    cached = await hasModelInCache(GOAT_AI_MODELS[model][variant].model_id, appConfig(model, variant));
  } catch {
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
  set({ status: "checking", model });
  const s = await checkGoatAiSupport(model);
  set({ status: s.ok ? "idle" : "unsupported", message: s.message, variant: s.variant, cached: s.cached, model });
}

/** Download (first time) or open from cache, then load onto the GPU. */
export function loadGoatAi(): Promise<void> {
  if (engine) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const model = goatAiModel();
    const s = await checkGoatAiSupport(model);
    if (!s.ok || !s.variant) {
      set({ status: "unsupported", message: s.message, variant: s.variant });
      throw new Error(s.message || "unsupported");
    }
    set({ status: "loading", progress: 0, progressText: s.cached ? "Opening Smart mode…" : "Starting the one-time download…", variant: s.variant, cached: s.cached, model });
    try {
      // Keep the download from being cleared when the browser runs low on space.
      void navigator.storage?.persist?.().catch(() => undefined);
      const webllm = await import("@mlc-ai/web-llm");
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      engine = await webllm.CreateWebWorkerMLCEngine(worker, GOAT_AI_MODELS[model][s.variant].model_id, {
        appConfig: appConfig(model, s.variant),
        initProgressCallback: (p: InitProgressReport) => set({ progress: p.progress, progressText: p.text }),
      });
      set({ status: "ready", progress: 1, progressText: "", cached: true });
    } catch (e) {
      engine = null;
      worker?.terminate();
      worker = null;
      const msg = e instanceof Error ? e.message : String(e);
      set({
        status: "error",
        message: /quota/i.test(msg)
          ? "The browser ran out of storage space for the model. Normal G.O.A.T. still works."
          : /memory|OOM|buffer|device (was )?lost/i.test(msg) && model === "accurate"
          ? "This computer's graphics chip doesn't have enough memory for the more accurate model. Try \"Smaller and faster\" in the Smart mode options. Normal G.O.A.T. still works."
          : `Smart mode couldn't load (${msg.slice(0, 160)}). Normal G.O.A.T. still works.`,
      });
      throw e;
    } finally {
      loading = null;
    }
  })();
  return loading;
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
    await loadGoatAi();
    if (!engine) throw new Error("Smart mode isn't loaded");
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
