/**
 * Shared HTML normalizer for SOAP / encounter rich-text content.
 *
 * Originally lived inside `use-encounter-notes.ts` as a private helper
 * for `appendSoapSection`. Moved out here so every place that renders
 * stored SOAP HTML — Previous Subjective preview, SOAP print export,
 * narrative report generator — can run incoming HTML through the same
 * normalizer.
 *
 * Why render-time normalization matters: encounters saved before the
 * "wrap top-level inline content in <p>" fix landed have stored HTML
 * like `<p>Lumbar...</p><strong>Shoulder: Left</strong><span>...`.
 * The browser's contentEditable used to silently merge that trailing
 * inline run into the previous <p>, so when the saved HTML is rendered
 * back into a non-contentEditable preview/print, the same merge
 * happens visually — "Shoulder: Left" appears glued onto the end of
 * the Lumbar palliative line. Running the saved HTML through this
 * normalizer at READ time fixes the display without touching storage.
 */

const emptyInlineFiller =
  "(?:&nbsp;|<br\\s*\\/?\\s*>|<(?:span|font|strong|em|u|b|i)(?:\\s[^>]*)?>\\s*(?:&nbsp;)?\\s*<\\/(?:span|font|strong|em|u|b|i)>)\\s*";
const emptyBlockPatternSource =
  `(?:<(?:p|div|h[1-6])(?:\\s[^>]*)?>\\s*(?:${emptyInlineFiller})*<\\/(?:p|div|h[1-6])>\\s*|<br\\s*\\/?\\s*>\\s*)`;

export function stripEdgeEmptyBlocks(html: string): string {
  const leading = new RegExp(`^(?:${emptyBlockPatternSource})+`, "gi");
  const trailing = new RegExp(`(?:${emptyBlockPatternSource})+$`, "gi");
  let next = html;
  for (let i = 0; i < 4; i++) {
    const before = next;
    next = next.replace(leading, "").replace(trailing, "");
    if (before === next) break;
  }
  return next;
}

function collapseConsecutiveEmptyBlocksRegex(html: string): string {
  const run = new RegExp(`(?:${emptyBlockPatternSource}){2,}`, "gi");
  return html.replace(run, "<p><br></p>");
}

/**
 * DOM-based HTML normalizer for SOAP section content. See file-level
 * docstring for the full rationale.
 *
 * Behavior:
 *   - Strips any leading/trailing "visually empty" blocks.
 *   - Reduces runs of 2+ consecutive empty blocks to a single
 *     canonical <p><br></p> separator.
 *   - Wraps any stray top-level inline content (text node, <strong>,
 *     <span>, <em>, plain pills) in its own <p> so the browser can't
 *     reabsorb it into a neighbouring paragraph on render.
 *
 * SSR-safe: falls back to the regex strippers when DOMParser isn't
 * available. The DOM path is used in every browser flow.
 */
export function normalizeEditorBlocks(html: string): string {
  const source = html.trim();
  if (!source) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return collapseConsecutiveEmptyBlocksRegex(stripEdgeEmptyBlocks(source));
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<!doctype html><body>${source}</body>`, "text/html");
  const body = doc.body;

  const isVisuallyEmpty = (el: Element): boolean => {
    const text = (el.textContent ?? "").replace(/[\s ]/g, "");
    if (text) return false;
    if (
      el.querySelector(
        "img, video, iframe, input, canvas, [data-macro-run-id], [data-prompt-id]",
      )
    ) {
      return false;
    }
    return true;
  };

  const isBlockTag = (tag: string) =>
    /^(P|DIV|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE)$/i.test(tag);

  const nodes = Array.from(body.childNodes);
  const cleaned: Node[] = [];
  let lastWasEmpty = false;
  let inlineBuffer: Node[] = [];

  const flushInlineBuffer = () => {
    if (inlineBuffer.length === 0) return;
    const hasContent = inlineBuffer.some((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        return ((n.textContent ?? "").replace(/[\s ]/g, "")).length > 0;
      }
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element;
        if ((el.textContent ?? "").replace(/[\s ]/g, "")) return true;
        if (
          el.querySelector(
            "img, video, iframe, input, canvas, [data-macro-run-id], [data-prompt-id]",
          )
        ) {
          return true;
        }
      }
      return false;
    });
    if (!hasContent) {
      inlineBuffer = [];
      return;
    }
    const p = doc.createElement("p");
    inlineBuffer.forEach((n) => p.appendChild(n));
    cleaned.push(p);
    lastWasEmpty = false;
    inlineBuffer = [];
  };

  const pushCanonicalEmpty = () => {
    flushInlineBuffer();
    if (lastWasEmpty || cleaned.length === 0) return;
    const p = doc.createElement("p");
    p.appendChild(doc.createElement("br"));
    cleaned.push(p);
    lastWasEmpty = true;
  };

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text.trim() && inlineBuffer.length === 0) continue;
      inlineBuffer.push(node);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as Element;
    const tag = el.tagName;

    if (tag === "BR") {
      pushCanonicalEmpty();
      continue;
    }

    if (isBlockTag(tag)) {
      flushInlineBuffer();
      if (isVisuallyEmpty(el)) {
        pushCanonicalEmpty();
      } else {
        cleaned.push(node);
        lastWasEmpty = false;
      }
      continue;
    }

    inlineBuffer.push(node);
  }
  flushInlineBuffer();

  while (cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1];
    if (last.nodeType === Node.ELEMENT_NODE) {
      const el = last as Element;
      if (isBlockTag(el.tagName) && isVisuallyEmpty(el)) {
        cleaned.pop();
        continue;
      }
    }
    break;
  }

  const wrapper = doc.createElement("div");
  cleaned.forEach((n) => wrapper.appendChild(n));
  return wrapper.innerHTML;
}
