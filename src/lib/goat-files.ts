"use client";

/**
 * G.O.A.T. — reading uploaded Patient Files.
 *
 * Text-layer PDFs are read with pdf.js; scanned/faxed pages and images are
 * read with tesseract.js OCR. Both engines run in the browser from copies the
 * app serves itself (public/goat/, see scripts/copy-goat-assets.mjs) — no CDN,
 * no outside service. The file bytes come from NoteGoat's own private storage
 * bucket and the text never leaves NoteGoat.
 *
 * Extracted text is cached so each file is read once:
 *   1. in memory for this session,
 *   2. in this browser's IndexedDB (cleared on sign-out),
 *   3. office-wide, as a small JSON "sidecar" next to the file in the same
 *      private bucket: <first folder>/.goat-text/<rest of the file path>.json.
 *      The bucket's existing policies (owner + office members) apply, so
 *      whoever can open the file can reuse its text, and deleting the file
 *      deletes the sidecar (see file-storage.ts). No database change.
 */

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { FileFolder, FileManagerState, FileRecord } from "@/lib/file-manager";
import type { GoatFile, GoatFileStatus } from "@/lib/goat-docs";

const BUCKET = "user-files";
export const GOAT_TEXT_DB = "notegoat-goat-text";
const STORE = "text";
const VERSION = 1;

/** Stop at this many pages per file (text layer / OCR). */
const MAX_PAGES = 200;
const MAX_OCR_PAGES = 40;

export interface GoatTextRecord {
  v: number;
  path: string;
  size: number;
  method: "text" | "ocr" | "mixed";
  pages: string[];
  pageCount: number;
  /** Pages with no text layer that haven't been OCR'd yet. */
  pendingOcrPages: number[];
  extractedAt: string;
}

// ---------------------------------------------------------------------------
// Which files belong to a patient
// ---------------------------------------------------------------------------

export function patientFileRecords(state: FileManagerState, patientId: string): Array<{ file: FileRecord; folder: string }> {
  const root: FileFolder | undefined = state.folders.find((f) => f.patientId === patientId && f.isSystemFolder && !f.deleted);
  if (!root) return [];
  const ids = new Set([root.id]);
  const names = new Map([[root.id, root.name]]);
  const queue = [root.id];
  while (queue.length) {
    const parent = queue.shift() as string;
    for (const child of state.folders) {
      if (child.parentId === parent && !child.deleted && !ids.has(child.id)) {
        ids.add(child.id);
        names.set(child.id, child.name);
        queue.push(child.id);
      }
    }
  }
  return state.files
    .filter((f) => !f.deleted && ids.has(f.folderId))
    .map((file) => ({ file, folder: names.get(file.folderId) ?? "" }))
    .sort((a, b) => (b.file.createdAt ?? "").localeCompare(a.file.createdAt ?? ""));
}

export function isPdf(file: Pick<FileRecord, "name" | "mimeType">) {
  return /pdf/i.test(file.mimeType ?? "") || /\.pdf$/i.test(file.name ?? "");
}
export function isImage(file: Pick<FileRecord, "name" | "mimeType">) {
  return /^image\/(png|jpe?g|webp|bmp|gif)$/i.test(file.mimeType ?? "") || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name ?? "");
}
export function isReadable(file: Pick<FileRecord, "name" | "mimeType">) {
  return isPdf(file) || isImage(file);
}

// ---------------------------------------------------------------------------
// Cache: memory → IndexedDB → sidecar
// ---------------------------------------------------------------------------

