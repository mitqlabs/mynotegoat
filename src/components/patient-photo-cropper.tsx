"use client";

import { useRef, useState } from "react";
import { splitFullName } from "@/lib/patient-folders";
import {
  cropImageToJpeg,
  initialSquareCrop,
  moveSquareCrop,
  resizeSquareCrop,
  type SquareCrop,
} from "@/lib/patient-photo";

/**
 * Square crop. Drag the box to move it. Drag the corner to resize it.
 * Pointer events cover a mouse and a finger, including an iPhone.
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
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<SquareCrop | null>(null);
  const [shownScale, setShownScale] = useState(1);
  const [error, setError] = useState("");
  const drag = useRef<{ mode: "move" | "resize"; x: number; y: number; crop: SquareCrop } | null>(null);

  const scale = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return 1;
    return img.clientWidth / img.naturalWidth;
  };

  const onLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setCrop(initialSquareCrop(img.naturalWidth, img.naturalHeight));
    setShownScale(img.clientWidth / img.naturalWidth || 1);
  };

  const onPointerDown = (event: React.PointerEvent, mode: "move" | "resize") => {
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
        ? moveSquareCrop(natural.w, natural.h, active.crop, dx, dy, scale())
        : resizeSquareCrop(natural.w, natural.h, active.crop, dx, dy, scale());
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

  const box = crop
    ? { left: crop.x * shownScale, top: crop.y * shownScale, size: crop.size * shownScale }
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0e2944]/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="patient-photo-title">
      <div className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-[#172a3a]" id="patient-photo-title">Crop a square</h3>
            <p className="text-xs text-[#6b8496]">Drag the box over the face. Drag the corner to resize. It does not have to be a perfect ID scan.</p>
          </div>
          <button className="rounded-full px-2 py-1 text-sm font-semibold text-[#6b8496]" onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#10283d] px-3 py-4">
          {src && (
            <div className="relative inline-block max-w-full touch-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Picture to crop"
                className="block max-h-[62dvh] max-w-full select-none"
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
                  style={{ left: box.left, top: box.top, width: box.size, height: box.size }}
                >
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-1/3 top-0 h-full w-px bg-white/50" />
                    <div className="absolute left-2/3 top-0 h-full w-px bg-white/50" />
                    <div className="absolute left-0 top-1/3 h-px w-full bg-white/50" />
                    <div className="absolute left-0 top-2/3 h-px w-full bg-white/50" />
                  </div>
                  <button
                    aria-label="Resize crop"
                    className="absolute -bottom-3 -right-3 h-11 w-11 cursor-nwse-resize rounded-full border-2 border-white bg-[#0d79bf]"
                    onPointerDown={(event) => onPointerDown(event, "resize")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    type="button"
                  />
                </div>
              )}
            </div>
          )}
        </div>
        {error && <p className="px-4 pt-2 text-sm font-semibold text-[#c9423a]">{error}</p>}
        <div className="flex justify-end gap-2 px-4 py-3">
          <button className="rounded-full bg-[#e4f0f7] px-4 py-2 text-sm font-semibold" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="rounded-full bg-[#0d79bf] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={!crop} onClick={save} type="button">
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

/** Square patient photo, or a placeholder, plus Upload ID / Take photo / Choose photo. */
export function PatientPhotoControl({
  name,
  photo,
  onSave,
}: {
  name: string;
  photo?: string;
  onSave: (dataUrl: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [source, setSource] = useState<{ url: string } | null>(null);

  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    event.target.value = "";
    if (!next || !next.type.startsWith("image/")) return;
    setMenu(false);
    setSource((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { url: URL.createObjectURL(next) };
    });
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
          <span className="flex h-16 w-16 items-center justify-center border border-dashed border-[#8fb4cc] bg-[#e7f2f8] text-sm font-semibold text-[#0d79bf]">
            {photoInitials(name)}
          </span>
        )}
      </button>
      <p className="mt-1 text-[11px] font-semibold text-[#0d79bf]">{photo ? "Change photo" : "Add photo"}</p>
      {menu && (
        <div className="absolute left-0 top-16 z-20 w-44 rounded-xl border border-[#d5e4ef] bg-white p-1 shadow-lg">
          <label className="block cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold hover:bg-[#e7f2f8]">
            Upload ID
            <input accept="image/*" className="sr-only" onChange={pick} type="file" />
          </label>
          <label className="block cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold hover:bg-[#e7f2f8]">
            Take photo
            <input accept="image/*" capture="environment" className="sr-only" onChange={pick} type="file" />
          </label>
          <label className="block cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold hover:bg-[#e7f2f8]">
            Choose photo
            <input accept="image/*" className="sr-only" onChange={pick} type="file" />
          </label>
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
