"use client";

import { useState } from "react";

/** Copies plain text (e.g. recommendations, ready for the Specialist box). */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="shrink-0 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-0.5 font-semibold text-[var(--brand-primary)] hover:bg-[var(--bg-soft)]"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
      style={{ fontSize: 12 }}
      title="Copy as plain text"
      type="button"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

