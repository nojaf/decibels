/**
 * Everything one measuring session has collected: the current level, Leq,
 * min, max, peak and a rolling history, for both weightings and both
 * responses, so flipping a toggle mid-session loses nothing.
 *
 * Stored in dB relative to full scale (dBFS). The calibration offset is added
 * only when reading, so recalibrating applies to the whole session.
 */
import { amplitudeToDb, powerToDb } from "./dsp.ts";
import type { Frame } from "./frame.ts";

export type Weighting = "A" | "Z";
export type Response = "fast" | "slow";

/** Seconds of history kept for the graph. */
export const HISTORY_SECONDS = 60;
/** Frames per second the worklet posts. */
export const FRAME_RATE = 20;
const HISTORY_LENGTH = HISTORY_SECONDS * FRAME_RATE;

/** How long a frame at full scale keeps the overload warning lit. */
const CLIP_HOLD_SECONDS = 1;
/** A sample this close to full scale means the input clipped. */
const CLIP_THRESHOLD = 0.999;

type Channel = {
  min: number;
  max: number;
  /** Ring buffer of levels in dBFS, oldest overwritten first. */
  history: Float32Array;
};

/** A session's numbers for one weighting and response, calibrated. */
export type Reading = {
  /** The current time-weighted level. */
  level: number;
  /** Equivalent continuous level: the energy average over the whole session. */
  leq: number;
  min: number;
  max: number;
  /** Highest instantaneous sample, unweighted, in dB. */
  peak: number;
  seconds: number;
  /** The input reached full scale in the last second, so readings are too low. */
  clipping: boolean;
};

const key: (weighting: Weighting, response: Response) => `${Weighting}-${Response}` = (
  weighting: Weighting,
  response: Response,
): `${Weighting}-${Response}` => `${weighting}-${response}`;

const newChannel: () => Channel = (): Channel => ({
  min: Infinity,
  max: -Infinity,
  history: new Float32Array(HISTORY_LENGTH).fill(Number.NaN),
});

export class Session {
  #seconds = 0;
  #energyA = 0;
  #energyZ = 0;
  #peak = 0;
  #sinceClip = Infinity;
  #frames = 0;
  #last: Frame | null = null;
  #channels: Map<string, Channel> = new Map();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.#seconds = 0;
    this.#energyA = 0;
    this.#energyZ = 0;
    this.#peak = 0;
    this.#sinceClip = Infinity;
    this.#frames = 0;
    this.#last = null;
    this.#channels = new Map();
    for (const w of ["A", "Z"] as const) {
      for (const r of ["fast", "slow"] as const) {
        this.#channels.set(key(w, r), newChannel());
      }
    }
  }

  /** Frames received since the last reset; changes whenever there is something new to draw. */
  get frames(): number {
    return this.#frames;
  }

  get started(): boolean {
    return this.#last !== null;
  }

  push(frame: Frame): void {
    this.#seconds += frame.seconds;
    this.#energyA += frame.energyA * frame.seconds;
    this.#energyZ += frame.energyZ * frame.seconds;
    if (frame.peak > this.#peak) this.#peak = frame.peak;
    this.#sinceClip = frame.peak >= CLIP_THRESHOLD ? 0 : this.#sinceClip + frame.seconds;

    const slot = this.#frames % HISTORY_LENGTH;
    const levels: Array<[Weighting, Response, number]> = [
      ["A", "fast", frame.fastA],
      ["A", "slow", frame.slowA],
      ["Z", "fast", frame.fastZ],
      ["Z", "slow", frame.slowZ],
    ];
    for (const [w, r, power] of levels) {
      const channel: Channel = this.#channels.get(key(w, r))!;
      const db: number = powerToDb(power);
      if (db < channel.min) channel.min = db;
      if (db > channel.max) channel.max = db;
      channel.history[slot] = db;
    }
    this.#frames++;
    this.#last = frame;
  }

  read(weighting: Weighting, response: Response, offset: number): Reading | null {
    const last: Frame | null = this.#last;
    if (last === null) return null;
    const channel: Channel = this.#channels.get(key(weighting, response))!;
    const current: number =
      weighting === "A"
        ? response === "fast"
          ? last.fastA
          : last.slowA
        : response === "fast"
          ? last.fastZ
          : last.slowZ;
    const energy: number = weighting === "A" ? this.#energyA : this.#energyZ;
    return {
      level: powerToDb(current) + offset,
      leq: powerToDb(energy / this.#seconds) + offset,
      min: channel.min + offset,
      max: channel.max + offset,
      peak: amplitudeToDb(this.#peak) + offset,
      seconds: this.#seconds,
      clipping: this.#sinceClip < CLIP_HOLD_SECONDS,
    };
  }

  /**
   * The last {@link HISTORY_SECONDS} of levels, oldest first, calibrated.
   * Slots not yet filled are NaN.
   */
  history(weighting: Weighting, response: Response, offset: number): Float32Array {
    const ring: Float32Array = this.#channels.get(key(weighting, response))!.history;
    const out: Float32Array = new Float32Array(HISTORY_LENGTH);
    const start = this.#frames % HISTORY_LENGTH;
    for (let i = 0; i < HISTORY_LENGTH; i++) {
      out[i] = ring[(start + i) % HISTORY_LENGTH]! + offset;
    }
    return out;
  }
}
