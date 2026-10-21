/**
 * Pure helpers for the camera scanner (Patient Files → Scan).
 * No DOM here, so they're unit-tested in scripts/tests/scan-pdf.test.ts.
 */

export interface ScanPage {
  /** JPEG bytes of the page. */
  jpeg: Uint8Array;
  width: number;
  height: number;
}

export interface CameraOption {
  deviceId: string;
  label: string;
}

/** "Scan 10-20-2026" */
export function defaultScanName(date: Date = new Date()): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `Scan ${mm}-${dd}-${date.getFullYear()}`;
}

/** What the user typed (or the default), cleaned up, ending in .pdf. */
export function scanFileName(typed: string, date: Date = new Date()): string {
  const base = typed
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "")
    .trim();
  return `${base || defaultScanName(date)}.pdf`;
}

export function isIphoneCamera(label: string): boolean {
  return /iphone|continuity/i.test(label);
}

/** Last chosen camera if still plugged in, else an iPhone, else the first. */
export function pickCamera(cameras: CameraOption[], lastId?: string | null): string | null {
  if (cameras.length === 0) return null;
  if (lastId && cameras.some((c) => c.deviceId === lastId)) return lastId;
  const phone = cameras.find((c) => isIphoneCamera(c.label));
  return (phone ?? cameras[0]).deviceId;
}

/**
 * Camera list changed (plugged in, iPhone woke up, Refresh). Keep the current
 * camera if it's still there; switch to a newly appeared iPhone unless the
 * user picked a camera by hand this session; otherwise fall back to pickCamera.
 */
export function reconcileCamera(
  prev: CameraOption[],
  next: CameraOption[],
  currentId: string | null,
  userPicked: boolean,
  lastId?: string | null,
): string | null {
  if (next.length === 0) return null;
  const stillThere = !!currentId && next.some((c) => c.deviceId === currentId);
  if (!userPicked) {
    const newPhone = next.find((c) => isIphoneCamera(c.label) && !prev.some((p) => p.deviceId === c.deviceId));
    if (newPhone && newPhone.deviceId !== currentId) return newPhone.deviceId;
  }
  if (stillThere) return currentId;
  return pickCamera(next, lastId);
}

/** Same cameras in the same order (avoids needless re-renders). */
export function sameCameras(a: CameraOption[], b: CameraOption[]): boolean {
  return a.length === b.length && a.every((c, i) => c.deviceId === b[i].deviceId && c.label === b[i].label);
}

/** Copy of list with item `from` moved to `to`. Out-of-range moves are no-ops. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list.slice();
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Document look: grayscale, then stretch levels so paper goes white and
 * ink goes dark (ignores the darkest/brightest 1% so a shadow or glare
 * spot doesn't spoil it). Works in place on RGBA pixels.
 */
export function enhanceDocument(px: Uint8ClampedArray): void {
  const n = px.length / 4;
  if (n === 0) return;
  const hist = new Uint32Array(256);
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const g = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
    gray[i] = g;
    hist[g]++;
  }
  const cut = Math.floor(n * 0.01);
  let lo = 0;
  let acc = 0;
  while (lo < 255 && acc + hist[lo] <= cut) acc += hist[lo++];
  let hi = 255;
  acc = 0;
  while (hi > 0 && acc + hist[hi] <= cut) acc += hist[hi--];
  // Push paper a little past white so it reads clean.
  hi = Math.max(lo + 1, Math.round(hi - (hi - lo) * 0.08));
  const span = hi - lo;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((gray[i] - lo) * 255) / span)));
    px[i * 4] = v;
    px[i * 4 + 1] = v;
    px[i * 4 + 2] = v;
  }
}

/**
 * One PDF, one JPEG per page, each page sized to fit US Letter
 * (portrait or landscape to match the photo). JPEGs are embedded as-is
 * (DCTDecode), so there is no quality loss.
 */
export function buildScanPdf(pages: ScanPage[]): Uint8Array {
  if (pages.length === 0) throw new Error("No pages to save");
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (c: Uint8Array | string) => {
    const b = typeof c === "string" ? enc.encode(c) : c;
    chunks.push(b);
    size += b.length;
  };
  const obj = (id: number, body: (Uint8Array | string)[]) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    body.forEach(push);
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const count = pages.length;
  // ids: 1 catalog, 2 pages, then per page: page, image, content
  const pageId = (i: number) => 3 + i * 3;
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Count ${count} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] >>`]);
  pages.forEach((p, i) => {
    const landscape = p.width > p.height;
    const pw = landscape ? 792 : 612;
    const ph = landscape ? 612 : 792;
    const scale = Math.min(pw / p.width, ph / p.height);
    const w = +(p.width * scale).toFixed(2);
    const h = +(p.height * scale).toFixed(2);
    const x = +((pw - w) / 2).toFixed(2);
    const y = +((ph - h) / 2).toFixed(2);
    const id = pageId(i);
    obj(id, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im${i} ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
    ]);
    obj(id + 1, [
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      "\nendstream",
    ]);
    const content = `q ${w} 0 0 ${h} ${x} ${y} cm /Im${i} Do Q`;
    obj(id + 2, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  });
  const total = 3 + count * 3;
  const xref = size;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
