/**
 * The choices that survive a reload. Kept in localStorage, which can be
 * missing or throw (private mode, blocked storage), so every access is
 * guarded and the app falls back to defaults.
 */
import type { Response, Weighting } from "./session.ts";

export type Settings = {
  weighting: Weighting;
  response: Response;
  /** dB added to the dBFS reading to get dB SPL. */
  offset: number;
  /** Whether the user has set the offset, or it is still the guess. */
  calibrated: boolean;
};

/**
 * A guess that puts a typical phone in the right neighbourhood: a quiet room
 * around 30 to 40 dB, speech around 60. Off by 10 dB or more on some devices,
 * which is why the app nags until it is calibrated.
 */
export const DEFAULT_OFFSET = 100;
export const OFFSET_RANGE = { min: 40, max: 160 } as const;

const KEY = "decibels:settings";

const DEFAULTS: Settings = {
  weighting: "A",
  response: "fast",
  offset: DEFAULT_OFFSET,
  calibrated: false,
};

export function loadSettings(): Settings {
  try {
    const raw: string | null = localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULTS };
    const parsed: Partial<Settings> = JSON.parse(raw);
    return {
      weighting: parsed.weighting === "Z" ? "Z" : "A",
      response: parsed.response === "slow" ? "slow" : "fast",
      offset:
        typeof parsed.offset === "number" &&
        parsed.offset >= OFFSET_RANGE.min &&
        parsed.offset <= OFFSET_RANGE.max
          ? parsed.offset
          : DEFAULT_OFFSET,
      calibrated: parsed.calibrated === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not persisting is fine; the app still works for this visit.
  }
}
