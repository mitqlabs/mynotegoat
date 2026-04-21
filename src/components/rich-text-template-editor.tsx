"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { writeDraft } from "@/lib/draft-recovery";

export interface RichTextTemplateEditorHandle {
  focus: () => void;
  insertText: (text: string) => void;
  insertHtml: (html: string) => void;
}

type RichTextTemplateEditorProps = {
  value: string;
  onChange: (nextValue: string) => void;
  fontFamily?: string;
  minHeightClassName?: string;
  className?: string;
  placeholder?: string;
  onElementClick?: (target: HTMLElement) => void;
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
    draftKey,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastAppliedRef = useRef("");
  const isFocusedRef = useRef(false);
  // Cursor position the user was at the last time the editor held the
  // selection. Restored before insertText / insertHtml so a macro
  // button click (which moves focus away from the editor and clears
  // the selection) still drops content at the right caret position
  // instead of jumping to the end of the field.
  const lastSelectionRangeRef = useRef<Range | null>(null);

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
    const isExternalChange = nextHtml !== lastAppliedRef.current;
    if (isFocusedRef.current && !isExternalChange) {
      return;
    }
    editor.innerHTML = nextHtml;
    lastAppliedRef.current = nextHtml;
  };

  useEffect(() => {
    syncEditorWithValue();
  }, [value]);

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    // Crash-safe draft: write the RAW editor HTML to localStorage
    // BEFORE doing any React state work. This is the belt-and-
    // suspenders that survives any crash between "user typed" and
    // "React re-rendered and flushed saveEncounterNoteRecords". If
    // the tab OOMs, freezes, or is force-closed, the draft is safe.
    const raw = editor.innerHTML;
    const currentDraftKey = draftKeyRef.current;
    if (currentDraftKey) {
      writeDraft(currentDraftKey, raw);
    }
    const next = normalizeOutgoingValue(raw);
    if (next === lastAppliedRef.current) {
      return;
    }
    lastAppliedRef.current = next;
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

    editor.focus();
    // Try to restore the user's last caret position. If we can't, fall
    // through to whatever selection focus() landed on (usually end).
    if (!isSelectionInsideEditor(editor)) {
      restoreSelection();
    }
    document.execCommand("insertText", false, text);
    emitChange();
  };

  const insertHtml = (html: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    isFocusedRef.current = true;

    editor.focus();
    if (!isSelectionInsideEditor(editor)) {
      restoreSelection();
    }
    document.execCommand("insertHTML", false, html);
    emitChange();
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      editorRef.current?.focus();
    },
    insertText,
    insertHtml,
  }));

  return (
    <div className={`rounded-xl border border-[var(--line-soft)] bg-white ${className}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line-soft)] bg-[var(--bg-soft)] p-2">
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
        className={`rich-text-editor ${minHeightClassName} w-full overflow-auto bg-white px-3 py-2 text-sm leading-6 whitespace-pre-wrap break-words [overflow-wrap:anywhere] focus:outline-none`}
        contentEditable
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
          // Override the browser's default Enter behavior in
          // contentEditable, which inserts a <p> block. Because
          // .rich-text-editor p has a 0.7em bottom margin, every Enter
          // press visually adds one line-height PLUS the margin — feels
          // like two lines of jump, especially right after a macro
          // insertion where the previous block is already a <p>.
          //
          // Switch to a single <br> on plain Enter (consistent single-
          // line spacing, matches user expectations for "next line").
          // Shift+Enter still falls through to the default paragraph
          // behavior for the occasional user who wants the bigger gap.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            // insertLineBreak is the standard execCommand for the
            // Shift+Enter semantic. Fall back to insertHTML("<br>") on
            // browsers that don't support it.
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
