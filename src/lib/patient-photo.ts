/**
 * Crop geometry for a patient photo. The math is pure so it can be tested
 * without a browser. The canvas export runs only in the cropper.
 *
 * The cropper uses a free rectangle (portrait by default). The older square
 * helpers stay so existing checks still describe that shape.
 */

export type SquareCrop = { x: number; y: number; size: number };
export type PhotoCrop = { x: number; y: number; w: number; h: number };
export type CropEdge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const MIN_CROP = 48;
const PORTRAIT_RATIO = 3 / 4;

export function clampSquareCrop(imageW: number, imageH: number, crop: SquareCrop): SquareCrop {
  const max = Math.max(1, Math.min(imageW, imageH));
  const min = Math.min(MIN_CROP, max);
  const size = Math.min(max, Math.max(min, crop.size));
  const x = Math.min(Math.max(0, crop.x), Math.max(0, imageW - size));
  const y = Math.min(Math.max(0, crop.y), Math.max(0, imageH - size));
  return { x, y, size };
}

/** A centered square, a bit smaller than the short side, so a face on an ID can be framed. */
export function initialSquareCrop(imageW: number, imageH: number): SquareCrop {
  const max = Math.max(1, Math.min(imageW, imageH));
  const size = Math.max(1, Math.round(max * 0.62));
  return clampSquareCrop(imageW, imageH, {
    x: (imageW - size) / 2,
    y: (imageH - size) / 2,
    size,
  });
}

/** Display-pixel drag converted back into source pixels. */
export function moveSquareCrop(
  imageW: number,
  imageH: number,
  start: SquareCrop,
  deltaX: number,
  deltaY: number,
  scale: number,
): SquareCrop {
  const safeScale = scale > 0 ? scale : 1;
  return clampSquareCrop(imageW, imageH, {
    x: start.x + deltaX / safeScale,
    y: start.y + deltaY / safeScale,
    size: start.size,
  });
}

export function resizeSquareCrop(
  imageW: number,
  imageH: number,
  start: SquareCrop,
  deltaX: number,
  deltaY: number,
  scale: number,
): SquareCrop {
  const safeScale = scale > 0 ? scale : 1;
  const delta = Math.max(deltaX, deltaY) / safeScale;
  return clampSquareCrop(imageW, imageH, {
    x: start.x,
    y: start.y,
    size: start.size + delta,
  });
}

function minSide(imageSide: number): number {
  return Math.min(MIN_CROP, Math.max(1, imageSide));
}

/** Keep a free rectangle inside the picture, at least MIN_CROP on each side. */
export function clampPhotoCrop(imageW: number, imageH: number, crop: PhotoCrop): PhotoCrop {
  const maxW = Math.max(1, imageW);
  const maxH = Math.max(1, imageH);
  const w = Math.min(maxW, Math.max(minSide(maxW), crop.w));
  const h = Math.min(maxH, Math.max(minSide(maxH), crop.h));
  const x = Math.min(Math.max(0, crop.x), Math.max(0, imageW - w));
  const y = Math.min(Math.max(0, crop.y), Math.max(0, imageH - h));
  return { x, y, w, h };
}

/** Centered portrait, about 3:4, sized to sit inside the picture. */
export function initialPortraitCrop(imageW: number, imageH: number): PhotoCrop {
  let h = Math.round(Math.max(1, imageH) * 0.78);
  let w = Math.round(h * PORTRAIT_RATIO);
  if (w > imageW) {
    w = Math.max(1, imageW);
    h = Math.round(w / PORTRAIT_RATIO);
  }
  if (h > imageH) {
    h = Math.max(1, imageH);
    w = Math.round(h * PORTRAIT_RATIO);
  }
  return clampPhotoCrop(imageW, imageH, {
    x: (imageW - w) / 2,
    y: (imageH - h) / 2,
    w,
    h,
  });
}

export function movePhotoCrop(
  imageW: number,
  imageH: number,
  start: PhotoCrop,
  deltaX: number,
  deltaY: number,
  scale: number,
): PhotoCrop {
  const safeScale = scale > 0 ? scale : 1;
  return clampPhotoCrop(imageW, imageH, {
    x: start.x + deltaX / safeScale,
    y: start.y + deltaY / safeScale,
    w: start.w,
    h: start.h,
  });
}

/** Resize from one edge or corner. The opposite edge stays put. */
export function resizePhotoCrop(
  imageW: number,
  imageH: number,
  start: PhotoCrop,
  edge: CropEdge,
  deltaX: number,
  deltaY: number,
  scale: number,
): PhotoCrop {
  const safeScale = scale > 0 ? scale : 1;
  const dx = deltaX / safeScale;
  const dy = deltaY / safeScale;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const minW = minSide(imageW);
  const minH = minSide(imageH);
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;
  const west = edge === "w" || edge === "nw" || edge === "sw";
  const east = edge === "e" || edge === "ne" || edge === "se";
  const north = edge === "n" || edge === "nw" || edge === "ne";
  const south = edge === "s" || edge === "sw" || edge === "se";
  if (west) {
    x = Math.min(right - minW, Math.max(0, start.x + dx));
    w = right - x;
  } else if (east) {
    const nextRight = Math.max(start.x + minW, Math.min(imageW, right + dx));
    w = nextRight - start.x;
  }
  if (north) {
    y = Math.min(bottom - minH, Math.max(0, start.y + dy));
    h = bottom - y;
  } else if (south) {
    const nextBottom = Math.max(start.y + minH, Math.min(imageH, bottom + dy));
    h = nextBottom - start.y;
  }
  return { x, y, w, h };
}

const PHOTO_DATA_URL = /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i;
const PHOTO_PATH = /^[A-Za-z0-9_./-]{1,240}$/;

/** A cropped photo small enough to keep on the person record. */
export function isPatientPhotoDataUrl(value: string): boolean {
  return value.length > 32 && value.length <= 600_000 && PHOTO_DATA_URL.test(value);
}

export function isPatientPhotoPath(value: string): boolean {
  return PHOTO_PATH.test(value) && !value.includes("..");
}

/** Draw the crop onto a JPEG data URL at the crop's own shape. Browser only. */
export function cropImageToJpeg(image: CanvasImageSource, crop: PhotoCrop, maxEdge = 480): string {
  const width = Math.max(1, crop.w);
  const height = Math.max(1, crop.h);
  const longEdge = Math.max(width, height);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(image, crop.x, crop.y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}
