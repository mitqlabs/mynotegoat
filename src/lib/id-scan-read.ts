"use client";

/**
 * Read a license photo in this browser.
 * PDF417 barcode first (zxing-wasm, served from /goat/zxing/), then front OCR
 * (tesseract.js, served from /goat/tesseract/). No AI API and no CDN.
 */
import { parseAamva, parseIdFront, type IdRead } from "@/lib/id-scan";

type ZxingReader = typeof import("zxing-wasm/reader");
let zxing: Promise<ZxingReader> | null = null;

function reader(): Promise<ZxingReader> {
  if (!zxing) {
    zxing = import("zxing-wasm/reader").then((m) => {
      m.prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/goat/zxing/${path}` : prefix + path),
        },
        fireImmediately: false,
      });
      return m;
    });
  }
  return zxing;
}

function scaledCanvas(src: HTMLCanvasElement, maxEdge = 1800): HTMLCanvasElement {
  const edge = Math.max(src.width, src.height);
  if (edge <= maxEdge || edge === 0) return src;
  const s = maxEdge / edge;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** AAMVA text from a PDF417 barcode, or null. */
export async function decodeIdBarcode(src: HTMLCanvasElement): Promise<string | null> {
  try {
    const m = await reader();
    const shot = scaledCanvas(src);
    const image = shot.getContext("2d")!.getImageData(0, 0, shot.width, shot.height);
    const results = await m.readBarcodes(image, {
      formats: ["PDF417"],
      textMode: "Plain",
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      maxNumberOfSymbols: 1,
    });
    const hit = results.find((r) => r.isValid && r.text);
    return hit ? hit.text : null;
  } catch (e) {
    console.warn("[id-scan] barcode reader:", e);
    return null;
  }
}

export interface IdPhotoRead {
  read: IdRead;
  side: "front" | "back";
}

/** Barcode first. If that misses, OCR the front. */
export async function readIdPhoto(src: HTMLCanvasElement, onStep: (step: string) => void = () => {}): Promise<IdPhotoRead> {
  onStep("Looking for the barcode…");
  const raw = await decodeIdBarcode(src);
  const aamva = raw ? parseAamva(raw) : null;
  if (aamva && (aamva.fields.lastName || aamva.fields.firstName || aamva.fields.dob)) {
    return { read: aamva, side: "back" };
  }
  onStep("Reading the front…");
  const { ocrImage } = await import("@/lib/goat-files");
  const shot = scaledCanvas(src);
  const text = await ocrImage(shot, (p) => onStep(`Reading the front… ${Math.round(p * 100)}%`));
  return { read: parseIdFront(text), side: "front" };
}
