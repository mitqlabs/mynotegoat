"use client";
/**
 * G.O.A.T. reads a picture or PDF the user attached — all in this browser.
 * The barcode reader (zxing-wasm, PDF417) and OCR (tesseract.js) are loaded
 * only when a picture is attached, from NoteGoat's own copies in /goat/.
 * Nothing is sent to any server or AI service.
 */
import { looksLikeIdFront, parseAamva, parseIdFront, type IdRead } from "@/lib/goat-id";

export interface AttachmentRead {
  kind: "id" | "screenshot";
  id?: IdRead;
  /** OCR text (screenshots, or the front of an ID). */
  text: string;
  /** Which side of the ID this was (barcode = back). */
  side?: "front" | "back";
}

type ZxingReader = typeof import("zxing-wasm/reader");
let zxing: Promise<ZxingReader> | null = null;
function reader(): Promise<ZxingReader> {
  if (!zxing) {
    zxing = import("zxing-wasm/reader").then((m) => {
      m.prepareZXingModule({
        overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/goat/zxing/${path}` : prefix + path) },
        fireImmediately: false,
      });
      return m;
    });
  }
  return zxing;
}

async function toImageData(src: Blob | HTMLCanvasElement): Promise<ImageData | Blob> {
  if (src instanceof Blob) return src;
  return src.getContext("2d")!.getImageData(0, 0, src.width, src.height);
}

/** The AAMVA text from a PDF417 barcode in the picture, or null. */
export async function decodeIdBarcode(src: Blob | HTMLCanvasElement): Promise<string | null> {
  try {
    const m = await reader();
    const results = await m.readBarcodes(await toImageData(src), { formats: ["PDF417"], textMode: "Plain", tryHarder: true, tryRotate: true, tryInvert: false, maxNumberOfSymbols: 1 });
    const hit = results.find((r) => r.isValid && r.text);
    return hit ? hit.text : null;
  } catch (e) {
    console.warn("[goat-id] barcode reader:", e);
    return null;
  }
}

/** Read an attached image / PDF: barcode first (exact), else OCR (front of ID or any screenshot). */
export async function readAttachment(file: File, onStep: (step: string) => void = () => {}): Promise<AttachmentRead> {
  let src: Blob | HTMLCanvasElement = file;
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    onStep("Opening the PDF…");
    const { renderPdfFirstPage } = await import("@/lib/goat-files");
    src = await renderPdfFirstPage(await file.arrayBuffer());
  }
  onStep("Looking for an ID barcode…");
  const raw = await decodeIdBarcode(src);
  const aamva = raw ? parseAamva(raw) : null;
  if (aamva) return { kind: "id", id: aamva, text: "", side: "back" };
  onStep("Reading the text…");
  const { ocrImage } = await import("@/lib/goat-files");
  const text = await ocrImage(src, (p) => onStep(`Reading the text… ${Math.round(p * 100)}%`));
  if (looksLikeIdFront(text)) return { kind: "id", id: parseIdFront(text), text, side: "front" };
  return { kind: "screenshot", text };
}
