"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

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
  const normalized = value
    .replace(/^\s+|\s+$/g, "")
    .replace(/<div><br><\/div>/gi, "")
    .replace(/<p><br><\/p>/gi, "")
    .trim();
  return normalized;
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
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastAppliedRef = useRef("");
  const isFocusedRef = useRef(false);

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
    const next = normalizeOutgoingValue(editor.innerHTML);
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

    if (!isSelectionInsideEditor(editor)) {
      editor.focus();
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

    if (!isSelectionInsideEditor(editor)) {
      editor.focus();
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
        onBlur={() => { isFocusedRef.current = false; emitChange(); }}
        onInput={emitChange}
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
