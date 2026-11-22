"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePlanTier } from "@/lib/plan-context";
import { readSidebarOrderFromStorage, sidebarLandingHref } from "@/lib/sidebar-order";
import { syncUserPrefs } from "@/lib/user-prefs-cloud";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

/**
 * Opening the app (the root, or the page after sign-in) lands on the first
 * page in this person's sidebar. The portal layout keeps the check-in
 * screen up until this replace runs, so the wrong page never flashes.
 *
 * The order has to be the server copy. The sidebar hook's first value is
 * the server snapshot, which is always null, and a redirect effect runs
 * in that same pass — so it used to treat "not read yet" as "no saved
 * order" and replace "/" with Patient List before the real order applied.
 * Sync from the cloud first, then read the key that sync just wrote.
 */
export default function PortalHomePage() {
  const router = useRouter();
  const planTier = usePlanTier();
  const { canView } = useWorkspaceAccess();
  const planRef = useRef(planTier);
  const canViewRef = useRef(canView);
  planRef.current = planTier;
  canViewRef.current = canView;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await syncUserPrefs();
      } catch (err) {
        console.warn("[home] could not load the sidebar order:", err);
      }
      if (cancelled) return;
      const href = sidebarLandingHref(planRef.current, canViewRef.current, readSidebarOrderFromStorage());
      if (href && href !== "/") router.replace(href);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
