import { getSetting, setSetting } from "@/lib/settings/system-settings";

export const LIBRARY_SETTINGS_KEY = "media.library";
export const DEFAULT_TRASH_RETENTION_DAYS = 30;
export const MIN_TRASH_RETENTION_DAYS = 7;
export const MAX_TRASH_RETENTION_DAYS = 365;

export type LibrarySettings = { trashRetentionDays: number };

export class LibrarySettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibrarySettingsError";
  }
}

function isValidRetention(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_TRASH_RETENTION_DAYS &&
    value <= MAX_TRASH_RETENTION_DAYS
  );
}

/** Préavis avant qu'une réduction du délai ne s'applique (laisse partir les notifications J-7). */
export const RETENTION_REDUCTION_NOTICE_DAYS = 7;
const DAY_MS = 86_400_000;

type StoredLibrarySettings = Partial<LibrarySettings> & {
  previousRetentionDays?: number;
  retentionChangedAt?: string;
};

export type TrashRetentionPolicy = {
  /** Délai configuré. */
  trashRetentionDays: number;
  /** Délai appliqué à la purge : le plus grand des deux pendant un préavis. */
  effectiveDays: number;
  previousDays: number | null;
  noticeEndsAt: Date | null;
};

function activeReduction(
  stored: StoredLibrarySettings | null,
  now: Date
): { previousDays: number; changedAt: Date; noticeEndsAt: Date } | null {
  const prev = stored?.previousRetentionDays;
  const at = stored?.retentionChangedAt ? new Date(stored.retentionChangedAt) : null;
  if (!isValidRetention(prev) || !at || Number.isNaN(at.getTime())) return null;
  const noticeEndsAt = new Date(at.getTime() + RETENTION_REDUCTION_NOTICE_DAYS * DAY_MS);
  if (now.getTime() >= noticeEndsAt.getTime()) return null;
  return { previousDays: prev, changedAt: at, noticeEndsAt };
}

export async function getLibrarySettings(): Promise<LibrarySettings> {
  const stored = await getSetting<StoredLibrarySettings>(LIBRARY_SETTINGS_KEY);
  const days = stored?.trashRetentionDays;
  return {
    trashRetentionDays: isValidRetention(days) ? days : DEFAULT_TRASH_RETENTION_DAYS,
  };
}

/** Délai de corbeille et préavis éventuel d'une réduction récente. */
export async function getTrashRetentionPolicy(now: Date = new Date()): Promise<TrashRetentionPolicy> {
  const stored = await getSetting<StoredLibrarySettings>(LIBRARY_SETTINGS_KEY);
  const days = stored?.trashRetentionDays;
  const trashRetentionDays = isValidRetention(days) ? days : DEFAULT_TRASH_RETENTION_DAYS;
  const reduction = activeReduction(stored, now);
  if (!reduction || reduction.previousDays <= trashRetentionDays) {
    return { trashRetentionDays, effectiveDays: trashRetentionDays, previousDays: null, noticeEndsAt: null };
  }
  return {
    trashRetentionDays,
    effectiveDays: Math.max(trashRetentionDays, reduction.previousDays),
    previousDays: reduction.previousDays,
    noticeEndsAt: reduction.noticeEndsAt,
  };
}

export async function setLibrarySettings(
  patch: Partial<LibrarySettings>
): Promise<LibrarySettings> {
  const stored = await getSetting<StoredLibrarySettings>(LIBRARY_SETTINGS_KEY);
  const current = await getLibrarySettings();
  const next = { ...current, ...patch };
  if (!isValidRetention(next.trashRetentionDays)) {
    throw new LibrarySettingsError(
      `Le délai de la corbeille doit être un entier entre ${MIN_TRASH_RETENTION_DAYS} et ${MAX_TRASH_RETENTION_DAYS} jours.`
    );
  }
  const now = new Date();
  const toStore: StoredLibrarySettings = { ...next };
  if (next.trashRetentionDays < current.trashRetentionDays) {
    const running = activeReduction(stored, now);
    toStore.previousRetentionDays = Math.max(current.trashRetentionDays, running?.previousDays ?? 0);
    toStore.retentionChangedAt = now.toISOString();
  }
  await setSetting(LIBRARY_SETTINGS_KEY, toStore);
  return next;
}
