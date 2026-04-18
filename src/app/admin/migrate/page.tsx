"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  loadPatientBillingMap,
  savePatientBillingMap,
  createPatientBillingRecord,
} from "@/lib/patient-billing";
import {
  parseCasemateSql,
  getChiroPreviews,
  buildMigrationPayload,
  type CasemateData,
  type ChiroMigrationPreview,
  type ChiroMigrationPayload,
} from "@/lib/casemate-sql-parser";

interface AccountRow {
  user_id: string;
  email: string;
}

interface PreviewData {
  chiroId: number;
  payload: ChiroMigrationPayload;
  newCount: number;
  duplicateCount: number;
  duplicates: { full_name: string; date_of_loss: string }[];
  newContactCount: number;
  duplicateContactCount: number;
  existingCount: number;
  existingContactCount: number;
}

interface MigrationResult {
  chiroId: number;
  chiroName: string;
  targetEmail: string;
  patientsInserted: number;
  patientsSkipped: number;
  contactsInserted: number;
  contactsSkipped: number;
  errors: string[];
}

async function getAuthHeaders() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("No supabase client");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

export default function MigrateCasematePage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [parsedData, setParsedData] = useState<CasemateData | null>(null);
  const [previews, setPreviews] = useState<ChiroMigrationPreview[]>([]);
  const [mappings, setMappings] = useState<Record<number, string>>({});
  const [previewData, setPreviewData] = useState<Record<number, PreviewData>>(
    {}
  );
  const [loading, setLoading] = useState<number | null>(null);
  const [migrating, setMigrating] = useState<number | null>(null);
  const [results, setResults] = useState<MigrationResult[]>([]);
  const [parseError, setParseError] = useState("");
  const [fixingNames, setFixingNames] = useState(false);
  const [fixNamesResult, setFixNamesResult] = useState("");
  const [fixingBilled, setFixingBilled] = useState(false);
  const [fixBilledResult, setFixBilledResult] = useState("");
  const [fixingDates, setFixingDates] = useState(false);
  const [fixDatesResult, setFixDatesResult] = useState("");

  useEffect(() => {
    async function loadAccounts() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { data } = await supabase
        .from("account_profiles")
        .select("user_id, email")
        .eq("approval_status", "approved")
        .order("email");
      if (data) setAccounts(data);
    }
    void loadAccounts();
  }, []);

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setParseError("");
      setParsedData(null);
      setPreviews([]);
      setResults([]);
      setPreviewData({});

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const sql = e.target?.result as string;
          console.log("[migrate] SQL file length:", sql.length);
          console.log("[migrate] First 200 chars:", sql.substring(0, 200));
          console.log("[migrate] Contains CM_patient INSERT:", sql.includes("INSERT INTO `CM_patient` VALUES"));
          console.log("[migrate] Contains CM_chiro INSERT:", sql.includes("INSERT INTO `CM_chiro` VALUES"));
          const data = parseCasemateSql(sql);
          console.log("[migrate] Parsed:", {
            patients: data.patients.length,
            chiros: data.chiros.length,
            lawyers: data.lawyers.length,
            rolodex: data.rolodex.length,
          });
          setParsedData(data);
          const chiroList = getChiroPreviews(data);
          setPreviews(chiroList);

          const autoMap: Record<number, string> = {};
          chiroList.forEach((preview) => {
            const match = accounts.find(
              (a) =>
                a.email.toLowerCase() === preview.ownerEmail.toLowerCase()
            );
            if (match) {
              autoMap[preview.chiro.chiro_id] = match.user_id;
            }
          });
          setMappings(autoMap);
        } catch {
          setParseError(
            "Failed to parse SQL file. Make sure it is a valid MySQL dump."
          );
        }
      };
      reader.readAsText(file);
    },
    [accounts]
  );

  const handlePreview = useCallback(
    async (chiroId: number) => {
      if (!parsedData) return;
      const userId = mappings[chiroId];
      if (!userId) return;

      setLoading(chiroId);
      try {
        const payload = buildMigrationPayload(parsedData, chiroId);
        const workspaceId = `${userId}:main-office`;
        const headers = await getAuthHeaders();

        const res = await fetch("/api/admin/migrate-casemate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            workspaceId,
            patients: payload.patients,
            contacts: payload.contacts,
            mode: "preview",
          }),
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        setPreviewData((prev) => ({
          ...prev,
          [chiroId]: {
            chiroId,
            payload,
            newCount: data.newCount,
            duplicateCount: data.duplicateCount,
            duplicates: data.duplicates ?? [],
            newContactCount: data.newContactCount,
            duplicateContactCount: data.duplicateContactCount,
            existingCount: data.existingCount,
            existingContactCount: data.existingContactCount,
          },
        }));
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Preview failed");
      }
      setLoading(null);
    },
    [parsedData, mappings]
  );

  const handleMigrate = useCallback(
    async (chiroId: number) => {
      const preview = previewData[chiroId];
      if (!preview) return;
      const userId = mappings[chiroId];
      if (!userId) return;

      const chiroPreview = previews.find(
        (p) => p.chiro.chiro_id === chiroId
      );
      const account = accounts.find((a) => a.user_id === userId);
      if (!chiroPreview || !account) return;

      const workspaceId = `${userId}:main-office`;

      setMigrating(chiroId);
      try {
        const headers = await getAuthHeaders();

        const res = await fetch("/api/admin/migrate-casemate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            workspaceId,
            patients: preview.payload.patients,
            contacts: preview.payload.contacts,
            mode: "execute",
          }),
        });

        const result = await res.json();

        setResults((prev) => [
          ...prev,
          {
            chiroId,
            chiroName: chiroPreview.chiro.chiro_name,
            targetEmail: account.email,
            patientsInserted: result.patientsInserted ?? 0,
            patientsSkipped: result.patientsSkipped ?? 0,
            contactsInserted: result.contactsInserted ?? 0,
            contactsSkipped: result.contactsSkipped ?? 0,
            errors: result.errors ?? (result.error ? [result.error] : []),
          },
        ]);
      } catch (err) {
        setResults((prev) => [
          ...prev,
          {
            chiroId,
            chiroName: chiroPreview.chiro.chiro_name,
            targetEmail: account.email,
            patientsInserted: 0,
            patientsSkipped: 0,
            contactsInserted: 0,
            contactsSkipped: 0,
            errors: [err instanceof Error ? err.message : "Unknown error"],
          },
        ]);
      }
      setMigrating(null);
    },
    [previewData, mappings, previews, accounts]
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Migrate from Casemate</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Upload a MySQL dump from the old Casemate system to import patients
            and contacts into My Note Goat workspaces.
          </p>
        </div>
        <a
          href="/admin"
          className="rounded-lg border border-[var(--line-soft)] px-3 py-2 text-sm font-semibold hover:bg-[var(--bg-soft)]"
        >
          Back to Admin
        </a>
      </div>

      {/* Step 1: Upload SQL file */}
      <section className="rounded-2xl border border-[var(--line-soft)] bg-white p-5">
        <h3 className="text-lg font-semibold">Step 1: Upload SQL File</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Select the <code>casemate.sql</code> MySQL dump file.
        </p>
        <input
          type="file"
          accept=".sql"
          onChange={handleFileUpload}
          className="mt-3 block text-sm"
        />
        {parseError && (
          <p className="mt-2 text-sm font-semibold text-red-600">
            {parseError}
          </p>
        )}
        {parsedData && (
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">
              {parsedData.patients.length} patients
            </span>
            <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-800">
              {parsedData.chiros.length} offices
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">
              {parsedData.lawyers.length} attorneys
            </span>
            <span className="rounded-full bg-purple-100 px-3 py-1 font-semibold text-purple-800">
              {parsedData.rolodex.length} contacts
            </span>
          </div>
        )}
      </section>

      {/* Step 2: Map offices to accounts */}
      {previews.length > 0 && (
        <section className="mt-6 rounded-2xl border border-[var(--line-soft)] bg-white p-5">
          <h3 className="text-lg font-semibold">
            Step 2: Map Offices &amp; Preview
          </h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Select the target account for each office, then click Preview to see
            what will be imported vs skipped as a duplicate.
          </p>

          <div className="mt-4 space-y-4">
            {previews.map((preview) => {
              const chiroId = preview.chiro.chiro_id;
              const pd = previewData[chiroId];
              const result = results.find((r) => r.chiroId === chiroId);
              const isLoading = loading === chiroId;
              const isMigrating = migrating === chiroId;

              return (
                <div
                  key={chiroId}
                  className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-4"
                >
                  {/* Header */}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-[200px] flex-1">
                      <div className="font-semibold">
                        {preview.chiro.chiro_name}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {preview.chiro.chiro_city},{" "}
                        {preview.chiro.chiro_state} | Owner:{" "}
                        {preview.ownerEmail}
                      </div>
                      <div className="mt-1 flex gap-2 text-xs">
                        <span className="rounded bg-white px-2 py-0.5 font-semibold">
                          {preview.patientCount} patients in SQL
                        </span>
                        <span className="rounded bg-white px-2 py-0.5 font-semibold">
                          {preview.contactCount} contacts in SQL
                        </span>
                      </div>
                    </div>

                    <select
                      value={mappings[chiroId] ?? ""}
                      onChange={(e) =>
                        setMappings((prev) => ({
                          ...prev,
                          [chiroId]: e.target.value,
                        }))
                      }
                      className="rounded-lg border border-[var(--line-soft)] px-3 py-2 text-sm"
                    >
                      <option value="">-- Select account --</option>
                      {accounts.map((a) => (
                        <option key={a.user_id} value={a.user_id}>
                          {a.email}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => handlePreview(chiroId)}
                      disabled={!mappings[chiroId] || isLoading}
                      className="rounded-xl border border-[var(--brand-primary)] bg-white px-4 py-2 text-sm font-semibold text-[var(--brand-primary)] disabled:opacity-50"
                    >
                      {isLoading ? "Checking..." : "Preview"}
                    </button>
                  </div>

                  {/* Preview results */}
                  {pd && !result && (
                    <div className="mt-4 rounded-lg border border-[var(--line-soft)] bg-white p-4">
                      <div className="text-sm font-semibold">
                        Migration Preview
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                        Already in workspace: {pd.existingCount} patients,{" "}
                        {pd.existingContactCount} contacts
                      </div>

                      <div className="mt-3 flex flex-wrap gap-3 text-sm">
                        <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">
                          {pd.newCount} new patients to import
                        </span>
                        <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">
                          {pd.duplicateCount} duplicate patients (skipped)
                        </span>
                        <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">
                          {pd.newContactCount} new contacts
                        </span>
                        <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">
                          {pd.duplicateContactCount} duplicate contacts
                          (skipped)
                        </span>
                      </div>

                      {/* Duplicates list */}
                      {pd.duplicates.length > 0 && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-sm font-semibold text-amber-700">
                            Show {pd.duplicates.length} duplicate patients
                            (will be skipped)
                          </summary>
                          <div className="mt-2 max-h-[200px] overflow-y-auto rounded border border-amber-200 bg-amber-50 p-2 text-xs">
                            {pd.duplicates.map((d, i) => (
                              <div key={i} className="py-0.5">
                                {d.full_name}
                                {d.date_of_loss
                                  ? ` — DOI: ${d.date_of_loss}`
                                  : ""}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleMigrate(chiroId)}
                          disabled={
                            isMigrating ||
                            (pd.newCount === 0 && pd.newContactCount === 0)
                          }
                          className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {isMigrating
                            ? "Migrating..."
                            : pd.newCount === 0 && pd.newContactCount === 0
                              ? "Nothing new to import"
                              : `Import ${pd.newCount} patients + ${pd.newContactCount} contacts`}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewData((prev) => {
                              const next = { ...prev };
                              delete next[chiroId];
                              return next;
                            })
                          }
                          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Result */}
                  {result && (
                    <div className="mt-3">
                      {result.errors.length === 0 ? (
                        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                          Imported {result.patientsInserted} patients,{" "}
                          {result.contactsInserted} contacts to{" "}
                          {result.targetEmail}.
                          {result.patientsSkipped > 0 && (
                            <span>
                              {" "}
                              Skipped {result.patientsSkipped} duplicate
                              patients.
                            </span>
                          )}
                          {result.contactsSkipped > 0 && (
                            <span>
                              {" "}
                              Skipped {result.contactsSkipped} duplicate
                              contacts.
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                          {result.patientsInserted} patients,{" "}
                          {result.contactsInserted} contacts.
                          <br />
                          Errors: {result.errors.join("; ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Results summary */}
      {results.length > 0 && (
        <section className="mt-6 rounded-2xl border border-[var(--line-soft)] bg-white p-5">
          <h3 className="text-lg font-semibold">Migration Results</h3>
          <div className="mt-3 space-y-2">
            {results.map((r, i) => (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 text-sm ${
                  r.errors.length === 0
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-red-50 text-red-800"
                }`}
              >
                <span className="font-semibold">{r.chiroName}</span> &rarr;{" "}
                {r.targetEmail}: {r.patientsInserted} patients imported,{" "}
                {r.patientsSkipped} skipped | {r.contactsInserted} contacts
                imported, {r.contactsSkipped} skipped
                {r.errors.length > 0 && (
                  <span className="block text-xs">
                    {r.errors.join("; ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Fix imported names tool */}
      <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5">
        <h3 className="text-lg font-semibold text-amber-900">Fix Imported Patient Names</h3>
        <p className="mt-1 text-sm text-amber-800">
          Converts names from &quot;FirstName LastName&quot; format to &quot;LastName, FirstName&quot; format.
          Only affects patients whose name does NOT already contain a comma.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            className="rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            disabled={fixingNames}
            onClick={async () => {
              setFixingNames(true);
              setFixNamesResult("");
              try {
                const supabase = getSupabaseBrowserClient();
                if (!supabase) throw new Error("No supabase client");

                // Fetch all patients whose name doesn't contain a comma
                const { data: rows, error: fetchErr } = await supabase
                  .from("patients")
                  .select("id, full_name")
                  .not("full_name", "like", "%,%");

                if (fetchErr) throw fetchErr;
                if (!rows || rows.length === 0) {
                  setFixNamesResult("No patients need fixing — all names already contain a comma.");
                  return;
                }

                let fixedCount = 0;
                const errors: string[] = [];

                for (const row of rows) {
                  const name = (row.full_name || "").trim();
                  if (!name || name === "Unknown") continue;

                  // Split "FirstName LastName" -> "LastName, FirstName"
                  const parts = name.split(/\s+/);
                  let newName: string;
                  if (parts.length === 1) {
                    // Single word name — keep as-is
                    continue;
                  } else if (parts.length === 2) {
                    newName = `${parts[1]}, ${parts[0]}`;
                  } else {
                    // Multi-part: treat last word as last name, rest as first
                    const lastName = parts[parts.length - 1];
                    const firstName = parts.slice(0, -1).join(" ");
                    newName = `${lastName}, ${firstName}`;
                  }

                  const { error: updateErr } = await supabase
                    .from("patients")
                    .update({ full_name: newName })
                    .eq("id", row.id);

                  if (updateErr) {
                    errors.push(`${name}: ${updateErr.message}`);
                  } else {
                    fixedCount++;
                  }
                }

                const errMsg = errors.length > 0 ? ` | ${errors.length} errors: ${errors.slice(0, 3).join("; ")}` : "";
                setFixNamesResult(`Fixed ${fixedCount} of ${rows.length} patients.${errMsg} Refresh the app to see changes.`);
              } catch (err: unknown) {
                setFixNamesResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setFixingNames(false);
              }
            }}
            type="button"
          >
            {fixingNames ? "Fixing..." : "Fix All Names"}
          </button>
          {fixNamesResult && (
            <p className={`text-sm font-medium ${fixNamesResult.startsWith("Error") ? "text-red-700" : "text-emerald-700"}`}>
              {fixNamesResult}
            </p>
          )}
        </div>
      </section>

      {/* Fix billed amounts tool */}
      <section className="mt-6 rounded-2xl border border-blue-300 bg-blue-50 p-5">
        <h3 className="text-lg font-semibold text-blue-900">Fix Imported Billed Amounts</h3>
        <p className="mt-1 text-sm text-blue-800">
          Reads billed &amp; paid amounts from imported patient data (matrix) and syncs them
          into the billing system so they show up on the billing page and patient details.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            disabled={fixingBilled}
            onClick={async () => {
              setFixingBilled(true);
              setFixBilledResult("");
              try {
                const supabase = getSupabaseBrowserClient();
                if (!supabase) throw new Error("No supabase client");

                // Fetch all patients with their matrix data
                const { data: rows, error: fetchErr } = await supabase
                  .from("patients")
                  .select("id, matrix");

                if (fetchErr) throw fetchErr;
                if (!rows || rows.length === 0) {
                  setFixBilledResult("No patients found.");
                  return;
                }

                const billingMap = loadPatientBillingMap();
                let fixedCount = 0;

                for (const row of rows) {
                  const matrix = row.matrix as Record<string, string> | null;
                  if (!matrix) continue;

                  const rawBilled = (matrix.billed ?? "").replace(/[^0-9.]/g, "");
                  const rawPaid = (matrix.paidAmount ?? "").replace(/[^0-9.]/g, "");
                  const rawPaidDate = matrix.paidDate ?? "";
                  const billedNum = Number.parseFloat(rawBilled);
                  const paidNum = Number.parseFloat(rawPaid);

                  if (!Number.isFinite(billedNum) || billedNum <= 0) continue;

                  // Skip if billing record already exists with a nonzero billed amount
                  const existing = billingMap[row.id];
                  if (existing && existing.billedAmount > 0) continue;

                  const record = existing ?? createPatientBillingRecord(row.id);
                  record.billedAmount = billedNum;
                  if (Number.isFinite(paidNum) && paidNum > 0) {
                    record.paidAmount = paidNum;
                  }
                  if (rawPaidDate) {
                    record.paidDate = rawPaidDate;
                  }
                  record.updatedAt = new Date().toISOString();
                  billingMap[row.id] = record;
                  fixedCount++;
                }

                savePatientBillingMap(billingMap);
                setFixBilledResult(
                  fixedCount > 0
                    ? `Synced billing data for ${fixedCount} patients. Refresh the app to see changes.`
                    : "All patients already have billing records — nothing to fix."
                );
              } catch (err: unknown) {
                setFixBilledResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setFixingBilled(false);
              }
            }}
            type="button"
          >
            {fixingBilled ? "Fixing..." : "Fix Billed Amounts"}
          </button>
          {fixBilledResult && (
            <p className={`text-sm font-medium ${fixBilledResult.startsWith("Error") ? "text-red-700" : "text-emerald-700"}`}>
              {fixBilledResult}
            </p>
          )}
        </div>
      </section>

      {/* Fix imported dates tool */}
      <section className="mt-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
        <h3 className="text-lg font-semibold text-emerald-900">Fix Imported Dates</h3>
        <p className="mt-1 text-sm text-emerald-800">
          Converts all dates in patient data from ISO format (2024-03-30) to US format (03/30/2024).
          Fixes matrix fields (MRI, X-Ray, specialist, discharge, etc.), imaging referrals, specialist referrals, DOB, and date of injury.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            disabled={fixingDates}
            onClick={async () => {
              setFixingDates(true);
              setFixDatesResult("");
              try {
                const supabase = getSupabaseBrowserClient();
                if (!supabase) throw new Error("No supabase client");

                const isoToUs = (v: string): string => {
                  if (!v) return v;
                  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
                  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
                  return v;
                };

                const { data: rows, error: fetchErr } = await supabase
                  .from("patients")
                  .select("id, dob, date_of_loss, matrix, xray_referrals, mri_referrals, specialist_referrals");

                if (fetchErr) throw fetchErr;
                if (!rows || rows.length === 0) {
                  setFixDatesResult("No patients found.");
                  return;
                }

                const matrixDateKeys = [
                  "initialExam", "xraySent", "xrayDone", "xrayReceived", "xrayReviewed",
                  "mriSent", "mriScheduled", "mriDone", "mriReceived", "mriReviewed",
                  "reExam1", "reExam2", "reExam3",
                  "specialistSent", "specialistScheduled",
                  "discharge", "rbSent", "paidDate",
                ];

                const refDateKeys = [
                  "sentDate", "doneDate", "reportReceivedDate", "reportReviewedDate",
                  "scheduledDate", "completedDate",
                ];

                let fixedCount = 0;
                const errors: string[] = [];

                for (const row of rows) {
                  const patch: Record<string, unknown> = {};
                  let changed = false;

                  // Fix DOB
                  if (row.dob && /^\d{4}-\d{2}-\d{2}/.test(row.dob)) {
                    patch.dob = isoToUs(row.dob);
                    changed = true;
                  }

                  // Fix date_of_loss
                  if (row.date_of_loss && /^\d{4}-\d{2}-\d{2}/.test(row.date_of_loss)) {
                    patch.date_of_loss = isoToUs(row.date_of_loss);
                    changed = true;
                  }

                  // Fix matrix dates
                  const matrix = row.matrix as Record<string, string> | null;
                  if (matrix) {
                    const newMatrix = { ...matrix };
                    let matrixChanged = false;
                    for (const key of matrixDateKeys) {
                      const val = newMatrix[key];
                      if (val && /^\d{4}-\d{2}-\d{2}/.test(val)) {
                        newMatrix[key] = isoToUs(val);
                        matrixChanged = true;
                      }
                    }
                    if (matrixChanged) {
                      patch.matrix = newMatrix;
                      changed = true;
                    }
                  }

                  // Fix imaging referral dates
                  for (const refKey of ["xray_referrals", "mri_referrals"] as const) {
                    const refs = row[refKey] as Array<Record<string, string>> | null;
                    if (refs && Array.isArray(refs)) {
                      let refChanged = false;
                      const newRefs = refs.map((ref) => {
                        const newRef = { ...ref };
                        for (const dk of refDateKeys) {
                          if (newRef[dk] && /^\d{4}-\d{2}-\d{2}/.test(newRef[dk])) {
                            newRef[dk] = isoToUs(newRef[dk]);
                            refChanged = true;
                          }
                        }
                        return newRef;
                      });
                      if (refChanged) {
                        patch[refKey] = newRefs;
                        changed = true;
                      }
                    }
                  }

                  // Fix specialist referral dates
                  const specRefs = row.specialist_referrals as Array<Record<string, string>> | null;
                  if (specRefs && Array.isArray(specRefs)) {
                    let specChanged = false;
                    const newSpecs = specRefs.map((ref) => {
                      const newRef = { ...ref };
                      for (const dk of refDateKeys) {
                        if (newRef[dk] && /^\d{4}-\d{2}-\d{2}/.test(newRef[dk])) {
                          newRef[dk] = isoToUs(newRef[dk]);
                          specChanged = true;
                        }
                      }
                      return newRef;
                    });
                    if (specChanged) {
                      patch.specialist_referrals = newSpecs;
                      changed = true;
                    }
                  }

                  if (!changed) continue;

                  const { error: updateErr } = await supabase
                    .from("patients")
                    .update(patch)
                    .eq("id", row.id);

                  if (updateErr) {
                    errors.push(`${row.id}: ${updateErr.message}`);
                  } else {
                    fixedCount++;
                  }
                }

                const errMsg = errors.length > 0 ? ` | ${errors.length} errors: ${errors.slice(0, 3).join("; ")}` : "";
                setFixDatesResult(
                  fixedCount > 0
                    ? `Fixed dates for ${fixedCount} patients.${errMsg} Refresh the app to see changes.`
                    : "All dates already in US format — nothing to fix."
                );
              } catch (err: unknown) {
                setFixDatesResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setFixingDates(false);
              }
            }}
            type="button"
          >
            {fixingDates ? "Fixing..." : "Fix All Dates"}
          </button>
          {fixDatesResult && (
            <p className={`text-sm font-medium ${fixDatesResult.startsWith("Error") ? "text-red-700" : "text-emerald-700"}`}>
              {fixDatesResult}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
