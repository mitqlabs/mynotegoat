/**
 * Clean printable table for list views ("print what I'm looking at").
 *
 * `buildPrintTableHtml` is pure: give it the rows already filtered and
 * sorted exactly as on screen, the visible columns in screen order, and a
 * one-line description of the filters; it returns a standalone HTML
 * document. `printHtmlDocument` prints that document from a hidden iframe
 * (no popup, no external service).
 */

export interface PrintCell {
  text: string;
  /** Smaller grey second line (phone, note …). */
  sub?: string;
}

export interface PrintTableInput {
  officeName?: string;
  /** "Patients", "Patients — Case Flow". */
  title: string;
  /** Active filters / sort in plain words. */
  description?: string;
  columns: string[];
  rows: Array<Array<string | PrintCell>>;
  /** Already-formatted print time ("10/10/2026 11:52 AM"). */
  printedAt: string;
  /** Singular noun for the count line ("patient", "item"). */
  rowNoun?: string;
  emptyText?: string;
  /** Force orientation; default: landscape from 7 columns up. */
  orientation?: "portrait" | "landscape";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cellHtml(cell: string | PrintCell): string {
  const c = typeof cell === "string" ? { text: cell } : cell;
  const main = escapeHtml(c.text || "");
  return c.sub ? `${main}<div class="sub">${escapeHtml(c.sub)}</div>` : main;
}

export function buildPrintTableHtml(input: PrintTableInput): string {
  const orientation = input.orientation ?? (input.columns.length >= 7 ? "landscape" : "portrait");
  const noun = input.rowNoun ?? "row";
  const count = `${input.rows.length} ${noun}${input.rows.length === 1 ? "" : "s"}`;
  const head = input.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = input.rows.length
    ? input.rows.map((r) => `<tr>${r.map((c) => `<td>${cellHtml(c)}</td>`).join("")}</tr>`).join("\n")
    : `<tr><td class="empty" colspan="${Math.max(1, input.columns.length)}">${escapeHtml(input.emptyText ?? "Nothing to show.")}</td></tr>`;
  const office = input.officeName?.trim();
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml([office, input.title].filter(Boolean).join(" — "))}</title>
<style>
  @page { size: letter ${orientation}; margin: 0.5in 0.45in 0.55in;
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8.5pt Arial, Helvetica, sans-serif; color: #555; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font: 10pt/1.3 Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  header { margin-bottom: 10pt; border-bottom: 1.5pt solid #222; padding-bottom: 6pt; }
  .office { font-size: 9.5pt; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: #333; }
  h1 { margin: 2pt 0 2pt; font-size: 15pt; }
  .desc { font-size: 9.5pt; color: #333; }
  .meta { margin-top: 2pt; font-size: 9pt; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th { text-align: left; font-size: 9.5pt; font-weight: 700; background: #eef1f4; border-bottom: 1pt solid #888; border-top: 1pt solid #888; padding: 4pt 6pt; }
  td { font-size: 10pt; vertical-align: top; padding: 3.5pt 6pt; border-bottom: 0.5pt solid #d4d8dd; }
  tbody tr:nth-child(even) td { background: #f7f8fa; }
  .sub { font-size: 8.5pt; color: #555; margin-top: 1pt; }
  .empty { color: #555; font-style: italic; padding: 10pt 6pt; }
</style></head>
<body>
<header>
  ${office ? `<div class="office">${escapeHtml(office)}</div>` : ""}
  <h1>${escapeHtml(input.title)}</h1>
  ${input.description ? `<div class="desc">${escapeHtml(input.description)}</div>` : ""}
  <div class="meta">Printed ${escapeHtml(input.printedAt)} · ${escapeHtml(count)}</div>
</header>
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>
</body></html>`;
}

/** "10/10/2026 11:52 AM" in the browser's local time. */
export function formatPrintedAt(date = new Date()): string {
  const d = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
  const t = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${d} ${t}`;
}

/** Print a standalone HTML document from a hidden iframe. */
export function printHtmlDocument(html: string): boolean {
  if (typeof document === "undefined") return false;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(iframe);
  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument ?? frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    return false;
  }
  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    iframe.remove();
  };
  frameWindow.onafterprint = () => setTimeout(cleanup, 0);
  setTimeout(() => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      cleanup();
      return;
    }
    // Some browsers return from print() immediately; keep the frame long
    // enough for the dialog to read it.
    setTimeout(cleanup, 60_000);
  }, 120);
  return true;
}
