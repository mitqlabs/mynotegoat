/**
 * Helpers for chaining one-paragraph Plan macros ("Begin Decompression", then a
 * second-region macro) into the SAME paragraph instead of a new line.
 */

/** One-paragraph macro HTML → its inline content; null if it has several blocks or real line breaks. */
export function toInlineMacroHtml(html: string): string | null {
  let inner = html.trim();
  const wrapped = /^<(p|div)>([\s\S]*)<\/\1>$/i.exec(inner);
  if (wrapped) inner = wrapped[2].trim();
  inner = inner.replace(/(?:<br\s*\/?>\s*)+$/i, "").trim();
  // A newline in the macro's source text is only whitespace in HTML (a soft-wrapped
  // sentence), not a line break — so it must not stop the macro joining the paragraph.
  inner = inner.replace(/\s*\n\s*/g, " ");
  if (!inner || /<\/?(p|div|ul|ol|li|table|h[1-6]|blockquote)\b|<br\b/i.test(inner)) return null;
  return inner;
}

/**
 * Append a one-paragraph snippet inside the LAST paragraph of `existingHtml`, one space
 * after its text. Returns null when that isn't possible (nothing before it, the last
 * block is empty or not a paragraph, or the snippet has several blocks / line breaks),
 * so the caller falls back to stacking it as its own block.
 */
export function appendInlineToLastBlock(existingHtml: string, snippetHtml: string): string | null {
  const inline = toInlineMacroHtml(snippetHtml);
  if (inline === null) return null;
  const existing = existingHtml.trim();
  const last = /<(p|div)>((?:(?!<\/?(?:p|div)\b)[\s\S])*)<\/\1>$/i.exec(existing);
  if (!last) return null;
  const lastText = last[2].replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "");
  const hasPrompt = /data-prompt-id|data-macro-run-id/.test(last[2]);
  if (!lastText && !hasPrompt) return null;
  const body = last[2].replace(/(?:<br\s*\/?>\s*)+$/i, "");
  const head = existing.slice(0, existing.length - last[0].length);
  return `${head}<${last[1].toLowerCase()}>${body} ${inline}</${last[1].toLowerCase()}>`;
}