const memory = new Map<string, GoatTextRecord>();
const failed = new Map<string, string>();

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(GOAT_TEXT_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function idbGet(path: string): Promise<GoatTextRecord | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(path);
    req.onsuccess = () => resolve((req.result as GoatTextRecord | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function idbPut(rec: GoatTextRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec, rec.path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function idbDelete(paths: string[]): Promise<void> {
  const db = await openDb();
  if (!db || !paths.length) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    for (const p of paths) tx.objectStore(STORE).delete(p);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** "<uid>/<folder>/<name>.pdf" → "<uid>/.goat-text/<folder>/<name>.pdf.json" (same owner folder, same access rules). */
export function goatSidecarPath(storagePath: string): string | null {
  const i = storagePath.indexOf("/");
  if (i <= 0 || storagePath.includes("/.goat-text/")) return null;
  return `${storagePath.slice(0, i)}/.goat-text/${storagePath.slice(i + 1)}.json`;
}

function validRecord(value: unknown, path: string): GoatTextRecord | null {
  if (!value || typeof value !== "object") return null;
  const r = value as GoatTextRecord;
  if (r.v !== VERSION || r.path !== path || !Array.isArray(r.pages)) return null;
  return { ...r, pendingOcrPages: Array.isArray(r.pendingOcrPages) ? r.pendingOcrPages : [] };
}

async function sidecarGet(path: string): Promise<GoatTextRecord | null> {
  const supabase = getSupabaseBrowserClient();
  const side = goatSidecarPath(path);
  if (!supabase || !side) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(side);
  if (error || !data) return null; // not read yet (404) or no access
  try {
    return validRecord(JSON.parse(await data.text()), path);
  } catch {
    return null;
  }
}

async function sidecarPut(rec: GoatTextRecord): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const side = goatSidecarPath(rec.path);
  if (!supabase || !side) return;
  const body = new Blob([JSON.stringify(rec)], { type: "application/json" });
  const { error } = await supabase.storage.from(BUCKET).upload(side, body, { upsert: true, contentType: "application/json" });
  // Local cache still has it; another device will just read the file itself.
  if (error) console.warn("[goat-files] couldn't save shared text cache:", error.message);
}

/** Drop cached text for deleted files (sidecars are removed by file-storage.ts). */
export async function forgetGoatText(storagePaths: string[]) {
  for (const p of storagePaths) {
    memory.delete(p);
    failed.delete(p);
  }
  await idbDelete(storagePaths);
}

export function cachedText(path: string): GoatTextRecord | null {
  return memory.get(path) ?? null;
}

async function store(rec: GoatTextRecord) {
  memory.set(rec.path, rec);
  failed.delete(rec.path);
  await idbPut(rec);
  await sidecarPut(rec);
  emit();
}

/** Pull already-extracted text (this device first, then the office cache). */
export async function loadCachedText(files: FileRecord[]): Promise<void> {
  const todo = files.filter((f) => f.storagePath && isReadable(f) && !memory.has(f.storagePath));
  let changed = false;
  const worker = async () => {
    for (let f = todo.shift(); f; f = todo.shift()) {
      const local = validRecord(await idbGet(f.storagePath), f.storagePath);
      const rec = local ?? (await sidecarGet(f.storagePath));
      if (rec) {
        memory.set(f.storagePath, rec);
        if (!local) await idbPut(rec);
        changed = true;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (changed) emit();
}

// ---------------------------------------------------------------------------
// Engines (loaded on first use, from /goat/)
// ---------------------------------------------------------------------------

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = "/goat/pdf.worker.min.mjs";
      return m;
    });
  }
  return pdfjsPromise;
}

type TesseractWorker = import("tesseract.js").Worker;
let ocrWorker: Promise<TesseractWorker> | null = null;
let ocrIdleTimer: ReturnType<typeof setTimeout> | null = null;
let ocrPageProgress: ((p: number) => void) | null = null;

function ocr(): Promise<TesseractWorker> {
  if (ocrIdleTimer) clearTimeout(ocrIdleTimer);
  if (!ocrWorker) {
    ocrWorker = import("tesseract.js").then((T) =>
      T.createWorker("eng", T.OEM.LSTM_ONLY, {
        // All local: worker, wasm core and English model are served by NoteGoat.
        workerPath: "/goat/tesseract/worker.min.js",
        corePath: "/goat/tesseract/core",
        langPath: "/goat/tesseract/lang",
        gzip: true,
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text" && ocrPageProgress) ocrPageProgress(m.progress);
        },
      }),
    );
  }
  return ocrWorker;
}

/** Free the OCR engine's memory after a minute of no use. */
function scheduleOcrShutdown() {
  if (ocrIdleTimer) clearTimeout(ocrIdleTimer);
  ocrIdleTimer = setTimeout(() => {
    const w = ocrWorker;
    ocrWorker = null;
    if (w) void w.then((x) => x.terminate()).then(() => undefined, (e: unknown) => console.warn("[goat-files] OCR shutdown:", e));
  }, 60_000);
}

async function ocrCanvas(canvas: HTMLCanvasElement | Blob, onProgress: (p: number) => void): Promise<string> {
  const worker = await ocr();
  ocrPageProgress = onProgress;
  try {
    const { data } = await worker.recognize(canvas);
    return (data.text ?? "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  } finally {
    ocrPageProgress = null;
    scheduleOcrShutdown();
  }
}

const textChars = (s: string) => s.replace(/\s+/g, "").length;

// ---------------------------------------------------------------------------
// Reading one file
// ---------------------------------------------------------------------------

export interface GoatReadProgress {
  fileName: string;
  step: "downloading" | "text" | "ocr";
  page: number;
  pages: number;
  /** 0..1 within the current OCR page. */
  pageProgress: number;
}

async function readPdf(
  bytes: ArrayBuffer,
  path: string,
  size: number,
  withOcr: boolean,
  previous: GoatTextRecord | null,
  report: (p: Omit<GoatReadProgress, "fileName">) => void,
  cancelled: () => boolean,
): Promise<GoatTextRecord> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  const count = Math.min(doc.numPages, MAX_PAGES);
  const pages: string[] = previous?.pages.length === count ? [...previous.pages] : [];
  const pending: number[] = [];
  let ocrDone = 0;
  try {
    if (pages.length !== count) {
      for (let n = 1; n <= count; n++) {
        if (cancelled()) throw new Error("cancelled");
        report({ step: "text", page: n, pages: count, pageProgress: 0 });
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          text += item.str + (item.hasEOL ? "\n" : " ");
        }
        pages.push(text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim());
        page.cleanup();
      }
    }
    // Under ~20 characters a page is a picture of text (scan/fax).
    for (let i = 0; i < pages.length; i++) if (textChars(pages[i]) < 20) pending.push(i + 1);
    if (withOcr && pending.length) {
      const todo = pending.splice(0, Math.min(pending.length, MAX_OCR_PAGES));
      for (const n of todo) {
        if (cancelled()) {
          pending.unshift(n);
          break;
        }
        report({ step: "ocr", page: n, pages: count, pageProgress: 0 });
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        // ~200 dpi for a letter page; capped so huge pages don't eat memory.
        const scale = Math.min(2.8, Math.max(1, 1700 / base.width));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas unavailable");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        pages[n - 1] = await ocrCanvas(canvas, (p) => report({ step: "ocr", page: n, pages: count, pageProgress: p }));
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        ocrDone += 1;
      }
    }
  } finally {
    await task.destroy();
  }
  const hadOcr = ocrDone > 0 || (previous?.method === "ocr" || previous?.method === "mixed");
  const anyText = pages.some((p, i) => textChars(p) >= 20 && !pending.includes(i + 1));
  return {
    v: VERSION,
    path,
    size,
    method: hadOcr ? (anyText && ocrDone < pages.length ? "mixed" : "ocr") : "text",
    pages,
    pageCount: count,
    pendingOcrPages: pending,
    extractedAt: new Date().toISOString(),
  };
}

async function readImage(blob: Blob, path: string, size: number, withOcr: boolean, report: (p: Omit<GoatReadProgress, "fileName">) => void): Promise<GoatTextRecord> {
  if (!withOcr) {
    return { v: VERSION, path, size, method: "ocr", pages: [""], pageCount: 1, pendingOcrPages: [1], extractedAt: new Date().toISOString() };
  }
  report({ step: "ocr", page: 1, pages: 1, pageProgress: 0 });
  const text = await ocrCanvas(blob, (p) => report({ step: "ocr", page: 1, pages: 1, pageProgress: p }));
  return { v: VERSION, path, size, method: "ocr", pages: [text], pageCount: 1, pendingOcrPages: [], extractedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Queue + progress (one file at a time so the app stays responsive)
// ---------------------------------------------------------------------------

interface Job {
  path: string;
  name: string;
  mime: string;
  size: number;
  ocr: boolean;
  /** Bytes already in hand (fresh upload) — skips the download. */
  blob?: Blob;
}

export interface GoatReaderState {
  running: boolean;
  current: GoatReadProgress | null;
  done: number;
  total: number;
}

const queue: Job[] = [];
let currentPath: string | null = null;
let state: GoatReaderState = { running: false, current: null, done: 0, total: 0 };
let cancelFlag = false;
/** "text" = some file's extracted text changed; "progress" = reader status only. */
export type GoatReaderEvent = "text" | "progress";
const listeners = new Set<(event: GoatReaderEvent) => void>();

function emit(event: GoatReaderEvent = "text") {
  for (const l of listeners) l(event);
}

export function subscribeGoatReader(listener: (event: GoatReaderEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function goatReaderState(): GoatReaderState {
  return state;
}

function setState(next: Partial<GoatReaderState>) {
  state = { ...state, ...next };
  emit("progress");
}

export function cancelGoatReading() {
  cancelFlag = true;
  queue.length = 0;
  setState({ total: state.done + (state.running ? 1 : 0) });
}

async function download(path: string): Promise<Blob> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("storage unavailable");
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "download failed");
  return data;
}

async function runQueue() {
  if (state.running) return;
  cancelFlag = false;
  setState({ running: true });
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const name = job.name;
      // Already read meanwhile (e.g. queued twice) — nothing left to do.
      const have = memory.get(job.path);
      if (have && !(job.ocr && have.pendingOcrPages.length)) {
        setState({ done: state.done + 1 });
        continue;
      }
      currentPath = job.path;
      const report = (p: Omit<GoatReadProgress, "fileName">) => setState({ current: { fileName: name, ...p } });
      try {
        report({ step: "downloading", page: 0, pages: 0, pageProgress: 0 });
        const blob = job.blob ?? (await download(job.path));
        const previous = memory.get(job.path) ?? null;
        const rec = isPdf({ name: job.name, mimeType: job.mime })
          ? await readPdf(await blob.arrayBuffer(), job.path, job.size, job.ocr, previous, report, () => cancelFlag)
          : await readImage(blob, job.path, job.size, job.ocr, report);
        await store(rec);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== "cancelled") {
          failed.set(job.path, message);
          console.warn("[goat-files] couldn't read a file:", message);
          emit("text");
        }
      }
      currentPath = null;
      setState({ done: state.done + 1 });
      if (cancelFlag) break;
    }
  } finally {
    setState({ running: false, current: null, ...(queue.length ? {} : { done: 0, total: 0 }) });
  }
}

