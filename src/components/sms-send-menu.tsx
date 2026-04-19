"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import {
  buildSmsUrl,
  expandTokens,
  type SmsTokenContext,
} from "@/lib/sms-templates";

type Props = {
  phone: string;
  context: SmsTokenContext;
  /** Label shown inside the button. Defaults to the formatted phone. */
  label?: string;
  /** Extra tailwind classes for the button. */
  className?: string;
  /** Left or right edge alignment of the popup relative to the button. */
  align?: "left" | "right";
};

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const MENU_WIDTH = 240;
const MENU_MARGIN = 8;

// ── Module-level outside-click / Escape / scroll dispatcher ──
// Each SmsSendMenu instance previously installed its own three document
// listeners. With 100+ instances on the patients page the leak guard
// (rightly) tripped at 100 mousedown handlers. Instead we install ONE
// set of listeners at module load and let the currently-open menu
// register a single close callback. Only one menu can be open at a
// time anyway (opening a new one closes the previous via this ref).

type CloseFn = (event: Event) => void;
let activeClose: CloseFn | null = null;
let listenersInstalled = false;

function handleDocumentMouseDown(event: MouseEvent) {
  activeClose?.(event);
}
function handleDocumentKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") activeClose?.(event);
}
function handleWindowScroll(event: Event) {
  activeClose?.(event);
}

function ensureGlobalListeners() {
  if (listenersInstalled || typeof document === "undefined") return;
  listenersInstalled = true;
  document.addEventListener("mousedown", handleDocumentMouseDown);
  document.addEventListener("keydown", handleDocumentKeyDown);
  // Capture phase so a scrolling ancestor closes the menu before its own
  // scroll handler fires.
  window.addEventListener("scroll", handleWindowScroll, true);
}

/**
 * Clickable phone → opens a small menu of SMS templates → picks one →
 * launches Messages.app via an `sms:` URL. All sending is manual by
 * design (no Twilio backend); every template click triggers one URL
 * handoff to the native messaging app.
 *
 * The menu is portaled to document.body and positioned with fixed
 * coordinates so it floats above any ancestor with overflow: hidden.
 */
export function SmsSendMenu({
  phone,
  context,
  label,
  className,
  align = "left",
}: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const { smsTemplates } = useSmsTemplates();
  const { officeSettings } = useOfficeSettings();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const resolvedContext = useMemo<SmsTokenContext>(
    () => ({
      ...context,
      office: {
        officeName: officeSettings.officeName,
        doctorName: officeSettings.doctorName,
      },
    }),
    [context, officeSettings.officeName, officeSettings.doctorName],
  );

  const digits = phone.replace(/\D/g, "");

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const desiredLeft =
      align === "right" ? rect.right - MENU_WIDTH : rect.left;
    const maxLeft = window.innerWidth - MENU_WIDTH - MENU_MARGIN;
    const left = Math.max(MENU_MARGIN, Math.min(desiredLeft, maxLeft));
    const top = rect.bottom + 4;
    setCoords({ top, left });
  }, [open, align]);

  // Register THIS menu as the active close target while it's open.
  // No addEventListener calls in this effect — the actual document
  // listeners live at module scope and are installed exactly once.
  useEffect(() => {
    if (!open) return;
    ensureGlobalListeners();
    const close: CloseFn = (event) => {
      const target = event.target as Node | null;
      if (target) {
        if (menuRef.current?.contains(target)) return;
        if (buttonRef.current?.contains(target)) return;
      }
      setOpen(false);
    };
    activeClose = close;
    return () => {
      if (activeClose === close) activeClose = null;
    };
  }, [open]);

  const handlePick = (body: string) => {
    const expanded = expandTokens(body, resolvedContext);
    const url = buildSmsUrl(phone, expanded);
    setOpen(false);
    if (typeof window !== "undefined") {
      window.location.href = url;
    }
  };

  const displayLabel = label ?? phone;

  if (!digits) {
    return <span className={className}>{displayLabel}</span>;
  }

  const buttonClass =
    className ??
    "text-[var(--brand-primary)] underline decoration-dotted underline-offset-2 hover:decoration-solid";

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={buttonClass}
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        {displayLabel}
      </button>
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-[100] rounded-xl border border-[var(--line-soft)] bg-white p-2 shadow-xl"
              ref={menuRef}
              role="menu"
              style={{
                top: coords.top,
                left: coords.left,
                width: MENU_WIDTH,
              }}
            >
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Send text
              </p>
              {smsTemplates.length === 0 ? (
                <p className="px-2 py-2 text-xs text-[var(--text-muted)]">
                  No templates yet. Add some in Settings → SMS / Text Templates.
                </p>
              ) : (
                <ul className="max-h-72 overflow-y-auto">
                  {smsTemplates.map((tpl) => (
                    <li key={tpl.id}>
                      <button
                        className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--bg-soft)]"
                        onClick={() => handlePick(tpl.body)}
                        type="button"
                      >
                        {tpl.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1 border-t border-[var(--line-soft)] pt-1">
                <button
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--bg-soft)]"
                  onClick={() => handlePick("")}
                  type="button"
                >
                  Open Messages with blank body
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
