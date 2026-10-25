"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollLock } from "@/components/scroll-lock";
import {
  buildScanPdf,
  defaultScanName,
  enhanceDocument,
  isIphoneCamera,
  moveItem,
  pickCamera,
  scanFileName,
  type CameraOption,
} from "@/lib/scan-pdf";

export interface DocumentScannerModalProps {
  open: boolean;
  onClose: () => void;
  /** Gets the finished multi-page PDF. */
  onCapture: (file: File) => void;
}

/** The camera picked last time. A "user" key: mirrored to the signed-in
 *  user's cloud row (user-prefs-cloud.ts), so it follows them. */
const CAMERA_KEY = "casemate.scanner-camera.v1";

interface Page {
  id: string;
  /** Full-resolution photo as taken. */
  original: HTMLCanvasElement;
  /** Same photo with the document look applied. */
  enhanced: HTMLCanvasElement;
  thumb: string;
}

type CamState = "starting" | "live" | "denied" | "none" | "error";

// ImageCapture isn't in every TS DOM lib yet.
type ImageCaptureLike = { takePhoto: () => Promise<Blob> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

function loadImage(blob: Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that picture"));
    };
    img.src = url;
  });
}

function makeEnhanced(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  enhanceDocument(data.data);
  ctx.putImageData(data, 0, 0);
  return c;
}

function makeThumb(src: HTMLCanvasElement): string {
  const c = document.createElement("canvas");
  const s = 160 / Math.max(src.width, src.height);
  c.width = Math.round(src.width * s);
  c.height = Math.round(src.height * s);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

function toJpeg(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error("Couldn't save page"))),
      "image/jpeg",
      0.9,
    ),
  );
}

