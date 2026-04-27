"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollLock } from "@/components/scroll-lock";

export interface DocumentScannerModalProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const HANDLE_SIZE = 24;
const MIN_CROP_PX = 40;

export function DocumentScannerModal({
  open,
  onClose,
  onCapture,
}: DocumentScannerModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const cropRef = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const dragRef = useRef<{
    mode: "move" | "nw" | "ne" | "sw" | "se" | null;
    startX: number;
    startY: number;
    startRect: Rect;
  }>({ mode: null, startX: 0, startY: 0, startRect: { x: 0, y: 0, w: 0, h: 0 } });

  const [imageLoaded, setImageLoaded] = useState(false);
  const [originalFileName, setOriginalFileName] = useState("scan.jpg");
  const [busy, setBusy] = useState(false);

  // Reset whenever the modal opens.
  useEffect(() => {
    if (!open) {
      setImageLoaded(false);
      imageRef.current = null;
      cropRef.current = { x: 0, y: 0, w: 0, h: 0 };
      return;
    }
    // Auto-launch the file/camera picker as soon as we mount.
    const t = setTimeout(() => fileInputRef.current?.click(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Draw the current image and crop overlay.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const c = cropRef.current;

    // Dim outside the crop area.
    ctx.fillStyle = "rgba(15, 46, 70, 0.55)";
    ctx.fillRect(0, 0, canvas.width, c.y);
    ctx.fillRect(0, c.y + c.h, canvas.width, canvas.height - (c.y + c.h));
    ctx.fillRect(0, c.y, c.x, c.h);
    ctx.fillRect(c.x + c.w, c.y, canvas.width - (c.x + c.w), c.h);

    // Crop border.
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x, c.y, c.w, c.h);

    // Corner handles.
    ctx.fillStyle = "#ffffff";
    const half = HANDLE_SIZE / 2;
    const corners: Point[] = [
      { x: c.x, y: c.y },
      { x: c.x + c.w, y: c.y },
      { x: c.x, y: c.y + c.h },
      { x: c.x + c.w, y: c.y + c.h },
    ];
    corners.forEach((corner) => {
      ctx.fillRect(corner.x - half, corner.y - half, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeStyle = "#0e293e";
      ctx.lineWidth = 2;
      ctx.strokeRect(corner.x - half, corner.y - half, HANDLE_SIZE, HANDLE_SIZE);
    });
  }, []);

  // Re-draw whenever imageLoaded flips to true (canvas now in DOM).
  useEffect(() => {
    if (imageLoaded) {
      const img = imageRef.current;
      const canvas = canvasRef.current;
      if (!img || !canvas) return;

      const container = canvas.parentElement;
      if (!container) return;

      const maxW = Math.min(container.clientWidth, 900);
      const maxH = Math.min(window.innerHeight - 240, 900);
      const ratio = img.naturalWidth / img.naturalHeight;

      let w = maxW;
      let h = w / ratio;
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }

      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      // Initial crop: full image inset by ~5%.
      const inset = 0.05;
      cropRef.current = {
        x: w * inset,
        y: h * inset,
        w: w * (1 - inset * 2),
        h: h * (1 - inset * 2),
      };
      draw();
    }
  }, [imageLoaded, draw]);

  const handleFileChosen = useCallback(
    (file: File | null) => {
      if (!file) return;
      setOriginalFileName(file.name || "scan.jpg");
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        imageRef.current = img;
        setImageLoaded(true);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [],
  );

  // Pointer hit-testing.
  const hitTest = (px: number, py: number): typeof dragRef.current.mode => {
    const c = cropRef.current;
    const half = HANDLE_SIZE;
    const near = (cx: number, cy: number) =>
      Math.abs(px - cx) <= half && Math.abs(py - cy) <= half;
    if (near(c.x, c.y)) return "nw";
    if (near(c.x + c.w, c.y)) return "ne";
    if (near(c.x, c.y + c.h)) return "sw";
    if (near(c.x + c.w, c.y + c.h)) return "se";
    if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) return "move";
    return null;
  };

  const getPointer = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = getPointer(e);
    const mode = hitTest(p.x, p.y);
    if (!mode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: p.x,
      startY: p.y,
      startRect: { ...cropRef.current },
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag.mode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = getPointer(e);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    const start = drag.startRect;
    const cw = canvas.width;
    const ch = canvas.height;

    let next: Rect = { ...start };
    if (drag.mode === "move") {
      next.x = Math.min(Math.max(0, start.x + dx), cw - start.w);
      next.y = Math.min(Math.max(0, start.y + dy), ch - start.h);
    } else {
      let x1 = start.x;
      let y1 = start.y;
      let x2 = start.x + start.w;
      let y2 = start.y + start.h;
      if (drag.mode === "nw") {
        x1 = Math.min(Math.max(0, start.x + dx), x2 - MIN_CROP_PX);
        y1 = Math.min(Math.max(0, start.y + dy), y2 - MIN_CROP_PX);
      } else if (drag.mode === "ne") {
        x2 = Math.max(Math.min(cw, x2 + dx), x1 + MIN_CROP_PX);
        y1 = Math.min(Math.max(0, start.y + dy), y2 - MIN_CROP_PX);
      } else if (drag.mode === "sw") {
        x1 = Math.min(Math.max(0, start.x + dx), x2 - MIN_CROP_PX);
        y2 = Math.max(Math.min(ch, y2 + dy), y1 + MIN_CROP_PX);
      } else if (drag.mode === "se") {
        x2 = Math.max(Math.min(cw, x2 + dx), x1 + MIN_CROP_PX);
        y2 = Math.max(Math.min(ch, y2 + dy), y1 + MIN_CROP_PX);
      }
      next = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    cropRef.current = next;
    draw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current.mode) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current.mode = null;
  };

  const handleRetake = () => {
    setImageLoaded(false);
    imageRef.current = null;
    setTimeout(() => fileInputRef.current?.click(), 50);
  };

  const handleUseScan = async () => {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    setBusy(true);

    // Map crop from canvas-space back to source-image-space.
    const scaleX = img.naturalWidth / canvas.width;
    const scaleY = img.naturalHeight / canvas.height;
    const c = cropRef.current;
    const sx = Math.round(c.x * scaleX);
    const sy = Math.round(c.y * scaleY);
    const sw = Math.round(c.w * scaleX);
    const sh = Math.round(c.h * scaleY);

    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const ctx = out.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    out.toBlob(
      (blob) => {
        setBusy(false);
        if (!blob) return;
        const baseName = originalFileName.replace(/\.[^.]+$/, "") || "scan";
        const stamped = `${baseName}-${Date.now()}.jpg`;
        const file = new File([blob], stamped, { type: "image/jpeg" });
        onCapture(file);
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.65)] px-4 py-6">
      <ScrollLock />
      <section className="w-full max-w-3xl rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xl font-semibold">Scan Document</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {imageLoaded
                ? "Drag the corners or middle to crop, then tap Use Scan."
                : "Take a photo or choose a file."}
            </p>
          </div>
          <button
            className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <input
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            handleFileChosen(event.target.files?.[0] ?? null);
            // Reset so the same file can be re-selected.
            event.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />

        <div className="mt-4 flex min-h-[200px] items-center justify-center rounded-xl bg-[#0e293e]">
          {/* Canvas is always in the DOM so the ref is available when the image loads. */}
          <canvas
            className="touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            ref={canvasRef}
            style={{ display: imageLoaded ? "block" : "none" }}
          />
          {!imageLoaded && (
            <p className="px-6 py-12 text-sm font-semibold text-white">
              Waiting for image...
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
            onClick={handleRetake}
            type="button"
          >
            Retake
          </button>
          <button
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90 disabled:opacity-60"
            disabled={!imageLoaded || busy}
            onClick={handleUseScan}
            type="button"
          >
            {busy ? "Saving..." : "Use Scan"}
          </button>
        </div>
      </section>
    </div>
  );
}
