"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { writeDraft } from "@/lib/draft-recovery";

export interface RichTextTemplateEditorHandle {
  focus: () => void;
  insertText: (text: string) => void;
  insertHtml: (html: string) => void;
  /** Insert inline HTML at the caret, on the same line, with one space
   *  before it when the caret sits right after text. */
  insertInlineHtml: (html: string) => void;
}

type RichTextTemplateEditorProps = {
  value: string;
  onChange: (nextValue: string) => void;
  fontFamily?: string;
  minHeightClassName?: string;
  className?: string;
  placeholder?: string;
  onElementClick?: (target: HTMLElement) => void;
  /** When true the editor is fully locked: the content is not editable
   *  and the formatting toolbar is hidden. Used for signed/closed
   *  encounters so a finished note can't be accidentally typed into or
   *  deleted. Text stays selectable/copyable. */
  readOnly?: boolean;
  /** Optional crash-safe draft key. When set, every input event
   *  synchronously writes the current editor HTML to localStorage
   *  under this key BEFORE any React state update runs. See
   *  src/lib/draft-recovery.ts for the full rationale. */
  draftKey?: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function textToHtml(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function normalizeIncomingValue(value: string) {
  if (!value.trim()) {
    return "";
  }
  return looksLikeHtml(value) ? value : textToHtml(value);
}

function normalizeOutgoingValue(value: string) {
  // Only strip leading/trailing whitespace. We deliberately do NOT
  // nuke <p><br></p> or <div><br></div> here — those are the
  // separators that appendSoapSection inserts between macros, and if
  // we strip them on every keystroke the second macro snaps flush up
  // against the first. The hook-level normalizer (normalizeEditorBlocks)
  // already collapses runs of multiple empty blocks to a single one,
  // so the editor just needs to pass the HTML through unchanged.
  return value.replace(/^\s+|\s+$/g, "").trim();
}

function isSelectionInsideEditor(editor: HTMLDivElement | null) {
  if (!editor || typeof window === "undefined") {
    return false;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer);
}

export const RichTextTemplateEditor = forwardRef<
  RichTextTemplateEditorHandle,
  RichTextTemplateEditorProps
>(function RichTextTemplateEditor(
  {
    value,
    onChange,
    fontFamily,
    minHeightClassName = "min-h-[320px]",
    className = "",
    placeholder = "Start writing...",
    onElementClick,
    readOnly = false,
    draftKey,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastAppliedRef = useRef("");
  const isFocusedRef = useRef(false);
  // Values this editor emitted recently (newest last) and when the user
  // last typed. Used to tell a stale/normalized echo of our own typing
  // (which must NEVER overwrite a focused editor — that's the "text
  // vanishes then reappears" bug) from a genuine programmatic change.
  const recentEmitsRef = useRef<string[]>([]);
  const lastInputAtRef = useRef(0);
  // Cursor position the user was at the last time the editor held the
  // selection. Restored before insertText / insertHtml so a macro
  // button click (which moves focus away from the editor and clears
  // the selection) still drops content at the right caret position
  // instead of jumping to the end of the field.
  const lastSelectionRangeRef = useRef<Range | null>(null);
  // Text offset where the last inline macro insert ended (see insertInlineHtml).
  const lastInlineEndRef = useRef<number | null>(null);

  const captureSelection = () => {
    const editor = editorRef.current;
    if (!editor || typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    lastSelectionRangeRef.current = range.cloneRange();
  };

  const restoreSelection = () => {
    const range = lastSelectionRangeRef.current;
    const editor = editorRef.current;
    if (!range || !editor) return false;
    if (!editor.contains(range.commonAncestorContainer)) return false;
    if (typeof window === "undefined") return false;
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };
  // Hold the current draftKey in a ref so the input handler (bound
  // once, see onInput below) always reads the latest key — avoids
  // having to re-register listeners when the parent swaps encounters.
  const draftKeyRef = useRef<string | undefined>(draftKey);
  useEffect(() => {
    draftKeyRef.current = draftKey;
  }, [draftKey]);

  const syncEditorWithValue = () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const nextHtml = normalizeIncomingValue(value);
    if (editor.innerHTML === nextHtml) {
      lastAppliedRef.current = nextHtml;
      return;
    }
    // If the editor is focused but the value changed externally
    // (e.g., SOAP was salted/copied programmatically), we MUST update
    // even though the user is focused — otherwise the old content
    // sticks around and overwrites the programmatic change on blur.
    const isExternalChange =
      nextHtml !== lastAppliedRef.current && normalizeOutgoingValue(nextHtml) !== lastAppliedRef.current;
    if (isFocusedRef.current) {
      if (!isExternalChange) return;
      // An older value we emitted ourselves arriving late (debounced save
      // round-trip, another hook instance re-reading storage) — ignore.
      const out = normalizeOutgoingValue(nextHtml);
      if (recentEmitsRef.current.includes(out) || recentEmitsRef.current.includes(nextHtml)) return;
      // While the user is actively typing, never yank the content out
      // from under them; the next keystroke re-emits the live DOM.
      if (Date.now() - lastInputAtRef.current < 1500) return;
    }
    editor.innerHTML = nextHtml;
    lastAppliedRef.current = nextHtml;
  };

  useEffect(() => {
    syncEditorWithValue();
  }, [value]);

  // Debounced crash-safe draft. Previously writeDraft fired on
  // EVERY keystroke — at 80 WPM that's ~6-8 localStorage.setItem
  // calls per second, each preceded by a JSON.stringify of the
  // full editor HTML. Pure overhead with no real safety benefit
  // over a 1-second debounce: even if the tab crashes
  // mid-debounce-window, the user loses at most ~1 second of
  // typing, and the flush handlers below (blur / pagehide /
  // beforeunload / visibilitychange) commit the pending draft
  // synchronously before any unload event, so a clean tab close
  // still preserves everything.
  const pendingDraftHtmlRef = useRef<string | null>(null);
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDraftNow = () => {
    if (draftDebounceRef.current) {
      clearTimeout(draftDebounceRef.current);
      draftDebounceRef.current = null;
    }
    const pending = pendingDraftHtmlRef.current;
    if (pending === null) return;
    pendingDraftHtmlRef.current = null;
    const key = draftKeyRef.current;
    if (key) writeDraft(key, pending);
  };
  // Stable ref so the unmount + window listener effects below can
  // depend on `[]` without restarting on every render.
  const flushDraftRef = useRef(flushDraftNow);
  flushDraftRef.current = flushDraftNow;
  useEffect(() => {
    const flush = () => flushDraftRef.current();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      // Final flush on unmount catches the SPA-navigation case
      // where the editor unmounts without any unload event.
      flush();
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    // Crash-safe draft, debounced. The CURRENT html is captured
    // immediately so the pending flush always has the latest value.
    const raw = editor.innerHTML;
    pendingDraftHtmlRef.current = raw;
    if (draftDebounceRef.current) {
      clearTimeout(draftDebounceRef.current);
    }
    draftDebounceRef.current = setTimeout(() => {
      draftDebounceRef.current = null;
      flushDraftNow();
    }, 1000);

    const next = normalizeOutgoingValue(raw);
    if (next === lastAppliedRef.current) {
      return;
    }
    lastAppliedRef.current = next;
    lastInputAtRef.current = Date.now();
    const emits = recentEmitsRef.current;
    emits.push(next);
    if (emits.length > 30) emits.splice(0, emits.length - 30);
    onChange(next);
  };

  const runCommand = (command: string, commandValue?: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    if (!isSelectionInsideEditor(editor)) {
      editor.focus();
    }

    document.execCommand(command, false, commandValue);
    emitChange();
  };

  const insertText = (text: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    isFocusedRef.current = true;

    // ALWAYS restore the caret we saved on blur. focus() drops a fresh
    // collapsed selection at the START of the editor, so relying on
    // "is the selection already inside" inserts at the top every time.
    // restoreSelection() no-ops if we have no saved range (falls through
    // to focus()'s position — fine for a first insert into an empty note).
    editor.focus();
    restoreSelection();
    document.execCommand("insertText", false, text);
    // Save the NEW caret (now after the inserted text) so a follow-up
    // insert chains after this one instead of stacking at the start.
    captureSelection();
    emitChange();
  };

  const insertHtml = (html: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    isFocusedRef.current = true;

    editor.focus();
    restoreSelection();
    document.execCommand("insertHTML", false, html);
    captureSelection();
    emitChange();
  };

  const insertInlineHtml = (html: string) => {
    const editor = editorRef.current;
    if (!editor || typeof window === "undefined") {
      return;
    }
    isFocusedRef.current = true;
    editor.focus();
    const selection = window.getSelection();
    const caretAtEndOf = (node: Node) => {
      const r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(r);
    };
    const isBlock = (n: Node | null): n is HTMLElement =>
      n instanceof HTMLElement && /^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(n.tagName);
    // The saved caret can be lost when the note re-renders after the last
    // macro; then continue at the end of the note, not its start.
    if (!restoreSelection() || !selection || selection.rangeCount === 0) caretAtEndOf(editor);
    // A re-render after the last macro swaps the note's nodes and drops the
    // saved caret back to the very start; put it where that macro ended.
    const saved = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (saved && saved.startContainer === editor && saved.startOffset === 0 && lastInlineEndRef.current !== null) {
      let left = lastInlineEndRef.current;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let placed = false;
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const len = t.textContent?.length ?? 0;
        if (left <= len) {
          const r = document.createRange();
          r.setStart(t, left);
          r.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(r);
          placed = true;
          break;
        }
        left -= len;
      }
      if (!placed) caretAtEndOf(editor);
    }
    if (!selection || selection.rangeCount === 0) return;
    let block: Node = selection.getRangeAt(0).startContainer;
    while (block !== editor && !isBlock(block)) block = block.parentNode ?? editor;
    // Caret parked on the empty line the browser adds after a pasted
    // paragraph: go back to the end of the paragraph above it.
    if (block !== editor && !(block.textContent ?? "").trim()) {
      const prev = (block as HTMLElement).previousElementSibling;
      let next = (block as HTMLElement).nextElementSibling;
      while (next && !(next.textContent ?? "").trim()) next = next.nextElementSibling;
      if (isBlock(prev) && (prev.textContent ?? "").trim() && !next) {
        (block as HTMLElement).remove();
        block = prev;
        caretAtEndOf(prev);
      }
    }
    const caret = selection.getRangeAt(0);
    const probe = document.createRange();
    probe.selectNodeContents(block);
    probe.setEnd(caret.startContainer, caret.startOffset);
    const before = probe.toString();
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    document.execCommand("insertHTML", false, `${needsSpace ? "&nbsp;" : ""}${html}`);
    if (selection && selection.rangeCount > 0) {
      const end = document.createRange();
      end.selectNodeContents(editor);
      end.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
      lastInlineEndRef.current = end.toString().length;
    }
    captureSelection();
    emitChange();
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      editorRef.current?.focus();
    },
    insertText,
    insertHtml,
    insertInlineHtml,
  }));

  return (
    <div className={`rounded-xl border border-[var(--line-soft)] bg-white ${className}`}>
      <div className={`flex flex-wrap items-center gap-2 border-b border-[var(--line-soft)] bg-[var(--bg-soft)] p-2 ${readOnly ? "hidden" : ""}`}>
        <span className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Editor
        </span>
        <select
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
          defaultValue=""
          onChange={(event) => {
            const value = event.target.value;
            if (!value) {
              return;
            }
            runCommand("formatBlock", value);
            event.currentTarget.value = "";
          }}
        >
          <option value="">Format</option>
          <option value="<p>">Paragraph</option>
          <option value="<h1>">Heading 1</option>
          <option value="<h2>">Heading 2</option>
          <option value="<h3>">Heading 3</option>
          <option value="<blockquote>">Quote</option>
        </select>
        <select
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
          defaultValue=""
          onChange={(event) => {
            const size = event.target.value;
            if (!size) {
              return;
            }
            runCommand("fontSize", "7");
            const editor = editorRef.current;
            if (editor) {
              const fonts = editor.querySelectorAll('font[size="7"]');
              fonts.forEach((el) => {
                const span = document.createElement("span");
                span.style.fontSize = size;
                span.innerHTML = el.innerHTML;
                el.replaceWith(span);
              });
              emitChange();
            }
            event.currentTarget.value = "";
          }}
        >
          <option value="">Size</option>
          <option value="10px">10</option>
          <option value="12px">12</option>
          <option value="14px">14</option>
          <option value="16px">16</option>
          <option value="18px">18</option>
          <option value="20px">20</option>
          <option value="24px">24</option>
        </select>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("undo")}
          type="button"
        >
          Undo
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("redo")}
          type="button"
        >
          Redo
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("bold")}
          type="button"
        >
          B
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold italic"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("italic")}
          type="button"
        >
          I
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold underline"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("underline")}
          type="button"
        >
          U
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("insertUnorderedList")}
          type="button"
        >
          Bullets
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("insertOrderedList")}
          type="button"
        >
          Numbered
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("justifyLeft")}
          type="button"
        >
          Left
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("justifyCenter")}
          type="button"
        >
          Center
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("justifyRight")}
          type="button"
        >
          Right
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => insertText("    ")}
          type="button"
        >
          Tab
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => insertHtml("<br />")}
          type="button"
        >
          Line Break
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => insertHtml("<p><br /></p>")}
          type="button"
        >
          Paragraph
        </button>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand("removeFormat")}
          type="button"
        >
          Clear
        </button>
      </div>

      <div
        ref={editorRef}
        aria-label="Rich text editor"
        className={`rich-text-editor ${minHeightClassName} w-full overflow-auto px-3 py-2 text-sm leading-6 whitespace-pre-wrap break-words [overflow-wrap:anywhere] focus:outline-none ${readOnly ? "bg-[var(--bg-soft)] cursor-not-allowed" : "bg-white"}`}
        contentEditable={!readOnly}
        data-placeholder={placeholder}
        onFocus={() => { isFocusedRef.current = true; }}
        onBlur={() => {
          // Capture cursor position BEFORE blur completes so a click on
          // a macro button (which steals focus) can still restore it.
          captureSelection();
          isFocusedRef.current = false;
          emitChange();
        }}
        onInput={emitChange}
        onKeyUp={captureSelection}
        onMouseUp={captureSelection}
        onKeyDown={(event) => {
          // Enter / Shift+Enter handling.
          //
          // Previously this was inverted — plain Enter inserted a <br>
          // (no visible gap) and Shift+Enter let the browser create a
          // <p>. The intent was to avoid a "two-line jump" between
          // paragraphs, but the actual UX consequence was that users
          // typing notes one section per line ended up with everything
          // glued onto the same line/paragraph. The only way to get
          // proper section separation was to click the Paragraph
          // toolbar button by hand on every break — which is exactly
          // what the user complained about.
          //
          // Flipped to the conventional word-processor mapping:
          //   - Plain Enter   → new paragraph (visible gap, same as
          //                     clicking the Paragraph toolbar button)
          //   - Shift+Enter   → soft line break (<br>, no gap) for the
          //                     occasional case where you want the
          //                     next line tucked tight against this one
          //
          // For the plain-Enter case we let the browser's default
          // contentEditable behavior run — it produces a clean <p>
          // block and places the caret inside the new paragraph,
          // which is what every word processor / Gmail / Notion does.
          if (event.key === "Enter" && event.shiftKey) {
            event.preventDefault();
            const supportsLineBreak =
              typeof document.queryCommandSupported === "function" &&
              document.queryCommandSupported("insertLineBreak");
            if (supportsLineBreak) {
              document.execCommand("insertLineBreak");
            } else {
              document.execCommand("insertHTML", false, "<br>");
            }
            emitChange();
            return;
          }

          // Protect macro-prompt pills from accidental deletion.
          // Standard contentEditable behaviour: when the caret sits
          // right after a contenteditable=false element and the user
          // presses Backspace, Chrome/Safari delete the whole span in
          // one keystroke. User complaint: "when i delete those
          // paragraph spaces it ends up deleting the macro input
          // before it". Fix is to intercept Backspace when the caret
          // is immediately adjacent to a .macro-prompt span and move
          // the caret to JUST BEFORE the pill instead of deleting it.
          // The user can still delete the pill by clicking it (which
          // re-opens the picker and offers a clear option) or by
          // selecting + deleting explicitly.
          if (event.key === "Backspace") {
            const editor = editorRef.current;
            if (!editor) return;
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return;
            const range = selection.getRangeAt(0);
            if (!range.collapsed) return; // user selected something — let it run
            if (!editor.contains(range.startContainer)) return;

            // Walk one step back from the caret. We want to know if
            // the thing that would be deleted is (or is inside) a
            // macro-prompt span.
            const findPrevAdjacent = (): HTMLElement | null => {
              const container = range.startContainer;
              const offset = range.startOffset;
              // Text node: if the caret is at offset 0, the "previous"
              // thing is the previous sibling.
              if (container.nodeType === Node.TEXT_NODE) {
                if (offset > 0) return null;
                let prev: Node | null = container.previousSibling;
                while (prev && prev.nodeType === Node.TEXT_NODE && !prev.textContent) {
                  prev = prev.previousSibling;
                }
                return prev instanceof HTMLElement ? prev : null;
              }
              // Element node: the previous sibling of the child at offset.
              if (container.nodeType === Node.ELEMENT_NODE) {
                const childNode = (container as HTMLElement).childNodes[offset - 1];
                return childNode instanceof HTMLElement ? childNode : null;
              }
              return null;
            };

            const prev = findPrevAdjacent();
            const pill = prev?.closest?.(".macro-prompt") ?? null;
            if (pill) {
              // Move the caret to just BEFORE the pill instead of
              // letting the browser delete the pill.
              event.preventDefault();
              const newRange = document.createRange();
              newRange.setStartBefore(pill);
              newRange.collapse(true);
              selection.removeAllRanges();
              selection.addRange(newRange);
              captureSelection();
              return;
            }
          }
        }}
        onPaste={(event) => {
          // Intercept paste: strip foreign HTML and insert as clean text
          // to prevent broken markup from crashing the editor or wrecking state.
          const clipboard = event.clipboardData;
          if (!clipboard) return;
          const html = clipboard.getData("text/html");
          const plain = clipboard.getData("text/plain");
          // If the paste contains HTML from an external source (not our own
          // editor), sanitise it down to plain text to avoid layout-breaking
          // tags like <meta>, <style>, Word markup, etc.
          if (html && !html.includes("data-macro-run-id")) {
            event.preventDefault();
            document.execCommand("insertText", false, plain || "");
            emitChange();
          }
        }}
        onClick={(event) => {
          if (onElementClick && event.target instanceof HTMLElement) {
            onElementClick(event.target);
          }
        }}
        spellCheck
        style={{ fontFamily }}
        suppressContentEditableWarning
      />
    </div>
  );
});
