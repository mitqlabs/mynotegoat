"use client";

import { useEffect, useRef, useState } from "react";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { parseAddressString } from "@/lib/address-parts";
import { ToggleSwitch } from "@/components/toggle-switch";
import { DebouncedInput } from "@/components/debounced-input";
import { composeLocationAddress, type OfficeDoctor, type OfficeLocation } from "@/lib/office-settings";
import {
  getDefaultScheduleSettings,
  loadScheduleSettings,
  weekdayLabels,
  type DailyOfficeHours,
} from "@/lib/schedule-settings";

function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

const partInputCls =
  "rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm min-w-0";

export function OfficeLocationsDoctorsSection() {
  const { officeSettings, updateOfficeSettings } = useOfficeSettings();
  const doctors = officeSettings.doctors ?? [];
  const locations = officeSettings.locations ?? [];

  const [newDoctor, setNewDoctor] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [openLocId, setOpenLocId] = useState<string | null>(null);
  const seededRef = useRef(false);

  // Locations are universal: there's always at least one office (this one).
  // Seed it once from the existing single-office info so a solo practice
  // just edits "Location #1" instead of a separate Office Information block.
  useEffect(() => {
    if (seededRef.current) return;
    if ((officeSettings.locations ?? []).length > 0) {
      seededRef.current = true;
      return;
    }
    seededRef.current = true;
    const p = parseAddressString(officeSettings.address ?? "");
    const first: OfficeLocation = {
      ...emptyLoc(officeSettings.officeName.trim() || "Main office"),
      addr1: p.address1,
      addr2: p.address2,
      city: p.city,
      state: p.state,
      zip: p.zip,
      phone: officeSettings.phone ?? "",
      fax: officeSettings.fax ?? "",
      email: officeSettings.email ?? "",
      officeHours: loadScheduleSettings().officeHours,
    };
    first.address = composeLocationAddress(first);
    updateOfficeSettings((cur) =>
      (cur.locations ?? []).length ? {} : { multiLocation: true, locations: [first] },
    );
    setOpenLocId(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // All array edits are FUNCTIONAL (read the latest state) so a debounced
  // commit from one field can never clobber another field's change.
  const setDoctors = (fn: (cur: OfficeDoctor[]) => OfficeDoctor[]) =>
    updateOfficeSettings((cur) => ({ doctors: fn(cur.doctors ?? []) }));
  const setLocations = (fn: (cur: OfficeLocation[]) => OfficeLocation[]) =>
    updateOfficeSettings((cur) => ({ locations: fn(cur.locations ?? []) }));

  const addDoctor = () => {
    const name = newDoctor.trim();
    if (!name) return;
    setDoctors((cur) => [...cur, { id: genId("doc"), name }]);
    setNewDoctor("");
  };

  const renameDoctor = (id: string, name: string) =>
    setDoctors((cur) => cur.map((d) => (d.id === id ? { ...d, name } : d)));

  const removeDoctor = (id: string) => {
    setDoctors((cur) => cur.filter((d) => d.id !== id));
    setLocations((cur) => cur.map((l) => ({ ...l, doctorIds: l.doctorIds.filter((x) => x !== id) })));
  };

  const emptyLoc = (nickname: string): OfficeLocation => ({
    id: genId("loc"),
    name: "",
    nickname,
    address: "",
    addr1: "",
    addr2: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
    fax: "",
    email: "",
    doctorIds: [],
  });

  const addLocation = () => {
    const name = newLocation.trim();
    if (!name) return;
    const loc = emptyLoc(name);
    setLocations((cur) => [...cur, loc]);
    setNewLocation("");
    setOpenLocId(loc.id);
  };

  // Patch a location. When address parts change, keep the composed `address`
  // string in sync (one-way — never parsed back, so nothing shuffles).
  const updateLocation = (id: string, patch: Partial<OfficeLocation>) =>
    setLocations((cur) =>
      cur.map((l) => {
        if (l.id !== id) return l;
        const merged = { ...l, ...patch };
        return { ...merged, address: composeLocationAddress(merged) };
      }),
    );

  const removeLocation = (id: string) => setLocations((cur) => cur.filter((l) => l.id !== id));

  const locHours = (loc: OfficeLocation): DailyOfficeHours[] =>
    loc.officeHours ?? getDefaultScheduleSettings().officeHours;

  const setLocHour = (locId: string, dayOfWeek: number, patch: Partial<DailyOfficeHours>) => {
    setLocations((cur) =>
      cur.map((l) => {
        if (l.id !== locId) return l;
        const base = l.officeHours ?? getDefaultScheduleSettings().officeHours;
        return {
          ...l,
          officeHours: base.map((h) => (h.dayOfWeek === dayOfWeek ? { ...h, ...patch } : h)),
        };
      }),
    );
  };

  const toggleLocationDoctor = (locId: string, docId: string, on: boolean) => {
    setLocations((cur) =>
      cur.map((l) => {
        if (l.id !== locId) return l;
        const set = new Set(l.doctorIds);
        if (on) set.add(docId);
        else set.delete(docId);
        return { ...l, doctorIds: [...set] };
      }),
    );
  };

  return (
    <div className="sm:col-span-2 grid gap-4">
      {/* ── Office Locations ────────────────────────────────────── */}
      <div className="order-1 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
        <div>
          <h5 className="text-sm font-semibold text-[var(--text-main)]">Office Locations</h5>
          <p className="text-xs text-[var(--text-muted)]">
            Each office has its own address, phone, doctors &amp; hours. Add a second office and the
            Schedule &amp; Patients let you switch between them.
          </p>
        </div>

        {(
          <div className="mt-3 grid gap-2">
            {locations.length === 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                No offices yet. Add your first below — each becomes its own collapsible office with
                its own doctors, and the Schedule &amp; Patients let you switch between them.
              </p>
            )}
            {locations.map((loc) => {
              const isOpen = openLocId === loc.id;
              const assignedCount = loc.doctorIds.length;
              return (
                <div key={loc.id} className="overflow-hidden rounded-lg border border-[var(--line-soft)] bg-white">
                  <button
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                    onClick={() => setOpenLocId(isOpen ? null : loc.id)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {loc.nickname?.trim() || loc.name?.trim() || "Untitled office"}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {assignedCount} doctor{assignedCount === 1 ? "" : "s"}
                        {loc.address ? ` · ${loc.address}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[var(--text-muted)]">{isOpen ? "▾" : "▸"}</span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-[var(--line-soft)] p-2.5">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="grid gap-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Nickname
                          </span>
                          <DebouncedInput
                            className={partInputCls}
                            onCommit={(v) => updateLocation(loc.id, { nickname: v })}
                            placeholder="e.g. Hulen"
                            value={loc.nickname}
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Phone
                          </span>
                          <DebouncedInput
                            className={partInputCls}
                            inputMode="numeric"
                            maxLength={12}
                            onCommit={(v) => updateLocation(loc.id, { phone: v })}
                            placeholder="(555) 555-5555"
                            transform={formatUsPhoneInput}
                            value={loc.phone}
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Fax
                          </span>
                          <DebouncedInput
                            className={partInputCls}
                            inputMode="numeric"
                            maxLength={12}
                            onCommit={(v) => updateLocation(loc.id, { fax: v })}
                            placeholder="(555) 555-5555"
                            transform={formatUsPhoneInput}
                            value={loc.fax}
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Email
                          </span>
                          <DebouncedInput
                            className={partInputCls}
                            onCommit={(v) => updateLocation(loc.id, { email: v })}
                            placeholder="office@practice.com"
                            value={loc.email}
                          />
                        </label>

                        {/* Structured address — all five on one line. */}
                        <div className="grid gap-2 sm:col-span-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_52px_84px]">
                          <label className="grid gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                              Street
                            </span>
                            <DebouncedInput
                              className={partInputCls}
                              onCommit={(v) => updateLocation(loc.id, { addr1: v })}
                              placeholder="123 Fake St."
                              value={loc.addr1}
                            />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                              Suite
                            </span>
                            <DebouncedInput
                              className={partInputCls}
                              onCommit={(v) => updateLocation(loc.id, { addr2: v })}
                              placeholder="Suite"
                              value={loc.addr2}
                            />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                              City
                            </span>
                            <DebouncedInput
                              className={partInputCls}
                              onCommit={(v) => updateLocation(loc.id, { city: v })}
                              placeholder="City"
                              value={loc.city}
                            />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                              State
                            </span>
                            <DebouncedInput
                              className={`${partInputCls} uppercase`}
                              maxLength={2}
                              onCommit={(v) => updateLocation(loc.id, { state: v })}
                              placeholder="TX"
                              transform={(v) => v.replace(/[^A-Za-z]/g, "").toUpperCase()}
                              value={loc.state}
                            />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                              ZIP
                            </span>
                            <DebouncedInput
                              className={partInputCls}
                              inputMode="numeric"
                              maxLength={10}
                              onCommit={(v) => updateLocation(loc.id, { zip: v })}
                              placeholder="76133"
                              transform={(v) => v.replace(/[^\d-]/g, "")}
                              value={loc.zip}
                            />
                          </label>
                        </div>
                      </div>

                      <div className="mt-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                          Doctors at this office
                        </p>
                        {doctors.length === 0 ? (
                          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                            Add doctors below, then tap to assign them here.
                          </p>
                        ) : (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {doctors.map((doc) => {
                              const on = loc.doctorIds.includes(doc.id);
                              return (
                                <button
                                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-all active:scale-95 ${
                                    on
                                      ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                                      : "border-[var(--line-soft)] bg-white text-[var(--text-muted)]"
                                  }`}
                                  key={doc.id}
                                  onClick={() => toggleLocationDoctor(loc.id, doc.id, !on)}
                                  type="button"
                                >
                                  {doc.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="mt-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                          Office hours
                        </p>
                        <div className="mt-1 grid gap-1">
                          {locHours(loc).map((h) => (
                            <div key={h.dayOfWeek} className="flex items-center gap-2">
                              <span className="w-9 shrink-0 text-[11px] font-semibold text-[var(--text-muted)]">
                                {weekdayLabels[h.dayOfWeek].slice(0, 3)}
                              </span>
                              <ToggleSwitch
                                checked={h.enabled}
                                onChange={(on) => setLocHour(loc.id, h.dayOfWeek, { enabled: on })}
                                ariaLabel={`${weekdayLabels[h.dayOfWeek]} open`}
                              />
                              {h.enabled ? (
                                <>
                                  <input
                                    className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                                    onChange={(e) => setLocHour(loc.id, h.dayOfWeek, { start: e.target.value })}
                                    type="time"
                                    value={h.start}
                                  />
                                  <span className="text-xs text-[var(--text-muted)]">–</span>
                                  <input
                                    className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                                    onChange={(e) => setLocHour(loc.id, h.dayOfWeek, { end: e.target.value })}
                                    type="time"
                                    value={h.end}
                                  />
                                </>
                              ) : (
                                <span className="text-xs text-[var(--text-muted)]">Closed</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-2 flex justify-end">
                        <button
                          className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                          onClick={() => {
                            const label = loc.nickname?.trim() || loc.name?.trim() || "this office";
                            if (window.confirm(`Remove ${label}? This can't be undone.`)) {
                              removeLocation(loc.id);
                            }
                          }}
                          type="button"
                        >
                          Remove office
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                onChange={(e) => setNewLocation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLocation();
                  }
                }}
                placeholder="New office nickname (e.g. Saginaw)"
                value={newLocation}
              />
              <button
                className="shrink-0 rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                disabled={!newLocation.trim()}
                onClick={addLocation}
                type="button"
              >
                + Office
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Doctors ─────────────────────────────────────────────── */}
      <div className="order-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
        <div>
          <h5 className="text-sm font-semibold text-[var(--text-main)]">Doctors</h5>
          <p className="text-xs text-[var(--text-muted)]">
            Providers you schedule under. Add a name here, or mark a team member as a Doctor in
            Settings → Team.
          </p>
        </div>

        <div className="mt-3 grid gap-2">
          {doctors.length === 0 && <p className="text-xs text-[var(--text-muted)]">No doctors yet.</p>}
          {doctors.map((doc) => {
            const isMember = Boolean(doc.memberUserId);
            return (
              <div
                key={doc.id}
                className="flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5"
              >
                {isMember ? (
                  <input
                    className="min-w-0 flex-1 rounded-md border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-1 text-sm text-[var(--text-muted)]"
                    disabled
                    value={doc.name}
                  />
                ) : (
                  <DebouncedInput
                    className="min-w-0 flex-1 rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                    onCommit={(v) => renameDoctor(doc.id, v)}
                    value={doc.name}
                  />
                )}
                {isMember ? (
                  <span
                    className="shrink-0 rounded-full bg-[rgba(13,121,191,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[#0d79bf]"
                    title="This doctor is a team member. Manage them in Settings → Team."
                  >
                    Team member
                  </span>
                ) : (
                  <button
                    className="shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                    onClick={() => removeDoctor(doc.id)}
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
            onChange={(e) => setNewDoctor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDoctor();
              }
            }}
            placeholder="Dr. Last, First"
            value={newDoctor}
          />
          <button
            className="shrink-0 rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            disabled={!newDoctor.trim()}
            onClick={addDoctor}
            type="button"
          >
            + Doctor
          </button>
        </div>
      </div>
    </div>
  );
}
