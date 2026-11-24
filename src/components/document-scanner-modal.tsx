"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraPicker, cameraProblemText } from "@/components/camera-picker";
import { ScrollLock } from "@/components/scroll-lock";
import { useOfficeCamera } from "@/hooks/use-office-camera";
import { buildScanPdf, defaultScanName, enhanceDocument, moveItem, scanFileName } from "@/lib/scan-pdf";

export interface DocumentScannerModalProps {
  open: boolean;
  onClose: () => void;
  /** Gets the finished multi-page PDF. */
  onCapture: (file: File) => void;
}

interface Page {
  id: string;
  /** Full-resolution photo as taken. */
  original: HTMLCanvasElement;
  /** Same photo with the document look applied. */
  enhanced: HTMLCanvasElement;
  thumb: string;
}

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
  const camera = useOfficeCamera(open, videoRef, streamRef);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);
  const [enhance, setEnhance] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"" | "capture" | "save">("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) return;
    setPages([]);
    setName("");
    setMessage("");
    setRetakeIndex(null);
  }, [open]);

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

  const btn = "rounded-lg border border-[var(--line-soft)] bg-white px-2 py-0.5 text-xs font-semibold disabled:opacity-40";
  const problem = cameraProblemText(camera.camState);

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
          <button className="btn btn-secondary btn-sm" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="mt-3">
          <CameraPicker
            cameraId={camera.cameraId}
            cameras={camera.cameras}
            continuityListed={camera.continuityListed}
            onChange={camera.chooseCamera}
            onRefresh={() => void camera.refresh()}
            refreshing={camera.refreshing}
          />
        </div>

        <div className="relative mt-3">
          <video
            className="max-h-[50vh] w-full rounded-xl bg-black object-contain"
            muted
            playsInline
            ref={videoRef}
            style={{ display: camera.camState === "live" ? "block" : "none" }}
          />
          {camera.camState !== "live" && problem && <p className="text-sm">{problem}</p>}
          {retakeIndex !== null && camera.camState === "live" && (
            <span className="absolute left-3 top-3 rounded-full bg-white px-2 py-0.5 text-xs font-semibold">
              Retaking page {retakeIndex + 1}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="btn btn-primary disabled:opacity-50"
            disabled={camera.camState !== "live" || busy !== ""}
            onClick={capture}
            type="button"
          >
            {busy === "capture" ? "Capturing…" : retakeIndex !== null ? "Capture (replace)" : "Capture"}
          </button>
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} type="button">
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
            className="btn btn-primary disabled:opacity-50"
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
