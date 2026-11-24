"use client";

/**
 * In-app replacement for window.alert / confirm / prompt. Same clean,
 * centered dialog everywhere. Usage (async):
 *   if (await appConfirm("Delete this macro?", { danger: true })) …
 *   await appAlert("That password isn't right.");
 *   const name = await appPrompt("Name this device", { defaultValue: "Office iPhone" });
 * <AppDialogHost /> is mounted once in the root layout.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

type Kind = "alert" | "confirm" | "prompt";
export type DialogOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  defaultValue?: string;
  inputType?: "text" | "password";
  placeholder?: string;
};
type Req = DialogOptions & { id: number; kind: Kind; message: string; resolve: (v: unknown) => void };

let queue: Req[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getCurrent = () => queue[0] ?? null;

function open<T>(kind: Kind, message: string, opts: DialogOptions): Promise<T> {
  return new Promise<T>((resolve) => {
    queue = [...queue, { ...opts, id: nextId++, kind, message, resolve: resolve as (v: unknown) => void }];
    emit();
  });
}

export function appAlert(message: string, opts: DialogOptions = {}): Promise<void> {
  return open<void>("alert", message, opts);
}
const RISKY = /^\s*(delete|remove|revoke|clear|reset|discard|turn off)\b/i;

export function appConfirm(message: string, opts: DialogOptions = {}): Promise<boolean> {
  // "Delete X?" / "Remove Y?" → red button labelled with the action.
  const m = RISKY.exec(message);
  if (m && opts.danger === undefined) {
    const word = m[1].toLowerCase();
    opts = { ...opts, danger: true, confirmLabel: opts.confirmLabel ?? word.charAt(0).toUpperCase() + word.slice(1) };
  }
  return open<boolean>("confirm", message, opts);
}
export function appPrompt(message: string, opts: DialogOptions = {}): Promise<string | null> {
  return open<string | null>("prompt", message, opts);
}

function close(value: unknown) {
  const cur = queue[0];
  if (!cur) return;
  queue = queue.slice(1);
  emit();
  cur.resolve(value);
}

export function AppDialogHost() {
  const req = useSyncExternalStore(subscribe, getCurrent, () => null);
  if (!req) return null;
  return <DialogView key={req.id} req={req} />;
}

function DialogView({ req }: { req: Req }) {
  const [value, setValue] = useState(req.defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelValue = req.kind === "confirm" ? false : req.kind === "prompt" ? null : undefined;
  const okValue = () => (req.kind === "confirm" ? true : req.kind === "prompt" ? value : undefined);

  useEffect(() => {
    (inputRef.current ?? okRef.current)?.focus();
  }, []);

  const title = req.title ?? (req.kind === "alert" ? "Heads up" : req.kind === "prompt" ? "One quick thing" : req.danger ? "Are you sure?" : "Please confirm");

  return (
    <div
      className="modal-overlay fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.5)] px-4 py-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(cancelValue);
      }}
    >
      <form
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close(cancelValue);
          }
        }}
        aria-labelledby="app-dialog-title"
        aria-modal="true"
        className="panel-card w-full max-w-md p-5"
        onSubmit={(e) => {
          e.preventDefault();
          close(okValue());
        }}
        role={req.kind === "alert" ? "alertdialog" : "dialog"}
      >
        <h2 className="text-lg font-semibold text-[var(--text-main)]" id="app-dialog-title">
          {title}
        </h2>
        <p className="mt-2 whitespace-pre-line text-sm text-[var(--text-muted)]">{req.message}</p>
        {req.kind === "prompt" && (
          <input
            className="mt-3 w-full rounded-xl border border-[var(--line-soft)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-primary)]"
            onChange={(e) => setValue(e.target.value)}
            placeholder={req.placeholder}
            ref={inputRef}
            type={req.inputType ?? "text"}
            value={value}
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          {req.kind !== "alert" && (
            <Button onClick={() => close(cancelValue)} variant="secondary">
              {req.cancelLabel ?? "Cancel"}
            </Button>
          )}
          <Button ref={okRef} type="submit" variant={req.danger ? "danger" : "primary"}>
            {req.confirmLabel ?? (req.kind === "alert" ? "OK" : req.danger ? "Yes, continue" : "OK")}
          </Button>
        </div>
      </form>
    </div>
  );
}
