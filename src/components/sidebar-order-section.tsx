"use client";

import { useMemo, useState } from "react";
import { savePersonPref, type SaveResult } from "@/lib/cloud/brand-save";
import { useSidebarOrder } from "@/hooks/use-sidebar-order";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import {
  SETTINGS_ID,
  SIDEBAR_ORDER_KEY,
  applySidebarOrder,
  moveSidebarId,
  reorderSidebarId,
  sameSidebarOrder,
  sidebarOrderValue,
  visibleSidebarPages,
} from "@/lib/sidebar-order";

type Status = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "failed"; reason: string };

/**
 * Settings → Sidebar. Each person arranges their own pages. Settings stays
 * last. Saved appears only after the cloud row is read back.
 */
export function SidebarOrderSection() {
  const { canView } = useWorkspaceAccess();
  const saved = useSidebarOrder();
  const pages = useMemo(() => visibleSidebarPages("complete", canView), [canView]);
  const base = useMemo(
    () => applySidebarOrder(pages, saved).filter((page) => page.id !== SETTINGS_ID).map((page) => page.id),
    [pages, saved],
  );
  const [override, setOverride] = useState<string[] | null>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [dragId, setDragId] = useState<string | null>(null);
  if (override && sameSidebarOrder(override, base)) setOverride(null);
  const draft = override ?? base;
  const labels = new Map(pages.map((page) => [page.id, page.label]));
  const settings = pages.find((page) => page.id === SETTINGS_ID);
  const dirty = !sameSidebarOrder(draft, base);

  const run = async (ids: string[]) => {
    setStatus({ state: "saving" });
    const result: SaveResult = await savePersonPref(SIDEBAR_ORDER_KEY, sidebarOrderValue(ids));
    setStatus(result.ok ? { state: "saved" } : { state: "failed", reason: result.reason });
  };

  const save = () => {
    setOverride(draft);
    void run(draft);
  };

  const reset = () => {
    const next = applySidebarOrder(pages, null).filter((page) => page.id !== SETTINGS_ID).map((page) => page.id);
    setOverride(next);
    void run(next);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        {status.state === "saving" && <span className="text-sm text-[var(--text-muted)]">Saving…</span>}
        {status.state === "saved" && <span className="text-sm font-semibold text-[var(--status-active,#186843)]">Saved</span>}
        {status.state === "failed" && (
          <>
            <span className="text-sm text-[var(--status-alert,#8f251f)]">Not saved. {status.reason}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void run(draft)}>
              Retry
            </button>
          </>
        )}
        <button type="button" className="btn btn-secondary" onClick={reset} disabled={status.state === "saving"}>
          Reset to Default
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || status.state === "saving"}>
          {status.state === "saving" ? "Saving…" : "Save Order"}
        </button>
      </div>
      <ul className="divide-y divide-[var(--line-soft)]">
        {draft.map((id, index) => {
          const label = labels.get(id) ?? id;
          return (
            <li
              key={id}
              draggable
              onDragStart={(event) => {
                setDragId(id);
                event.dataTransfer.setData("text/plain", id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = event.dataTransfer.getData("text/plain") || dragId;
                if (!from) return;
                setOverride(reorderSidebarId(draft, from, id));
                setStatus({ state: "idle" });
                setDragId(null);
              }}
              className={`flex items-center gap-2 py-2 ${dragId === id ? "opacity-50" : ""}`}
            >
              <span aria-hidden className="cursor-grab px-1 text-[var(--text-muted)] select-none">
                ⋮⋮
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label={`Move ${label} Up`}
                disabled={index === 0}
                onClick={() => {
                  setOverride(moveSidebarId(draft, id, -1));
                  setStatus({ state: "idle" });
                }}
              >
                Up
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label={`Move ${label} Down`}
                disabled={index === draft.length - 1}
                onClick={() => {
                  setOverride(moveSidebarId(draft, id, 1));
                  setStatus({ state: "idle" });
                }}
              >
                Down
              </button>
            </li>
          );
        })}
      </ul>
      {settings && (
        <div className="border-t border-[var(--line-soft)] py-2 pl-7 text-sm font-semibold">{settings.label}</div>
      )}
    </div>
  );
}
