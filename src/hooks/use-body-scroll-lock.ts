import { useEffect } from "react";

/**
 * Lock the page <body> from scrolling while a modal/popup is open.
 *
 * Why: when a modal overlay (fixed inset-0) is up, scrolling inside
 * the modal — or even just rolling the wheel over the dimmed
 * background — used to scroll the underlying page. That made it
 * easy to lose your place in the patient file or encounter while
 * editing in a popup. Locking body overflow keeps the underlying
 * page steady until the modal closes.
 *
 * Refcount-aware: many modals can be open at once (e.g. confirm
 * dialog spawned from a settings panel). The first one to mount
 * snapshots the original overflow + paddingRight values; subsequent
 * mounts just bump the count. The last one to unmount restores.
 *
 * Scrollbar compensation: locking overflow makes the vertical
 * scrollbar disappear, which causes the page to "jump" right by
 * ~15px on macOS / Windows where overlay scrollbars aren't always
 * used. We compensate by adding the scrollbar width as paddingRight
 * to body so the layout doesn't shift when the lock engages or
 * releases.
 */
let activeCount = 0;
let originalOverflow: string | null = null;
let originalPaddingRight: string | null = null;

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined") return;

    if (activeCount === 0) {
      originalOverflow = document.body.style.overflow;
      originalPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth =
        window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
      document.body.style.overflow = "hidden";
    }
    activeCount += 1;

    return () => {
      activeCount = Math.max(0, activeCount - 1);
      if (activeCount === 0) {
        document.body.style.overflow = originalOverflow ?? "";
        document.body.style.paddingRight = originalPaddingRight ?? "";
        originalOverflow = null;
        originalPaddingRight = null;
      }
    };
  }, [active]);
}
