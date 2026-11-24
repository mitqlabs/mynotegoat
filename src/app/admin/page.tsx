"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { ApprovalStatus } from "@/lib/auth-access";

interface AccountRow {
  user_id: string;
  email: string;
  approval_status: ApprovalStatus;
  plan_tier: string | null;
  is_admin: boolean;
  created_at: string;
  approved_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_status: string | null;
}

const subscriptionStatusColors: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  trialing: "bg-blue-100 text-blue-800",
  past_due: "bg-amber-100 text-amber-800",
  canceled: "bg-red-100 text-red-800",
  unpaid: "bg-red-100 text-red-800",
  incomplete: "bg-gray-200 text-gray-700",
};

type StatusFilter = "all" | ApprovalStatus;

const statusColors: Record<ApprovalStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  suspended: "bg-gray-200 text-gray-700",
};

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    setError("");

    const { data, error: fetchError } = await supabase
      .from("account_profiles")
      .select("user_id, email, approval_status, plan_tier, is_admin, created_at, approved_at, stripe_customer_id, stripe_subscription_status")
      .order("created_at", { ascending: false });

    setLoading(false);

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setAccounts((data ?? []) as AccountRow[]);
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const updateAccountStatus = async (
    userId: string,
    status: ApprovalStatus,
  ) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setActionLoading(userId);

    const updatePayload: Record<string, unknown> = {
      approval_status: status,
    };

    if (status === "approved") {
      updatePayload.approved_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from("account_profiles")
      .update(updatePayload)
      .eq("user_id", userId);

    setActionLoading(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setAccounts((current) =>
      current.map((account) =>
        account.user_id === userId
          ? {
              ...account,
              approval_status: status,
              approved_at:
                status === "approved"
                  ? new Date().toISOString()
                  : account.approved_at,
            }
          : account,
      ),
    );
  };

  const updatePlanTier = async (userId: string, tier: string) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setActionLoading(userId);

    const { error: updateError } = await supabase
      .from("account_profiles")
      .update({ plan_tier: tier })
      .eq("user_id", userId);

    setActionLoading(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setAccounts((current) =>
      current.map((account) =>
        account.user_id === userId
          ? { ...account, plan_tier: tier }
          : account,
      ),
    );
  };

  const filteredAccounts =
    statusFilter === "all"
      ? accounts
      : accounts.filter(
          (account) => account.approval_status === statusFilter,
        );

  const pendingCount = accounts.filter(
    (a) => a.approval_status === "pending",
  ).length;

  return (
    <div className="space-y-5">
      <section className="panel-card p-4">
        <h2 className="text-xl font-semibold">Account Management</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Approve, reject, or suspend user accounts. Assign plan tiers.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        <div className="panel-card p-4 text-center">
          <div className="text-2xl font-bold text-[var(--text-main)]">
            {accounts.length}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Total
          </div>
        </div>
        <div className="panel-card p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">
            {pendingCount}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Pending
          </div>
        </div>
        <div className="panel-card p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">
            {accounts.filter((a) => a.approval_status === "approved").length}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Approved
          </div>
        </div>
        <div className="panel-card p-4 text-center">
          <div className="text-2xl font-bold text-red-600">
            {
              accounts.filter(
                (a) =>
                  a.approval_status === "rejected" ||
                  a.approval_status === "suspended",
              ).length
            }
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Rejected / Suspended
          </div>
        </div>
      </section>

      <section className="panel-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(
              ["all", "pending", "approved", "rejected", "suspended"] as const
            ).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  statusFilter === filter
                    ? "bg-[var(--brand-primary)] text-white"
                    : "bg-[var(--bg-soft)] text-[var(--text-main)] hover:bg-[var(--bg-soft)]/80"
                }`}
              >
                {filter === "all"
                  ? "All"
                  : filter.charAt(0).toUpperCase() + filter.slice(1)}
                {filter === "pending" && pendingCount > 0
                  ? ` (${pendingCount})`
                  : ""}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void loadAccounts()}
            disabled={loading}
            className="btn btn-secondary disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && accounts.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            Loading accounts...
          </p>
        ) : filteredAccounts.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            No accounts match this filter.
          </p>
        ) : (
          <div className="space-y-3">
            {filteredAccounts.map((account) => (
              <div
                key={account.user_id}
                className="rounded-2xl border border-[var(--line-soft)] bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--text-main)]">
                        {account.email}
                      </span>
                      {account.is_admin && (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                          Admin
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          statusColors[account.approval_status]
                        }`}
                      >
                        {account.approval_status}
                      </span>
                      {account.stripe_subscription_status && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            subscriptionStatusColors[account.stripe_subscription_status] ??
                            "bg-gray-200 text-gray-700"
                          }`}
                        >
                          Stripe: {account.stripe_subscription_status}
                        </span>
                      )}
                      {!account.stripe_customer_id && !account.is_admin && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                          No payment
                        </span>
                      )}
                      <span>
                        Signed up{" "}
                        {new Date(account.created_at).toLocaleDateString()}
                      </span>
                      {account.approved_at && (
                        <span>
                          Approved{" "}
                          {new Date(account.approved_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {!account.is_admin && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                        value={account.plan_tier ?? "complete"}
                        onChange={(e) =>
                          void updatePlanTier(account.user_id, e.target.value)
                        }
                        disabled={actionLoading === account.user_id}
                      >
                        <option value="tracking">Tracking</option>
                        <option value="track_schedule">
                          Track + Schedule
                        </option>
                        <option value="complete">Complete</option>
                      </select>

                      {account.approval_status !== "approved" && (
                        <button
                          type="button"
                          onClick={() =>
                            void updateAccountStatus(
                              account.user_id,
                              "approved",
                            )
                          }
                          disabled={actionLoading === account.user_id}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                      )}

                      {account.approval_status !== "rejected" && (
                        <button
                          type="button"
                          onClick={() =>
                            void updateAccountStatus(
                              account.user_id,
                              "rejected",
                            )
                          }
                          disabled={actionLoading === account.user_id}
                          className="btn btn-danger btn-sm disabled:opacity-50"
                        >
                          Reject
                        </button>
                      )}

                      {account.approval_status === "approved" && (
                        <button
                          type="button"
                          onClick={() =>
                            void updateAccountStatus(
                              account.user_id,
                              "suspended",
                            )
                          }
                          disabled={actionLoading === account.user_id}
                          className="btn btn-secondary btn-sm disabled:opacity-50"
                        >
                          Suspend
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
