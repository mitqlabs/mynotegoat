"use client";

import { useState } from "react";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { ToggleSwitch } from "@/components/toggle-switch";
import { AddressFieldGroup } from "@/components/address-field-group";
import { locationLabel, type OfficeDoctor, type OfficeLocation } from "@/lib/office-settings";
import {
  getDefaultScheduleSettings,
  loadScheduleSettings,
  weekdayLabels,
  type DailyOfficeHours,
} from "@/lib/schedule-settings";

function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function OfficeLocationsDoctorsSection() {
  const { officeSettings, updateOfficeSettings } = useOfficeSettings();
  const doctors = officeSettings.doctors ?? [];
  const locations = officeSettings.locations ?? [];

  const [newDoctor, setNewDoctor] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [openLocId, setOpenLocId] = useState<string | null>(null);

  const setDoctors = (next: OfficeDoctor[]) => updateOfficeSettings({ doctors: next });
  const setLocations = (next: OfficeLocation[]) => updateOfficeSettings({ locations: next });

  const addDoctor = () => {
    const name = newDoctor.trim();
    if (!name) return;
    setDoctors([...doctors, { id: genId("doc"), name }]);
    setNewDoctor("");
  };

  const renameDoctor = (id: string, name: string) =>
    setDoctors(doctors.map((d) => (d.id === id ? { ...d, name } : d)));

  const removeDoctor = (id: string) => {
    setDoctors(doctors.filter((d) => d.id !== id));
    // Also drop the doctor from any location assignment.
    setLocations(locations.map((l) => ({ ...l, doctorIds: l.doctorIds.filter((x) => x !== id) })));
  };

  const addLocation = () => {
    const name = newLocation.trim();
    if (!name) return;
    const id = genId("loc");
    setLocations([
      ...locations,
      { id, name: "", nickname: name, address: "", phone: "", fax: "", email: "", doctorIds: [] },
    ]);
    setNewLocation("");
    setOpenLocId(id);
  };

  const updateLocation = (id: string, patch: Partial<OfficeLocation>) =>
    setLocations(locations.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLocation = (id: string) => setLocations(locations.filter((l) => l.id !== id));

  const locHours = (loc: OfficeLocation): DailyOfficeHours[] =>
    loc.officeHours ?? getDefaultScheduleSettings().officeHours;

  const setLocHour = (locId: string, dayOfWeek: number, patch: Partial<DailyOfficeHours>) => {
    setLocations(
      locations.map((l) => {
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
    setLocations(
      locations.map((l) => {
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
      {/* ── Doctors ─────────────────────────────────────────────── */}
      <div className="order-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h5 className="text-sm font-semibold text-[var(--text-main)]">Doctors</h5>
            <p className="text-xs text-[var(--text-muted)]">
              Providers you schedule under. Add a name here, or mark a team member as a Doctor in
              Settings → Team.
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          {doctors.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">No doctors yet.</p>
          )}
          {doctors.map((doc) => {
            const isMember = Boolean(doc.memberUserId);
            return (
              <div
                key={doc.id}
                className="flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5"
              >
                <input
                  className="min-w-0 flex-1 rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm disabled:bg-[var(--bg-soft)] disabled:text-[var(--text-muted)]"
                  disabled={isMember}
                  onChange={(e) => renameDoctor(doc.id, e.target.value)}
                  value={doc.name}
                />
                {isMember ? (
                  <span
                    className="shrink-0 rounded-full bg-[rgba(24,24,27,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[#27272a]"
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

      {/* ── Multi-Location ──────────────────────────────────────── */}
      <div className="order-1 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-[var(--text-main)]">
            Office Locations{" "}
            <span className="font-normal text-[var(--text-muted)]">
              — turn on to run several offices, each with its own doctors &amp; schedule
            </span>
          </span>
          <ToggleSwitch
            checked={officeSettings.multiLocation}
            onChange={(on) => {
              // Turning multi-location ON with no offices yet: seed the FIRST
              // office from the existing single office (name/address/phone) and
              // its current schedule hours, so nothing is lost and the original
              // office simply becomes location #1.
              if (on && (officeSettings.locations ?? []).length === 0) {
                const first: OfficeLocation = {
                  id: genId("loc"),
                  name: officeSettings.officeName.trim() || "Main office",
                  nickname: "",
                  address: officeSettings.address ?? "",
                  phone: officeSettings.phone ?? "",
                  fax: officeSettings.fax ?? "",
                  email: officeSettings.email ?? "",
                  doctorIds: [],
                  officeHours: loadScheduleSettings().officeHours,
                };
                updateOfficeSettings({ multiLocation: true, locations: [first] });
                setOpenLocId(first.id);
              } else {
                updateOfficeSettings({ multiLocation: on });
              }
            }}
            ariaLabel="Multi-location"
          />
        </label>

        {officeSettings.multiLocation && (
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
                    <input
                      className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                      onChange={(e) => updateLocation(loc.id, { nickname: e.target.value })}
                      placeholder="e.g. Hulen"
                      value={loc.nickname}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Phone
                    </span>
                    <input
                      className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                      inputMode="numeric"
                      maxLength={12}
                      onChange={(e) => updateLocation(loc.id, { phone: formatUsPhoneInput(e.target.value) })}
                      placeholder="(555) 555-5555"
                      value={loc.phone}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Fax
                    </span>
                    <input
                      className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                      inputMode="numeric"
                      maxLength={12}
                      onChange={(e) => updateLocation(loc.id, { fax: formatUsPhoneInput(e.target.value) })}
                      placeholder="(555) 555-5555"
                      value={loc.fax}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Email
                    </span>
                    <input
                      className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                      onChange={(e) => updateLocation(loc.id, { email: e.target.value })}
                      placeholder="office@practice.com"
                      value={loc.email}
                    />
                  </label>
                  <div className="grid gap-1 sm:col-span-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Address
                    </span>
                    <AddressFieldGroup
                      onChange={(next) => updateLocation(loc.id, { address: next })}
                      value={loc.address}
                    />
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
                    onClick={() => removeLocation(loc.id)}
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
    </div>
  );
}
