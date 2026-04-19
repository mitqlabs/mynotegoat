"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AppShell } from "@/components/app-shell";
import {
  buildWorkspaceIdForUser,
  CloudBootstrapError,
  ensureWorkspaceForUser,
  prepareCloudStateBeforeMount,
  wipeLocalWorkspaceForSignOut,
} from "@/lib/cloud-state";
import { forceSyncNow, installStorageSyncInterceptor, onSyncStatusChange, pauseSync, resumeSync } from "@/lib/storage-sync-interceptor";
import { installListenerLeakGuard } from "@/lib/listener-leak-guard";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { resolveAuthAccessState } from "@/lib/auth-access";
import type { PlanTier } from "@/lib/plan-access";
import { PlanTierProvider } from "@/lib/plan-context";

// Lazy-load with ssr:false so the module-level audio listeners in
// global-timer-alerts.tsx never execute during SSR.  The component is
// rendered only inside the `mounted` gate below, so it will never
// issue Supabase calls until auth bootstrap has fully completed.
const GlobalTimerAlerts = dynamic(
  () =>
    import("@/components/global-timer-alerts").then((m) => ({
      default: m.GlobalTimerAlerts,
    })),
  { ssr: false },
);
const DraftRecoveryBanner = dynamic(
  () =>
    import("@/components/draft-recovery-banner").then((m) => ({
      default: m.DraftRecoveryBanner,
    })),
  { ssr: false },
);
const OnboardingModal = dynamic(
  () =>
    import("@/components/onboarding-modal").then((m) => ({
      default: m.OnboardingModal,
    })),
  { ssr: false },
);

