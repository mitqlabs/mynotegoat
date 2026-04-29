/**
 * Post-processing helpers for document-template HTML. Shared between
 * the generated PDF (patient-case-file `buildPrintableDocumentHtml`)
 * and the live settings preview (document-template-settings-panel) so
 * both see the exact same label/value layout.
 *
 * The markup produced here pairs with the `.kv` / `.kv-cont` / `.kv-label`
 * / `.kv-value` CSS defined in both places. See globals.css for the
 * preview rules and patient-case-file's inline style block for the PDF.
 */

/** Strip leading whitespace from each line if the content contains HTML
 *  tags. Prevents pre-wrap from indenting AI-generated narrative HTML
 *  while leaving plain-text templates with tabs intact. */
export function stripHtmlIndentation(html: string): string {
  if (!/<[a-z][\s\S]*>/i.test(html)) return html; // plain text — keep tabs
  return html.replace(/^[ \t]+/gm, "");
}

/**
 * Rewrite `<p>Label:  value</p>` (or `<div>...</div>`) paragraphs as
 * `<div class="kv">` rows with a fixed-width label column, then re-tag
 * subsequent orphan paragraphs as `<div class="kv-cont">` continuation
 * rows so multi-line values (Imaging Center → phone → address) all sit
 * in the value column instead of wrapping back to the left margin.
 *
 * Handles BOTH `<p>` and `<div>` blocks because contenteditable rich-text
 * editors emit either depending on the browser, and merges any existing
 * `class="..."` attribute on the original block so we don't end up with
 * duplicate `class` attributes that some browsers resolve by dropping
 * our `kv-cont` and breaking the continuation indent silently.
 */
export function applyLabelValueHangingIndent(html: string): string {
  const labelPatternSource = "[A-Z][A-Za-z0-9 ()&/\\-]*?:";
  // Match either <p ...> ... </p> or <div ...> ... </div> as a "block".
  // Case-insensitive so contenteditable's mix of <P> / <DIV> works too.
  const blockOpen = "<(?:p|div)";
  const blockClose = "<\\/(?:p|div)>";

  // Defensive cleanup: strip soft-hyphens and zero-width spaces that
  // sometimes survive copy/paste from PDFs. These characters allow
  // mid-word line breaks (e.g. "s&shy;econdary" -> "s | econdary")
  // -- the "derangements econdary" artifact we kept seeing.
  let next = html.replace(/[­​‌‍﻿]/g, "");

  // Helper: take an attrs string from the original block and merge our
  // own class into any existing class="..." so we don't emit duplicate
  // class attributes (which browsers may resolve by keeping the LATER
  // class and dropping ours, breaking the kv-cont layout silently).
  const mergeClassAttr = (attrs: string, ourClass: string): string => {
    const trimmed = attrs.trim();
    if (!trimmed) return ` class="${ourClass}"`;
    const classRe = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i;
    const m = trimmed.match(classRe);
    if (!m) return ` class="${ourClass}" ${trimmed}`;
    const existing = (m[2] ?? m[3] ?? "").trim();
    const merged = existing ? `${ourClass} ${existing}` : ourClass;
    const replaced = trimmed.replace(classRe, `class="${merged}"`);
    return ` ${replaced}`;
  };

  // Phase 1: turn "Label:  value" rows into .kv rows. Handles both
  // <p> and <div> as the wrapping block.
  next = next.replace(
    new RegExp(
      `${blockOpen}([^>]*)>\\s*(${labelPatternSource})(?:&nbsp;|\\s)+([\\s\\S]*?)${blockClose}`,
      "gi",
    ),
    (_match, attrs: string, label: string, rest: string) => {
      const mergedAttrs = mergeClassAttr(attrs, "kv");
      return `<div${mergedAttrs}><span class="kv-label">${label}</span><span class="kv-value">${rest.trim()}</span></div>`;
    },
  );

  // Phase 2: tag every block that immediately follows a .kv row or a
  // previous .kv-cont AND doesn't start with a new label as a
  // continuation. Emits <div class="kv-cont"> so the universal
  // paragraph rules don't interfere. Iterates so chains of 3+
  // continuation lines (Imaging Center -> phone -> address) all flip.
  //
  // The negative lookahead at the start of the right-side attrs
  // excludes blocks that ALREADY have a kv / kv-cont class — without
  // it, each iteration re-matches the just-converted kv-cont div as a
  // fresh `<div>` to "continue" and stamps the class on itself again
  // (we'd loop forever stacking duplicate classes and never advance to
  // the actual orphan block).
  const continuationRe = new RegExp(
    `(<div\\s[^>]*class="(?:[^"]*\\s)?kv(?:-cont)?(?:\\s[^"]*)?"[^>]*>[\\s\\S]*?<\\/div>)` +
      `\\s*` +
      `${blockOpen}` +
      `(?![^>]*\\bclass\\s*=\\s*["'][^"']*\\bkv(?:-cont)?\\b)` +
      `([^>]*)>` +
      `(?!\\s*${labelPatternSource}(?:&nbsp;|\\s))` +
      `([\\s\\S]*?)` +
      `${blockClose}`,
    "gi",
  );
  for (let i = 0; i < 20; i++) {
    const before = next;
    next = next.replace(continuationRe, (_match, prev: string, attrs: string, cont: string) => {
      const mergedAttrs = mergeClassAttr(attrs, "kv-cont");
      return `${prev}<div${mergedAttrs}>${cont.trim()}</div>`;
    });
    if (before === next) break;
  }
  return next;
}
