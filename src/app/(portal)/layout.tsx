"use client";

import { SaveBadge } from "@/components/save-badge";
import { flushSaveQueue } from "@/lib/save-queue";
import { confirmNotesInCloud, subscribeUnsyncedNotes } from "@/lib/encounter-notes";
import { hydrateBigCache, installBigCacheShim } from "@/lib/big-cache";
import { cleanupPlusModeOnce } from "@/lib/goat-plus-cleanup";
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
import {
  resolveWorkspaceMembership,
  type WorkspaceMembership,
} from "@/lib/workspace-membership";
import { WorkspaceAccessProvider } from "@/lib/workspace-access-context";
import { RouteAccessGuard } from "@/components/route-access-guard";
import { safeNextPath } from "@/lib/goat-app";

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
const GlobalKvRealtime = dynamic(
  () =>
    import("@/components/global-kv-realtime").then((m) => ({
      default: m.GlobalKvRealtime,
    })),
  { ssr: false },
);
const GlobalRecordRealtime = dynamic(
  () =>
    import("@/components/global-record-realtime").then((m) => ({
      default: m.GlobalRecordRealtime,
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
  const [unsyncedNotes, setUnsyncedNotes] = useState(0);
  useEffect(() => subscribeUnsyncedNotes(setUnsyncedNotes), []);
  // + mode was removed: free the space its model took in this browser (once, silently, on idle).
  useEffect(() => {
    const t = window.setTimeout(() => void cleanupPlusModeOnce().catch(() => undefined), 5000);
    return () => window.clearTimeout(t);
  }, []);
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
  // Set when someone chooses "Open Anyway". Staff were clicking through it
  // and carrying on for hours without telling anyone, so it stays on screen
  // for the life of the tab — it can't be dismissed.
  const [offlineMode, setOfflineMode] = useState(false);
  const [membership, setMembership] = useState<WorkspaceMembership | null>(null);
  const [syncBlocked, setSyncBlocked] = useState<{ localSize: number; remoteSize: number } | null>(null);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      // Speed: look up team membership at the same time as the access check
      // instead of after it. Its result is only USED once access is granted,
      // so nothing protected is shown any earlier.
      const supabaseForSession = getSupabaseBrowserClient();
      const membershipEarly: Promise<WorkspaceMembership | null> = supabaseForSession
        ? supabaseForSession.auth
            .getSession()
            .then(({ data }) => (data.session?.user?.id ? resolveWorkspaceMembership(data.session.user.id) : null))
            .catch(() => null)
        : Promise.resolve(null);
      const access = await resolveAuthAccessState();
      if (!active) {
        return;
      }

      if (access.state === "signed-out") {
        // From the G.O.A.T. home-screen app: come back to it after login (iOS standalone keeps its own session).
        const next = safeNextPath(`${window.location.pathname}${window.location.search}`);
        routerRef.current.replace(next ? `/auth/login?next=${encodeURIComponent(next)}` : "/auth/login");
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

      // Team members work INSIDE their owner's workspace, not their own. Resolve
      // membership first so we point localStorage + cloud at the owner's data.
      const early = await membershipEarly;
      const resolvedMembership =
        early && early.userId === access.userId ? early : await resolveWorkspaceMembership(access.userId);
      if (!active) return;

      // A member the owner has deactivated may no longer use the app. Sign
      // them out and bounce to a notice — never mount their owner's data.
      if (resolvedMembership.isMember && resolvedMembership.disabled) {
        const supabase = getSupabaseBrowserClient();
        if (supabase) await supabase.auth.signOut();
        routerRef.current.replace("/auth/login?disabled=1");
        return;
      }

      setMembership(resolvedMembership);

      const workspaceId = buildWorkspaceIdForUser(resolvedMembership.ownerId);

      // CRITICAL: Before doing ANYTHING else, make sure localStorage belongs
      // to THIS user. If the previous workspace pointer doesn't match (or is
      // empty while data is still sitting around from a prior session), wipe
      // every casemate.* key. This prevents one account's data from being
      // shown to — or, worse, synced up to the cloud under — another account.
      ensureWorkspaceForUser(workspaceId);

      // Notes and appointments are cached in IndexedDB (localStorage is too small
      // for big offices). Load them, migrating the old localStorage copy once,
      // BEFORE anything reads them. Never throws; falls back to localStorage.
      installBigCacheShim();
      await hydrateBigCache(workspaceId);
      if (!active) return;

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
        // Hard deadline: never sit on "Checking account access…" forever.
        // Past 45s show the locked error screen with Retry instead.
        let deadline: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            prepareCloudStateBeforeMount(),
            new Promise<never>((_, reject) => {
              deadline = setTimeout(
                () => reject(new CloudBootstrapError("Loading your data from the cloud took too long. Check your connection and tap Retry.")),
                45_000,
              );
            }),
          ]);
        } finally {
          if (deadline) clearTimeout(deadline);
        }
        // Bring back this user's prefs (sorts, columns, chat…) from the cloud.
        void import("@/lib/user-prefs-cloud").then((m) =>
          m.syncUserPrefs().catch((err: unknown) => console.warn("[user-prefs] restore failed:", err)),
        );
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof CloudBootstrapError
            ? error.message
            : "Could not load your data from the cloud. Refusing to open the app to protect your records.";
        // A Supabase/PostgREST failure arrives as a plain object, not an
        // Error, so the old `cause instanceof Error` check printed nothing
        // and the screen showed only the generic wrapper — useless for
        // working out what actually broke on someone else's machine.
        const describeCause = (cause: unknown): string => {
          if (!cause) return "";
          if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
          if (typeof cause === "object") {
            const c = cause as Record<string, unknown>;
            const parts = ["message", "code", "details", "hint", "status"]
              .map((key) => (c[key] ? `${key}=${String(c[key])}` : ""))
              .filter(Boolean);
            return parts.length ? parts.join(" · ") : JSON.stringify(cause).slice(0, 400);
          }
          return String(cause);
        };
        const causeText = error instanceof Error ? describeCause(error.cause) : "";
        const detail =
          error instanceof Error
            ? `${error.name}: ${error.message}${causeText ? ` — caused by: ${causeText}` : ""}`
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
            {bootstrapErrorDetail && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(`${bootstrapError ?? ""}\n${bootstrapErrorDetail}`)
                    .catch((copyErr) => {
                      // Clipboard can be blocked; the text is on screen
                      // either way, so just say so in the console.
                      console.warn("[Layout] Could not copy error details:", copyErr);
                    });
                }}
                className="rounded-lg border border-red-400/60 px-4 py-2 font-semibold text-red-100 hover:bg-red-900/40"
              >
                Copy error details
              </button>
            )}
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
                console.warn("[Layout] Opening in offline mode after a bootstrap failure.");
                setBootstrapError(null);
                setBootstrapErrorDetail(null);
                setOfflineMode(true);
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
      <WorkspaceAccessProvider membership={membership}>
      <RouteAccessGuard />
      <AppShell planTier={planTier}>
        {/* Sync status indicator.
            Priority: error > syncing > saved-flash. An "error" state is
            sticky until a subsequent successful sync clears it — the
            interceptor flips us back to "synced" on the next successful
            push, which both drops the red pill and triggers the green
            flash so the user has unambiguous confirmation. */}
        <SaveBadge
          errorDismissed={errorPillDismissed}
          errorMessage={syncErrorMessage}
          onDismissError={() => setErrorPillDismissed(true)}
          onRetry={async () => {
            setRetryingSync(true);
            try {
              await Promise.allSettled([forceSyncNow(), flushSaveQueue(), confirmNotesInCloud()]);
            } finally {
              setRetryingSync(false);
            }
          }}
          retrying={retryingSync}
          savedFlash={showSavedFlash}
          status={syncStatus}
          unsyncedNotes={unsyncedNotes}
        />
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
        {offlineMode && (
          <div className="fixed inset-x-0 top-0 z-[60] bg-amber-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg">
            ⚠ Offline Mode — this tab opened without confirming it had the latest data.
            Notes, appointments and patient changes still save to the cloud, but{" "}
            <strong>reload as soon as you can</strong> and tell whoever runs the office.{" "}
            <button
              className="ml-1 rounded bg-white/20 px-2 py-0.5 font-semibold hover:bg-white/30"
              onClick={() => window.location.reload()}
              type="button"
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
        {/* Onboarding is the OWNER's one-time office setup. A team member
            logs into an already-configured office — never show it to them. */}
        {!membership?.isMember && <OnboardingModal />}
        {/* Realtime listeners — propagate cross-device changes from
            Supabase to local React hooks within seconds. KV one
            covers every workspace_kv-backed entity (cash payments,
            settings, macros, templates, overrides, etc). Record one
            covers patients (encounters and appointments have their
            own per-hook realtime listeners). */}
        <GlobalKvRealtime />
        <GlobalRecordRealtime />
        {children}
      </AppShell>
      </WorkspaceAccessProvider>
    </PlanTierProvider>
  );
}