export default function PortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const router = useRouter();
  // Pull the router through a ref so the bootstrap effect can have
  // `[]` deps. Next.js's router object is already stable across
  // renders, but the sanity-check script can't know that — using the
  // ref keeps the lint/guard honest about "effects with listeners
  // must have stable deps."
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const [mounted, setMounted] = useState(false);
  const [planTier, setPlanTier] = useState<PlanTier>("complete");
  const [syncStatus, setSyncStatus] = useState<"synced" | "syncing" | "error">("synced");
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const [errorPillDismissed, setErrorPillDismissed] = useState(false);
  const [retryingSync, setRetryingSync] = useState(false);
  /** Set by the listener-leak guard when any event on window/document
   *  crosses its leak threshold. When set, we render a top-of-screen red
   *  banner telling the user to hard-refresh — a listener leak means the
   *  browser is about to start struggling and any in-flight draft work
   *  is at risk. */
  const [leakAlarm, setLeakAlarm] = useState<
    { target: string; type: string; count: number } | null
  >(null);
  // When syncStatus flips to "synced" we flash a green "Cloud Saved!" pill for
  // a few seconds so the user has positive confirmation that their work made
  // it to the cloud. The flash is driven by a setTimeout started inside the
  // sync-status callback (not an effect), because each successful sync should
  // re-arm the 2.5s window rather than let it expire mid-flash.
  const [showSavedFlash, setShowSavedFlash] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapErrorDetail, setBootstrapErrorDetail] = useState<string | null>(null);
  const [syncBlocked, setSyncBlocked] = useState<{ localSize: number; remoteSize: number } | null>(null);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const access = await resolveAuthAccessState();
      if (!active) {
        return;
      }

      if (access.state === "signed-out") {
        routerRef.current.replace("/auth/login");
        return;
      }

      if (access.state === "email-unverified") {
        routerRef.current.replace("/auth/login?verify=1");
        return;
      }

      if (access.state === "pending-approval") {
        routerRef.current.replace("/auth/pending");
        return;
      }

      if (access.state !== "access-granted" || !access.userId) {
        routerRef.current.replace("/auth/login");
        return;
      }

      if (access.isAdmin) {
        routerRef.current.replace("/admin");
        return;
      }

      if (access.planTier) {
        setPlanTier(access.planTier);
      }

      const workspaceId = buildWorkspaceIdForUser(access.userId);

      // CRITICAL: Before doing ANYTHING else, make sure localStorage belongs
      // to THIS user. If the previous workspace pointer doesn't match (or is
      // empty while data is still sitting around from a prior session), wipe
      // every casemate.* key. This prevents one account's data from being
      // shown to — or, worse, synced up to the cloud under — another account.
      ensureWorkspaceForUser(workspaceId);

      // Install the listener-leak guard FIRST, before any other code
      // can register window/document listeners. The guard intercepts
      // addEventListener/removeEventListener and fires a visible alarm
      // the moment any event type crosses its leak threshold. See
      // src/lib/listener-leak-guard.ts for the incident this prevents.
      installListenerLeakGuard();

      // Install interceptor paused so bootstrap writes don't trigger syncs
      pauseSync();
      installStorageSyncInterceptor();
      let savedFlashTimer: ReturnType<typeof setTimeout> | null = null;
      onSyncStatusChange((status, detail) => {
        if (!active) return;
        setSyncStatus(status);
        if (status === "error") {
          // Preserve the actual failure reason so the UI can show the user
          // something more useful than a generic "retrying" message. The
          // previous version gave no diagnostic clue at all — this made
          // legitimate bugs (RLS rejects, schema mismatches) indistinguishable
          // from transient network blips.
          setSyncErrorMessage(detail?.errorMessage ?? "Unknown error");
          // Reset the dismiss flag on EVERY new error so a fresh failure
          // re-shows the pill even if the user dismissed the previous one.
          setErrorPillDismissed(false);
          setShowSavedFlash(false);
          if (savedFlashTimer) {
            clearTimeout(savedFlashTimer);
            savedFlashTimer = null;
          }
        } else if (status === "synced") {
          // Clear any stale error message once we get a clean push through,
          // and flash the green confirmation for 2.5s. A rapid burst of
          // successful syncs re-arms the timer so the flash stays on screen
          // until the burst quiets down — this avoids a flickery toast when
          // several saves fire in quick succession (common during SOAP edits).
          setSyncErrorMessage(null);
          setShowSavedFlash(true);
          if (savedFlashTimer) {
            clearTimeout(savedFlashTimer);
          }
          savedFlashTimer = setTimeout(() => {
            if (active) setShowSavedFlash(false);
            savedFlashTimer = null;
          }, 2500);
        }
      });

      // Pull cloud data BEFORE mounting. We must not let hooks read stale
      // localStorage and trigger writes that would overwrite cloud data.
      // CRITICAL: if this fails, we DO NOT mount the app. The user sees a
      // hard error screen instead. Mounting on stale/empty localStorage is
      // exactly how the 2026-04-08 data loss happened.
      try {
        await prepareCloudStateBeforeMount();
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof CloudBootstrapError
            ? error.message
            : "Could not load your data from the cloud. Refusing to open the app to protect your records.";
        const detail =
          error instanceof Error
            ? `${error.name}: ${error.message}${error.cause instanceof Error ? ` — caused by: ${error.cause.message}` : ""}`
            : String(error);
        console.error("[Layout] Bootstrap error detail:", error);
        setBootstrapError(message);
        setBootstrapErrorDetail(detail);
        // Leave sync paused so nothing in this tab can push.
        return;
      }

      resumeSync();

      if (active) {
        setMounted(true);
      }
    }

    void bootstrap();

    // Listen for destructive-write blocks from the cloud sync layer.
    const onBlocked = (e: Event) => {
      const detail = (e as CustomEvent).detail as { localSize: number; remoteSize: number } | undefined;
      if (detail && active) {
        setSyncBlocked({ localSize: detail.localSize, remoteSize: detail.remoteSize });
      }
    };
    window.addEventListener("casemate:cloud-sync-blocked", onBlocked);

    // Listen for listener-leak alarms and surface a top-of-screen red
    // banner so the user knows to hard-refresh BEFORE the browser tab
    // starts to struggle. We only set state on the first alarm per page
    // life (the guard itself dedupes too, belt-and-suspenders).
    const onLeak = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { target: string; type: string; count: number }
        | undefined;
      if (detail && active) {
        setLeakAlarm(detail);
      }
    };
    window.addEventListener("casemate:listener-leak-detected", onLeak);

    // Stale-chunk auto-reload. After a deploy, the running tab's bundle
    // tries to lazy-load JS chunks whose hashed filenames no longer exist
    // on the server — Next.js raises "Failed to load chunk …". The fix
    // is always a hard refresh; we can do that for the user automatically.
    // Guard against infinite reload loops by debouncing through
    // sessionStorage: only one auto-reload per 30s window.
    const onWindowError = (event: ErrorEvent) => {
      const message = event.message ?? "";
      const isChunkLoad =
        message.includes("Failed to load chunk") ||
        message.includes("ChunkLoadError") ||
        message.includes("Loading chunk");
      if (!isChunkLoad) return;
      try {
        const lastReload = Number(sessionStorage.getItem("ng:chunk-reload-at") ?? "0");
        if (Date.now() - lastReload < 30_000) return;
        sessionStorage.setItem("ng:chunk-reload-at", String(Date.now()));
      } catch {
        // sessionStorage may be unavailable; just reload.
      }
      // Use replace so back button doesn't loop the user back to the
      // broken page. Pure JS-cache reload is enough — server already has
      // the new chunks.
      window.location.reload();
    };
    window.addEventListener("error", onWindowError);

    // Mid-session user switch guard. If the Supabase session changes underneath
    // us — sign-in as a different user, sign-out, token refresh that yields a
    // different user_id — the data already in memory belongs to the OLD user.
    // The only safe move is: pause sync, wipe every casemate.* + cache.v1.* key,
    // and hard-reload so the bootstrap reruns under the new identity. Without
    // this, an in-memory hook could push the previous user's patient list up
    // to the new user's cloud row.
    let lastSeenUserId: string | null = null;
    const supabase = getSupabaseBrowserClient();
    let authSubscription: { unsubscribe: () => void } | null = null;
    if (supabase) {
      void supabase.auth.getSession().then(({ data }) => {
        lastSeenUserId = data.session?.user?.id ?? null;
      });
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        const nextUserId = session?.user?.id ?? null;
        if (lastSeenUserId === null) {
          lastSeenUserId = nextUserId;
          return;
        }
        if (nextUserId !== lastSeenUserId) {
          // Identity changed under our feet. Stop syncing IMMEDIATELY so the
          // current tab cannot push the previous user's data anywhere, then
          // wipe and reload so bootstrap reruns clean.
          try {
            pauseSync();
          } catch {
            // ignore
          }
          try {
            wipeLocalWorkspaceForSignOut();
          } catch {
            // ignore
          }
          window.location.replace("/auth/login");
        }
      });
      authSubscription = sub.subscription;
    }

    return () => {
      active = false;
      window.removeEventListener("casemate:cloud-sync-blocked", onBlocked);
      window.removeEventListener("casemate:listener-leak-detected", onLeak);
      window.removeEventListener("error", onWindowError);
      if (authSubscription) {
        authSubscription.unsubscribe();
      }
    };
    // Deps are intentionally `[]` — router is accessed through
    // routerRef.current so re-runs on router-object identity changes
    // (which shouldn't happen in Next.js anyway) don't stack listeners.
  }, []);

  // (Auto-retry-on-focus was removed. The feature caused an event-listener
  //  leak — every syncStatus change re-ran the effect and stacked more
  //  listeners on window/document. That blew up Chrome's memory + pegged
  //  the CPU fan under normal editing. Retries now happen only inside
  //  withLockStealRetry at the op level, or via the user-initiated Retry
  //  button on the error pill. No listener-based side channels.)
  void syncStatus;

  if (bootstrapError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-6 lg:px-8">
        <div className="max-w-xl w-full rounded-2xl border border-red-500/40 bg-red-950/40 p-6 text-sm text-red-100 shadow-xl">
          <div className="text-base font-semibold text-red-50 mb-2">
            Cloud sync failed — app is locked for your protection
          </div>
          <p className="mb-3 leading-relaxed">{bootstrapError}</p>
          {bootstrapErrorDetail && (
            <p className="mb-3 rounded-lg bg-red-900/50 px-3 py-2 font-mono text-xs text-red-300 break-all">
              {bootstrapErrorDetail}
            </p>
          )}
          <p className="mb-4 leading-relaxed text-red-200/90">
            Your cloud data is safe. The app refuses to open until it can confirm it
            has the latest version, so a stale local copy can never overwrite the
            cloud.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-red-500 px-4 py-2 font-semibold text-white hover:bg-red-400"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                setBootstrapError(null);
                setBootstrapErrorDetail(null);
                setMounted(true);
              }}
              className="rounded-lg border border-amber-400/60 bg-amber-900/30 px-4 py-2 font-semibold text-amber-100 hover:bg-amber-900/50"
            >
              Open Anyway (Offline Mode)
            </button>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const supabase = getSupabaseBrowserClient();
                  if (supabase) await supabase.auth.signOut();
                  window.location.href = "/auth/login";
                })();
              }}
              className="rounded-lg border border-red-400/60 px-4 py-2 font-semibold text-red-100 hover:bg-red-900/40"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!mounted) {
    return (
      <div className="min-h-screen px-4 py-6 text-sm text-[var(--text-muted)] lg:px-8">
        Checking account access...
      </div>
    );
  }

  return (
    <PlanTierProvider planTier={planTier}>
      <AppShell planTier={planTier}>
        {/* Sync status indicator.
            Priority: error > syncing > saved-flash. An "error" state is
            sticky until a subsequent successful sync clears it — the
            interceptor flips us back to "synced" on the next successful
            push, which both drops the red pill and triggers the green
            flash so the user has unambiguous confirmation. */}
        <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex flex-col items-end gap-2">
          {syncStatus === "error" && !errorPillDismissed && (
            <div className="pointer-events-auto max-w-sm rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-lg">
              <div className="flex items-center justify-between gap-2">
                <span>
                  Cloud sync failed
                  {retryingSync ? " — trying again…" : ""}
                </span>
                <button
                  className="ml-2 rounded text-white/70 hover:text-white"
                  onClick={() => setErrorPillDismissed(true)}
                  title="Dismiss (your changes are still saved locally and will sync next time you edit)"
                  type="button"
                >
                  ×
                </button>
              </div>
              <div className="mt-1 text-[10px] font-normal text-red-100">
                Your work is safe in this browser — it just hasn&apos;t made it to
                the cloud yet. Click Retry to try again.
              </div>
              {syncErrorMessage && (
                <div className="mt-1 max-h-24 overflow-hidden break-all font-mono text-[10px] font-normal text-red-100/90">
                  {syncErrorMessage}
                </div>
              )}
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  className="rounded bg-white/15 px-2 py-1 text-[10px] font-semibold hover:bg-white/25 disabled:opacity-50"
                  disabled={retryingSync}
                  onClick={async () => {
                    setRetryingSync(true);
                    try {
                      await forceSyncNow();
                    } finally {
                      setRetryingSync(false);
                    }
                  }}
                  type="button"
                >
                  {retryingSync ? "Retrying…" : "Retry now"}
                </button>
              </div>
            </div>
          )}
          {syncStatus === "syncing" && (
            <div className="pointer-events-auto rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
              Saving to cloud...
            </div>
          )}
          {syncStatus === "synced" && showSavedFlash && (
            <div className="pointer-events-auto rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
              Cloud Saved ✓
            </div>
          )}
        </div>
        {syncBlocked && (
          <div className="fixed inset-x-0 top-0 z-[60] bg-red-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg">
            ⚠ Cloud sync blocked — this browser has less data than the cloud (
            {syncBlocked.localSize} vs {syncBlocked.remoteSize} bytes). Changes are
            NOT being saved. Reload to pull the latest data from the cloud.{" "}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ml-2 underline"
            >
              Reload now
            </button>
          </div>
        )}
        {leakAlarm && (
          <div className="fixed inset-x-0 top-0 z-[60] bg-red-700 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg">
            ⚠ Listener leak detected (&quot;{leakAlarm.type}&quot; on {leakAlarm.target}
            , {leakAlarm.count} handlers). This browser tab is about to start
            struggling — <strong>save your work and hard-refresh NOW</strong> (Ctrl+Shift+R
            / Cmd+Shift+R) before it freezes.{" "}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ml-2 underline"
            >
              Reload now
            </button>
          </div>
        )}
        <GlobalTimerAlerts />
        <DraftRecoveryBanner />
        <OnboardingModal />
        {children}
      </AppShell>
    </PlanTierProvider>
  );
}
