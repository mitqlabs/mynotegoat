export interface RoomConfig {
  id: string;
  name: string;
  color: string;
  active: boolean;
}

export interface ScheduleRoomsConfig {
  enableRoomSelectionOnCheckIn: boolean;
  rooms: RoomConfig[];
}

const STORAGE_KEY = "casemate.schedule-rooms.v1";

function createRoomId(prefix = "room") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeColor(value: unknown, fallback = "#0d79bf") {
  if (typeof value !== "string") {
    return fallback;
  }
  const candidate = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(candidate)) {
    return fallback;
  }
  return candidate.toLowerCase();
}

function normalizeRoom(item: Partial<RoomConfig>): RoomConfig | null {
  const name = normalizeText(item.name);
  if (!name) {
    return null;
  }
  const id = normalizeText(item.id) || createRoomId();
  return {
    id,
    name,
    color: normalizeColor(item.color),
    active: typeof item.active === "boolean" ? item.active : true,
  };
}

export function getDefaultScheduleRooms(): ScheduleRoomsConfig {
  return {
    enableRoomSelectionOnCheckIn: false,
    rooms: [],
  };
}

export function normalizeScheduleRooms(value: unknown): ScheduleRoomsConfig {
  const defaults = getDefaultScheduleRooms();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const raw = value as Partial<ScheduleRoomsConfig>;
  const rooms: RoomConfig[] = [];
  const seenNames = new Set<string>();

  if (Array.isArray(raw.rooms)) {
    raw.rooms.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const normalized = normalizeRoom(entry as Partial<RoomConfig>);
      if (!normalized) {
        return;
      }
      const key = normalized.name.toLowerCase();
      if (seenNames.has(key)) {
        return;
      }
      seenNames.add(key);
      rooms.push(normalized);
    });
  }

  return {
    enableRoomSelectionOnCheckIn:
      typeof raw.enableRoomSelectionOnCheckIn === "boolean"
        ? raw.enableRoomSelectionOnCheckIn
        : defaults.enableRoomSelectionOnCheckIn,
    rooms,
  };
}

export function loadScheduleRooms(): ScheduleRoomsConfig {
  if (typeof window === "undefined") {
    return getDefaultScheduleRooms();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultScheduleRooms();
    }
    return normalizeScheduleRooms(JSON.parse(raw));
  } catch {
    return getDefaultScheduleRooms();
  }
}

export function saveScheduleRooms(config: ScheduleRoomsConfig) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeScheduleRooms(config)));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "schedulingSettings", config));
}

