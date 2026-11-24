"use client";

import { useEffect, useRef, useState } from "react";
import { onLocalChange } from "@/lib/local-sync";
import {
  getFilesInFolder,
  getFoldersInParent,
  loadFileManagerState,
  type FileRecord,
} from "@/lib/file-manager";
import { getSignedUrl } from "@/lib/file-storage";
import { isChoosableIdFile } from "@/lib/id-file-name";
import { splitFullName } from "@/lib/patient-folders";
import {
  cropImageToJpeg,
  initialPortraitCrop,
  movePhotoCrop,
  resizePhotoCrop,
  type CropEdge,
  type PhotoCrop,
} from "@/lib/patient-photo";

const CROP_HANDLES: { edge: CropEdge; label: string; className: string }[] = [
  { edge: "n", label: "Resize top", className: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize" },
  { edge: "s", label: "Resize bottom", className: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize" },
  { edge: "e", label: "Resize right", className: "right-0 top-1/2 -translate-y-1/2 translate-x-1/2 cursor-ew-resize" },
  { edge: "w", label: "Resize left", className: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize" },
  { edge: "nw", label: "Resize top left", className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize" },
  { edge: "ne", label: "Resize top right", className: "right-0 top-0 -translate-y-1/2 translate-x-1/2 cursor-nesw-resize" },
  { edge: "sw", label: "Resize bottom left", className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize" },
  { edge: "se", label: "Resize bottom right", className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize" },
];

/**
 * Free crop. Pointer events cover a mouse and a finger, including an iPhone.
 * The picture is drawn at the largest size that fits the frame. Crop numbers
 * stay in source pixels; the on-screen box is those pixels times the live scale.
 */
export function PatientPhotoCropper({
  src,
  onCancel,
  onSave,
}: {
  src: string;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<PhotoCrop | null>(null);
  const [shownScale, setShownScale] = useState(0);
  const [error, setError] = useState("");
  const drag = useRef<{ mode: "move" | CropEdge; x: number; y: number; crop: PhotoCrop } | null>(null);

  const scale = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return shownScale > 0 ? shownScale : 1;
    const live = img.clientWidth / img.naturalWidth;
    return live > 0 ? live : 1;
  };

  const onLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setCrop(initialPortraitCrop(img.naturalWidth, img.naturalHeight));
  };

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !natural.w || !natural.h) return;
    const fit = () => {
      const style = getComputedStyle(frame);
      const maxW = frame.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const maxH = frame.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (maxW < 8 || maxH < 8) return;
      const next = Math.min(maxW / natural.w, maxH / natural.h);
      if (next > 0) setShownScale(next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [natural.w, natural.h]);

  const onPointerDown = (event: React.PointerEvent, mode: "move" | CropEdge) => {
    if (!crop) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { mode, x: event.clientX, y: event.clientY, crop };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const active = drag.current;
    if (!active || !natural.w) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    const next =
      active.mode === "move"
        ? movePhotoCrop(natural.w, natural.h, active.crop, dx, dy, scale())
        : resizePhotoCrop(natural.w, natural.h, active.crop, active.mode, dx, dy, scale());
    setCrop(next);
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const save = () => {
    const img = imgRef.current;
    if (!img || !crop) return;
    const dataUrl = cropImageToJpeg(img, crop);
    if (!dataUrl.startsWith("data:image/jpeg")) {
      setError("Could not crop that picture. Try another one.");
      return;
    }
    onSave(dataUrl);
  };

  const fitted = natural.w > 0 && shownScale > 0;
  const box = crop && fitted
    ? { left: crop.x * shownScale, top: crop.y * shownScale, width: crop.w * shownScale, height: crop.h * shownScale }
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#0e2944]/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="patient-photo-title">
      <div className="flex h-[100dvh] w-full max-w-none flex-col overflow-hidden bg-white sm:h-[85vh] sm:max-h-[85vh] sm:max-w-[900px] sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h3 className="text-base font-semibold text-[#172a3a]" id="patient-photo-title">Crop photo</h3>
          <button className="rounded-full px-2 py-1 text-sm font-semibold text-[#6b8496]" onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
        <div ref={frameRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#10283d] px-3 py-3">
          {src && (
            <div
              className="relative touch-none"
              style={fitted ? { width: natural.w * shownScale, height: natural.h * shownScale } : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Picture to crop"
                className={fitted ? "block h-full w-full select-none" : "pointer-events-none absolute h-px w-px opacity-0"}
                draggable={false}
                onLoad={onLoad}
                ref={imgRef}
                src={src}
              />
              {box && (
                <div
                  className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(8,20,32,0.55)]"
                  onPointerDown={(event) => onPointerDown(event, "move")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                >
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-1/3 top-0 h-full w-px bg-white/50" />
                    <div className="absolute left-2/3 top-0 h-full w-px bg-white/50" />
                    <div className="absolute left-0 top-1/3 h-px w-full bg-white/50" />
                    <div className="absolute left-0 top-2/3 h-px w-full bg-white/50" />
                  </div>
                  {CROP_HANDLES.map((handle) => (
                    <button
                      aria-label={handle.label}
                      className={`absolute h-9 w-9 touch-none rounded-md border-2 border-white bg-[var(--btn-bg,var(--brand-primary))] ${handle.className}`}
                      key={handle.edge}
                      onPointerDown={(event) => onPointerDown(event, handle.edge)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      type="button"
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {error && <p className="px-4 pt-2 text-sm font-semibold text-[#c9423a]">{error}</p>}
        <div className="flex justify-end gap-2 px-4 py-3">
          <button className="rounded-full bg-[var(--bg-soft)] px-4 py-2 text-sm font-semibold" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="rounded-full bg-[var(--btn-bg,var(--brand-primary))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={!crop} onClick={save} type="button">
            Save photo
          </button>
        </div>
      </div>
    </div>
  );
}

function photoInitials(name: string): string {
  const { firstName, lastName } = splitFullName(name);
  const first = (firstName[0] || lastName[0] || "?").toUpperCase();
  const last = firstName ? (lastName[0] || "").toUpperCase() : "";
  return `${first}${last}`;
}

function isPdfFile(file: FileRecord): boolean {
  return file.mimeType === "application/pdf" || /\.pdf$/i.test(file.name);
}

async function pdfFirstPageUrl(bytes: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/goat/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    page.cleanup();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) throw new Error("Could not render that PDF.");
    return URL.createObjectURL(blob);
  } finally {
    doc.cleanup();
  }
}

function filesForCases(caseIds: string[]): FileRecord[] {
  const state = loadFileManagerState();
  const roots = state.folders.filter(
    (folder) => folder.patientId && caseIds.includes(folder.patientId) && folder.isSystemFolder && !folder.deleted,
  );
  const seen = new Set<string>();
  const out: FileRecord[] = [];
  const walk = (folderId: string) => {
    if (seen.has(folderId)) return;
    seen.add(folderId);
    for (const file of getFilesInFolder(state, folderId)) {
      if (isChoosableIdFile(file)) out.push(file);
    }
    for (const child of getFoldersInParent(state, folderId)) walk(child.id);
  };
  for (const root of roots) walk(root.id);
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
  return out;
}

/** Square patient photo. Upload Photo uses the device picker. Choose Photo uses this patient's files. */
export function PatientPhotoControl({
  name,
  photo,
  onSave,
  caseIds = [],
}: {
  name: string;
  photo?: string;
  onSave: (dataUrl: string) => void;
  caseIds?: string[];
}) {
  const [menu, setMenu] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [library, setLibrary] = useState<FileRecord[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [source, setSource] = useState<{ url: string } | null>(null);
  const [pickError, setPickError] = useState("");

  useEffect(() => {
    if (!choosing) return;
    const reload = () => setLibrary(filesForCases(caseIds));
    reload();
    return onLocalChange("casemate.files.v1", reload);
  }, [choosing, caseIds]);

  useEffect(() => {
    if (!choosing || library.length === 0) return;
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const file of library) {
        const { url, error } = await getSignedUrl(file.storagePath);
        if (cancelled || error || !url) continue;
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          if (isPdfFile(file)) {
            const pageUrl = await pdfFirstPageUrl(await response.arrayBuffer());
            created.push(pageUrl);
            next[file.id] = pageUrl;
          } else {
            next[file.id] = url;
          }
        } catch {
          /* skip a file that cannot be previewed */
        }
        if (!cancelled) setThumbs({ ...next });
      }
    })();
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [choosing, library]);

  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    event.target.value = "";
    if (!next || !next.type.startsWith("image/")) return;
    setMenu(false);
    setChoosing(false);
    setSource((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { url: URL.createObjectURL(next) };
    });
  };

  const chooseExisting = async (file: FileRecord) => {
    setPickError("");
    const { url, error } = await getSignedUrl(file.storagePath);
    if (error || !url) {
      setPickError("Could not open that file.");
      return;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        setPickError("Could not open that file.");
        return;
      }
      const imageUrl = isPdfFile(file) ? await pdfFirstPageUrl(await response.arrayBuffer()) : URL.createObjectURL(await response.blob());
      setMenu(false);
      setChoosing(false);
      setSource((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { url: imageUrl };
      });
    } catch {
      setPickError("Could not open that file.");
    }
  };

  const closeCrop = () => {
    setSource((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  return (
    <div className="relative">
      <button
        aria-label={photo ? "Change photo" : "Add photo"}
        className="block overflow-hidden rounded-xl"
        onClick={() => setMenu((open) => !open)}
        type="button"
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="h-16 w-16 object-cover" src={photo} />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center border border-dashed border-[#8fb4cc] bg-[color-mix(in_srgb,var(--brand-primary)_12%,var(--bg-panel))] text-sm font-semibold text-[var(--brand-ink)]">
            {photoInitials(name)}
          </span>
        )}
      </button>
      <p className="mt-1 text-[11px] font-semibold text-[var(--brand-ink)]">{photo ? "Change photo" : "Add photo"}</p>
      {menu && (
        <div className="absolute left-0 top-16 z-20 w-56 rounded-xl border border-[#d5e4ef] bg-white p-1 shadow-lg">
          <label className="block cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_12%,var(--bg-panel))]">
            Upload Photo
            <input accept="image/*" className="sr-only" onChange={pick} type="file" />
          </label>
          <button
            className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_12%,var(--bg-panel))]"
            onClick={() => {
              setChoosing(true);
              setLibrary(filesForCases(caseIds));
              setPickError("");
            }}
            type="button"
          >
            Choose Photo
          </button>
          {choosing && (
            <div className="max-h-48 overflow-auto border-t border-[#d5e4ef] px-1 py-1">
              {library.length === 0 ? (
                <p className="px-2 py-2 text-xs text-[#6b8496]">No ID, license, or identification files in this patient&apos;s files.</p>
              ) : (
                library.map((file) => (
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[color-mix(in_srgb,var(--brand-primary)_12%,var(--bg-panel))]"
                    key={file.id}
                    onClick={() => void chooseExisting(file)}
                    type="button"
                  >
                    {thumbs[file.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" className="h-10 w-10 shrink-0 rounded object-cover" src={thumbs[file.id]} />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[color-mix(in_srgb,var(--brand-primary)_12%,var(--bg-panel))] text-[10px] font-semibold text-[#6b8496]">
                        {isPdfFile(file) ? "PDF" : "…"}
                      </span>
                    )}
                    <span className="min-w-0 truncate">{file.name}</span>
                  </button>
                ))
              )}
              {pickError && <p className="px-2 py-1 text-xs font-semibold text-[#c9423a]">{pickError}</p>}
            </div>
          )}
        </div>
      )}
      {source && (
        <PatientPhotoCropper
          onCancel={closeCrop}
          onSave={(dataUrl) => {
            closeCrop();
            onSave(dataUrl);
          }}
          src={source.url}
        />
      )}
    </div>
  );
}