function enqueue(jobs: Job[]) {
  const fresh = jobs.filter((j) => j.path !== currentPath && !queue.some((q) => q.path === j.path));
  if (!fresh.length) return;
  queue.push(...fresh);
  setState({ total: state.total + fresh.length });
  void runQueue();
}

/**
 * Read these files. `ocr: false` reads text layers only (fast) and marks
 * scanned pages as waiting; `ocr: true` also OCRs scanned pages and images.
 */
export function readGoatFiles(files: FileRecord[], options: { ocr: boolean }) {
  enqueue(
    files
      .filter((f) => f.storagePath && isReadable(f))
      .filter((f) => {
        const rec = memory.get(f.storagePath);
        if (!rec) return true;
        return options.ocr && rec.pendingOcrPages.length > 0;
      })
      .map((f) => ({ path: f.storagePath, name: f.name, mime: f.mimeType, size: f.sizeBytes, ocr: options.ocr })),
  );
}

/** Fresh upload: read straight from the bytes we already have (OCR included). */
export function readUploadedFile(file: File, storagePath: string) {
  if (!storagePath || !isReadable({ name: file.name, mimeType: file.type })) return;
  enqueue([{ path: storagePath, name: file.name, mime: file.type, size: file.size, ocr: true, blob: file }]);
}

/** What G.O.A.T. knows about a file right now. */
export function goatFileFor(file: FileRecord, folder: string): GoatFile {
  const rec = memory.get(file.storagePath);
  let status: GoatFileStatus;
  if (!isReadable(file)) status = "unsupported";
  else if (state.running && state.current?.fileName === file.name) status = "reading";
  // Partly scanned files still count as read (their text pages are usable).
  else if (rec) status = rec.pendingOcrPages.length === rec.pageCount ? "needsOcr" : "read";
  else if (failed.has(file.storagePath)) status = "failed";
  else status = "unread";
  return {
    id: file.id,
    name: file.name,
    folder,
    uploaded: file.createdAt,
    status,
    method: rec?.method,
    pages: rec && rec.pendingOcrPages.length < rec.pageCount ? rec.pages : null,
  };
}

export function pendingOcrCount(files: FileRecord[]): number {
  return files.filter((f) => (memory.get(f.storagePath)?.pendingOcrPages.length ?? 0) > 0).length;
}
