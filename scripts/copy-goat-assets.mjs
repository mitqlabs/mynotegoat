#!/usr/bin/env node
/**
 * Copies the file-reading engines G.O.A.T. uses into public/goat/ so the app
 * serves them itself. Nothing is loaded from a third-party CDN: patient files
 * are read in the browser with these local copies and the text never leaves
 * NoteGoat.
 *
 *   public/goat/pdf.worker.min.mjs                 pdf.js text extraction worker
 *   public/goat/tesseract/worker.min.js            tesseract.js OCR worker
 *   public/goat/tesseract/core/*-lstm.wasm.js      OCR engine (wasm, 3 CPU variants)
 *   public/goat/tesseract/lang/eng.traineddata.gz  English model (tessdata best_int)
 *
 * Runs before `npm run dev` and `npm run build`. public/goat/ is gitignored (generated).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = (...p) => join(root, "node_modules", ...p);
const out = (...p) => join(root, "public", "goat", ...p);

const copies = [
  [nm("pdfjs-dist", "build", "pdf.worker.min.mjs"), out("pdf.worker.min.mjs")],
  [nm("tesseract.js", "dist", "worker.min.js"), out("tesseract", "worker.min.js")],
  ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map(
    (f) => [nm("tesseract.js-core", f), out("tesseract", "core", f)],
  ),
  [nm("@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"), out("tesseract", "lang", "eng.traineddata.gz")],
];

let missing = 0;
for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.warn(`[goat-assets] missing ${from}`);
    missing += 1;
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
if (missing) {
  console.error(`[goat-assets] ${missing} file(s) missing — run npm install.`);
  process.exit(1);
}
console.log(`[goat-assets] copied ${copies.length} files to public/goat/`);
