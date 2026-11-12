/**
 * Square crop for a patient photo. The geometry is pure so it can be tested
 * without a browser. The canvas export runs only in the cropper.
 */

export type SquareCrop = { x: number; y: number; size: number };

const MIN_CROP = 48;

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

const PHOTO_DATA_URL = /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i;
const PHOTO_PATH = /^[A-Za-z0-9_./-]{1,240}$/;

/** A cropped photo small enough to keep on the person record. */
export function isPatientPhotoDataUrl(value: string): boolean {
  return value.length > 32 && value.length <= 600_000 && PHOTO_DATA_URL.test(value);
}

export function isPatientPhotoPath(value: string): boolean {
  return PHOTO_PATH.test(value) && !value.includes("..");
}

/** Draw the square onto a JPEG data URL. Browser only. */
export function cropImageToJpeg(image: CanvasImageSource, crop: SquareCrop, outputSize = 360): string {
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, outputSize, outputSize);
  return canvas.toDataURL("image/jpeg", 0.82);
}
