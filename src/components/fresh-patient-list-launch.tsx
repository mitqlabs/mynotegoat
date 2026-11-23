"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePlanTier } from "@/lib/plan-context";
import {
  consumeAppLaunch,
  readFreshAppLaunch,
  readSidebarOrderFromStorage,
  shouldRedirectFreshPatientList,
  sidebarLandingHref,
} from "@/lib/sidebar-order";
import { syncUserPrefs } from "@/lib/user-prefs-cloud";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

/**
 * A new tab (bookmark, Dock, restored window) that opened on the default
 * Patient List follows the first sidebar page once prefs are in. The portal
 * layout keeps the check-in screen up until this replaces the URL, so the
 * list does not flash. In-app clicks never mount this.
 */
export function FreshPatientListLaunch({ onStay }: { onStay: () => void }) {
  const router = useRouter();
  const planTier = usePlanTier();
  const { canView } = useWorkspaceAccess();
  const planRef = useRef(planTier);
  const canViewRef = useRef(canView);
  const onStayRef = useRef(onStay);
  const decided = useRef(false);

  useEffect(() => {
    planRef.current = planTier;
    canViewRef.current = canView;
    onStayRef.current = onStay;
  });

  useEffect(() => {
    if (decided.current) return;
    let cancelled = false;
    void (async () => {
      try {
        await syncUserPrefs();
      } catch (err) {
        console.warn("[home] could not load the sidebar order:", err);
      }
      if (cancelled || decided.current) return;
      decided.current = true;
      const href = sidebarLandingHref(planRef.current, canViewRef.current, readSidebarOrderFromStorage());
      const fresh = readFreshAppLaunch();
      consumeAppLaunch();
      if (
        shouldRedirectFreshPatientList({
          freshLaunch: fresh,
          pathname: window.location.pathname,
          search: window.location.search,
          landingHref: href,
        })
      ) {
        router.replace(href);
        return;
      }
      onStayRef.current();
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