export function DocumentScannerModal({ open, onClose, onCapture }: DocumentScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [camState, setCamState] = useState<CamState>("starting");
  const [pages, setPages] = useState<Page[]>([]);
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);
  const [enhance, setEnhance] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"" | "capture" | "save">("");
  const [message, setMessage] = useState("");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Open: list cameras and pick one (last used → iPhone → first).
  useEffect(() => {
    if (!open) {
      stopStream();
      setPages([]);
      setName("");
      setMessage("");
      setRetakeIndex(null);
      setCameraId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setCamState("starting");
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamState("none");
        return;
      }
      try {
        // Labels are blank until the browser has camera permission.
        const probe = await navigator.mediaDevices.getUserMedia({ video: true });
        probe.getTracks().forEach((t) => t.stop());
      } catch (err) {
        if (cancelled) return;
        const n = (err as DOMException)?.name;
        setCamState(n === "NotAllowedError" || n === "SecurityError" ? "denied" : n === "NotFoundError" || n === "OverconstrainedError" ? "none" : "error");
        return;
      }
      const list = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      if (cancelled) return;
      if (list.length === 0) {
        setCamState("none");
        return;
      }
      let last: string | null = null;
      try {
        last = window.localStorage.getItem(CAMERA_KEY);
      } catch {
        /* no saved choice */
      }
      setCameras(list);
      setCameraId(pickCamera(list, last));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, stopStream]);

  // Start the chosen camera at the highest resolution it offers.
  useEffect(() => {
    if (!open || !cameraId) return;
    let cancelled = false;
    stopStream();
    setCamState("starting");
    navigator.mediaDevices
      .getUserMedia({
        video: { deviceId: { exact: cameraId }, width: { ideal: 4032 }, height: { ideal: 3024 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch((e) => console.warn("[scanner] preview play failed", e));
        }
        setCamState("live");
      })
      .catch((err) => {
        if (cancelled) return;
        const n = (err as DOMException)?.name;
        setCamState(n === "NotAllowedError" ? "denied" : n === "NotFoundError" ? "none" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, cameraId, stopStream]);

  useEffect(() => () => stopStream(), [stopStream]);

  const chooseCamera = (id: string) => {
    setCameraId(id);
    try {
      window.localStorage.setItem(CAMERA_KEY, id);
    } catch {
      /* storage full / blocked: still works, just not remembered */
    }
  };

  const addPage = useCallback(
    (original: HTMLCanvasElement) => {
      const page: Page = { id: `${Date.now()}-${Math.random()}`, original, enhanced: makeEnhanced(original), thumb: "" };
      page.thumb = makeThumb(enhance ? page.enhanced : page.original);
      setPages((cur) => {
        if (retakeIndex !== null && retakeIndex < cur.length) {
          const next = cur.slice();
          next[retakeIndex] = page;
          return next;
        }
        return [...cur, page];
      });
      setRetakeIndex(null);
    },
    [enhance, retakeIndex],
  );

  const capture = async () => {
    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!video || !track) return;
    setBusy("capture");
    setMessage("");
    try {
      let canvas: HTMLCanvasElement | null = null;
      const IC = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
      if (IC) {
        try {
          canvas = await loadImage(await new IC(track).takePhoto());
        } catch {
          canvas = null; // fall back to a frame grab
        }
      }
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")!.drawImage(video, 0, 0);
      }
      addPage(canvas);
    } catch {
      setMessage("That picture didn't take. Try Capture again.");
    } finally {
      setBusy("");
    }
  };

  const addFromFile = async (file: File | null) => {
    if (!file) return;
    try {
      addPage(await loadImage(file));
    } catch {
      setMessage("Couldn't read that picture. Try a JPG or PNG.");
    }
  };

  // Re-draw thumbnails when Enhance is flipped.
  useEffect(() => {
    setPages((cur) => cur.map((p) => ({ ...p, thumb: makeThumb(enhance ? p.enhanced : p.original) })));
  }, [enhance]);

  const save = async () => {
    if (pages.length === 0) return;
    setBusy("save");
    setMessage("");
    try {
      const out = [];
      for (const p of pages) {
        const c = enhance ? p.enhanced : p.original;
        out.push({ jpeg: await toJpeg(c), width: c.width, height: c.height });
      }
      const pdf = buildScanPdf(out);
      onCapture(new File([pdf as BlobPart], scanFileName(name), { type: "application/pdf" }));
      onClose();
    } catch {
      setMessage("Couldn't make the PDF. Nothing was saved; please try again.");
    } finally {
      setBusy("");
    }
  };

  if (!open) return null;

  const phoneListed = cameras.some((c) => isIphoneCamera(c.label));
  const btn = "rounded-lg border border-[var(--line-soft)] bg-white px-2 py-0.5 text-xs font-semibold disabled:opacity-40";

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.65)] px-4 py-6">
      <ScrollLock />
      <section className="w-full max-w-3xl rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]" data-testid="scanner">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xl font-semibold">Scan Document</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Hold the page up to the camera and click Capture. Add as many pages as you need, then Save.
            </p>
          </div>
          <button className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-sm font-semibold" htmlFor="scan-camera">Camera</label>
          <select
            className="min-w-[220px] rounded-lg border border-[var(--line-soft)] px-2 py-1 text-sm"
            disabled={cameras.length === 0}
            id="scan-camera"
            onChange={(e) => chooseCamera(e.target.value)}
            value={cameraId ?? ""}
          >
            {cameras.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label}
              </option>
            ))}
          </select>
          {!phoneListed && (
            <span className="text-xs text-[var(--text-muted)]">Bring your iPhone near your Mac to use it as the camera.</span>
          )}
        </div>

        <div className="relative mt-3 flex min-h-[280px] items-center justify-center overflow-hidden rounded-xl bg-[#0e293e]">
          <video
            className="max-h-[50vh] w-full object-contain"
            muted
            playsInline
            ref={videoRef}
            style={{ display: camState === "live" ? "block" : "none" }}
          />
          {camState !== "live" && (
            <div className="max-w-md px-6 py-10 text-center text-sm text-white">
              {camState === "starting" && <p className="font-semibold">Starting the camera…</p>}
              {camState === "denied" && (
                <>
                  <p className="font-semibold">The browser isn&apos;t allowed to use the camera.</p>
                  <p className="mt-2 opacity-80">
                    Click the camera icon in the address bar (or your browser&apos;s site settings), choose Allow, then close and reopen Scan.
                  </p>
                </>
              )}
              {camState === "none" && (
                <>
                  <p className="font-semibold">No camera found.</p>
                  <p className="mt-2 opacity-80">Plug in a camera or bring your iPhone near your Mac, then reopen Scan. You can also add a photo you already have.</p>
                </>
              )}
              {camState === "error" && (
                <>
                  <p className="font-semibold">The camera didn&apos;t start.</p>
                  <p className="mt-2 opacity-80">It may be in use by another app (like Zoom or FaceTime). Close that app or pick another camera.</p>
                </>
              )}
            </div>
          )}
          {retakeIndex !== null && (
            <span className="absolute left-3 top-3 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-black">
              Retaking page {retakeIndex + 1}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-50"
            disabled={camState !== "live" || busy !== ""}
            onClick={capture}
            type="button"
          >
            {busy === "capture" ? "Capturing…" : retakeIndex !== null ? "Capture (replace)" : "Capture"}
          </button>
          <button className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold" onClick={() => fileInputRef.current?.click()} type="button">
            Add a photo
          </button>
          {retakeIndex !== null && (
            <button className="text-sm font-semibold text-[var(--text-muted)] underline" onClick={() => setRetakeIndex(null)} type="button">
              Cancel retake
            </button>
          )}
          <label className="ml-auto flex items-center gap-2 text-sm font-semibold">
            <input checked={enhance} onChange={(e) => setEnhance(e.target.checked)} type="checkbox" />
            Enhance (black &amp; white document)
          </label>
        </div>
        <input
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void addFromFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />

        {pages.length > 0 && (
          <ol className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {pages.map((p, i) => (
              <li className={`flex shrink-0 flex-col items-center gap-1 rounded-lg border p-1.5 ${retakeIndex === i ? "border-amber-400" : "border-[var(--line-soft)]"}`} key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={`Page ${i + 1}`} className="h-24 w-auto rounded" src={p.thumb} />
                <span className="text-xs font-semibold">Page {i + 1}</span>
                <div className="flex gap-1">
                  <button aria-label="Move left" className={btn} disabled={i === 0} onClick={() => setPages((c) => moveItem(c, i, i - 1))} type="button">←</button>
                  <button aria-label="Move right" className={btn} disabled={i === pages.length - 1} onClick={() => setPages((c) => moveItem(c, i, i + 1))} type="button">→</button>
                </div>
                <div className="flex gap-1">
                  <button className={btn} onClick={() => setRetakeIndex(i)} type="button">Retake</button>
                  <button className={`${btn} text-red-600`} onClick={() => { setPages((c) => c.filter((_, j) => j !== i)); setRetakeIndex(null); }} type="button">Delete</button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {message && <p className="mt-2 text-sm font-semibold text-red-600">{message}</p>}

        <div className="mt-4 flex flex-wrap items-end justify-end gap-2 border-t border-[var(--line-soft)] pt-3">
          <label className="mr-auto flex min-w-[240px] flex-1 flex-col text-sm font-semibold">
            File name
            <input
              className="mt-1 rounded-lg border border-[var(--line-soft)] px-2 py-1.5 font-normal"
              onChange={(e) => setName(e.target.value)}
              placeholder={defaultScanName()}
              value={name}
            />
            <span className="mt-1 text-xs font-normal text-[var(--text-muted)]">The case # and patient name are added in front automatically.</span>
          </label>
          <button
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-50"
            disabled={pages.length === 0 || busy !== ""}
            onClick={save}
            type="button"
          >
            {busy === "save" ? "Saving…" : pages.length > 1 ? `Save ${pages.length} pages as PDF` : "Save as PDF"}
          </button>
        </div>
      </section>
    </div>
  );
}
