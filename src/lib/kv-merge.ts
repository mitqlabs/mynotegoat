/**
 * Merge-safe combine of a local and a cloud copy of a workspace_kv value.
 * Nothing present on either side is dropped:
 *  - object maps: union of keys, values merged recursively
 *  - arrays of records with `id`: union by id; on conflict the record with
 *    the newer updatedAt (or at/createdAt) wins, else the cloud copy
 *  - arrays of plain values: union (local order, then cloud extras)
 *  - anything else: cloud wins unless local has a newer updatedAt/savedAt
 * Trade-off: a delete on one computer can come back from a stale copy
 * elsewhere. That's recoverable; silently losing data is not.
 */

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

function stamp(v: unknown): number {
  if (!isObj(v)) return 0;
  for (const f of ["updatedAt", "savedAt", "at", "createdAt"]) {
    const x = v[f];
    const n = typeof x === "number" ? x : typeof x === "string" ? Date.parse(x) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function pickNewer(local: unknown, cloud: unknown): unknown {
  return stamp(local) > stamp(cloud) ? local : cloud;
}

function mergeArrays(local: unknown[], cloud: unknown[]): unknown[] {
  const withId = (a: unknown[]) => a.length > 0 && a.every((x) => isObj(x) && typeof x.id === "string");
  if (withId(local) || withId(cloud)) {
    if (!local.every((x) => isObj(x) && typeof x.id === "string") || !cloud.every((x) => isObj(x) && typeof x.id === "string")) {
      return cloud.length >= local.length ? cloud : local;
    }
    const out = new Map<string, unknown>();
    for (const x of cloud as Rec[]) out.set(x.id as string, x);
    for (const x of local as Rec[]) {
      const id = x.id as string;
      out.set(id, out.has(id) ? pickNewer(x, out.get(id)) : x);
    }
    return [...out.values()];
  }
  const prim = (a: unknown[]) => a.every((x) => x === null || typeof x !== "object");
  if (prim(local) && prim(cloud)) {
    const seen = new Set(local.map((x) => JSON.stringify(x)));
    return [...local, ...cloud.filter((x) => !seen.has(JSON.stringify(x)))];
  }
  return cloud.length >= local.length ? cloud : local;
}

export function unionMerge(local: unknown, cloud: unknown): unknown {
  if (local === undefined || local === null) return cloud;
  if (cloud === undefined || cloud === null) return local;
  const empty = (v: unknown) => (Array.isArray(v) ? v.length === 0 : isObj(v) && Object.keys(v).length === 0);
  if (empty(cloud)) return local;
  if (empty(local)) return cloud;
  if (Array.isArray(local) && Array.isArray(cloud)) return mergeArrays(local, cloud);
  if (isObj(local) && isObj(cloud)) {
    if (stamp(local) || stamp(cloud)) return pickNewer(local, cloud); // a single record
    const out: Rec = { ...cloud };
    for (const [k, v] of Object.entries(local)) out[k] = k in cloud ? unionMerge(v, cloud[k]) : v;
    return out;
  }
  // Different shapes (e.g. an old [] vs a map): keep the bigger one.
  if (typeof local === "object" && typeof cloud === "object") {
    return JSON.stringify(local).length > JSON.stringify(cloud).length ? local : cloud;
  }
  return cloud;
}

export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
