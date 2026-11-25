/** What a level sounds like, and how long you can stand in it. */

export type Zone = "safe" | "caution" | "harmful";

/** NIOSH recommends at most 8 hours a day at 85 dBA. */
const EXPOSURE_LIMIT_DB = 85;
const EXPOSURE_LIMIT_HOURS = 8;
/** NIOSH exchange rate: every 3 dB more halves the allowed time. */
const EXCHANGE_RATE_DB = 3;

const EXAMPLES: Array<[below: number, label: string]> = [
  [25, "Near silence"],
  [35, "Whisper, quiet bedroom"],
  [45, "Library"],
  [55, "Quiet office"],
  [65, "Conversation"],
  [75, "Busy restaurant"],
  [85, "Heavy traffic"],
  [95, "Lawn mower"],
  [105, "Motorbike, subway"],
  [115, "Concert, nightclub"],
  [125, "Chainsaw, thunder"],
];

export function describe(db: number): string {
  for (const [below, label] of EXAMPLES) {
    if (db < below) return label;
  }
  return "Painful";
}

export function zone(db: number): Zone {
  if (db < 70) return "safe";
  if (db < EXPOSURE_LIMIT_DB) return "caution";
  return "harmful";
}

/** Hours a day you can spend at this A-weighted level, by the NIOSH limit. */
export function safeHours(dba: number): number {
  return EXPOSURE_LIMIT_HOURS / 2 ** ((dba - EXPOSURE_LIMIT_DB) / EXCHANGE_RATE_DB);
}

/** "2 h 15 min", "38 min", "under a minute"; "no limit" when it exceeds a day. */
export function formatDuration(hours: number): string {
  if (hours >= 24) return "no limit";
  const minutes: number = Math.round(hours * 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const h: number = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Session clock: "0:07", "12:34", "1:02:03". */
export function formatClock(seconds: number): string {
  const total: number = Math.floor(seconds);
  const h: number = Math.floor(total / 3600);
  const m: number = Math.floor((total % 3600) / 60);
  const s: string = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
