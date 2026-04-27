"use client";

import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

/**
 * Render `<ScrollLock />` anywhere inside a modal's JSX (at the top
 * of the conditionally-rendered branch is cleanest) to lock the page
 * body's scroll for as long as the modal is mounted.
 *
 * Renders nothing visible — just a hook host. Lets us drop scroll
 * lock into the dozens of inline modals scattered through
 * patient-case-file / encounter-workspace / etc. without having to
 * refactor each into its own component.
 */
export function ScrollLock() {
  useBodyScrollLock(true);
  return null;
}
