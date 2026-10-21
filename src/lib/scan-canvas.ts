"use client";

/** Canvas helpers for scanning (desktop Scan window and the phone page). */
import { enhanceDocument } from "@/lib/scan-pdf";

export function loadImage(blob: Blob): Promise<HTMLCanvasElement> {
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

export function makeEnhanced(src: HTMLCanvasElement): HTMLCanvasElement {
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

export function makeThumb(src: HTMLCanvasElement): string {
  const c = document.createElement("canvas");
  const s = 160 / Math.max(src.width, src.height);
  c.width = Math.round(src.width * s);
  c.height = Math.round(src.height * s);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

export function toJpeg(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error("Couldn't save page"))),
      "image/jpeg",
      0.9,
    ),
  );
}


/** Shrink a photo so its long side is at most `max` px (phone photos are huge). */
export function scaleDown(src: HTMLCanvasElement, max = 2400): HTMLCanvasElement {
  const s = max / Math.max(src.width, src.height);
  if (s >= 1) return src;
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * s);
  c.height = Math.round(src.height * s);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
