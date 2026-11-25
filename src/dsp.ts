/**
 * Signal maths shared by the audio worklet and the UI. No DOM or Web Audio
 * types in here, so it runs the same in the worklet, the page and `bun test`.
 */

/** One second-order IIR section, normalised so a0 = 1. */
export type Biquad = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

/** A first-order section as (b0 + b1 z^-1) / (1 + a1 z^-1). */
type FirstOrder = { b0: number; b1: number; a1: number };

/**
 * Pole frequencies of the analog A-weighting curve from IEC 61672-1:
 *
 *   H(s) = k s^4 / ((s + w1)^2 (s + w2) (s + w3) (s + w4)^2)
 */
const A_POLES_HZ = {
  f1: 20.598997,
  f2: 107.65265,
  f3: 737.86223,
  f4: 12194.217,
} as const;

/**
 * Bilinear transform of a first-order analog section, with the pole
 * frequency pre-warped so the digital corner lands where the analog one does.
 */
function firstOrder(kind: "highpass" | "lowpass", poleHz: number, sampleRate: number): FirstOrder {
  const k = 2 * sampleRate;
  const w = k * Math.tan((Math.PI * poleHz) / sampleRate);
  const a0 = k + w;
  const a1 = (w - k) / a0;
  return kind === "highpass" ? { b0: k / a0, b1: -k / a0, a1 } : { b0: w / a0, b1: w / a0, a1 };
}

function multiply(x: FirstOrder, y: FirstOrder): Biquad {
  return {
    b0: x.b0 * y.b0,
    b1: x.b0 * y.b1 + x.b1 * y.b0,
    b2: x.b1 * y.b1,
    a1: x.a1 + y.a1,
    a2: x.a1 * y.a1,
  };
}

/** Magnitude of a biquad cascade at `hz`, as a linear gain. */
export function cascadeGain(
  sections: ReadonlyArray<Biquad>,
  hz: number,
  sampleRate: number,
): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  // z^-1 = e^{-jw}
  const c1: number = Math.cos(w);
  const s1: number = -Math.sin(w);
  const c2: number = Math.cos(2 * w);
  const s2: number = -Math.sin(2 * w);
  let gain = 1;
  for (const q of sections) {
    const numRe = q.b0 + q.b1 * c1 + q.b2 * c2;
    const numIm = q.b1 * s1 + q.b2 * s2;
    const denRe = 1 + q.a1 * c1 + q.a2 * c2;
    const denIm = q.a1 * s1 + q.a2 * s2;
    gain *= Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
  }
  return gain;
}

/**
 * A-weighting as three biquads for the given sample rate, normalised to
 * 0 dB at 1 kHz.
 *
 * Within 0.05 dB of the analog curve up to 1 kHz. Pre-warping the 12 kHz pole
 * lifts 4 to 10 kHz by up to 0.85 dB, and past 12.5 kHz the bilinear
 * transform rolls off early (3 to 4 dB low at 16 kHz). All of that is inside
 * IEC 61672 class 1 tolerance, and smaller than what a phone microphone gets
 * wrong on its own.
 */
export function aWeighting(sampleRate: number): Array<Biquad> {
  const { f1, f2, f3, f4 } = A_POLES_HZ;
  const sections: Array<Biquad> = [
    multiply(firstOrder("highpass", f1, sampleRate), firstOrder("highpass", f1, sampleRate)),
    multiply(firstOrder("highpass", f2, sampleRate), firstOrder("highpass", f3, sampleRate)),
    multiply(firstOrder("lowpass", f4, sampleRate), firstOrder("lowpass", f4, sampleRate)),
  ];
  const g: number = cascadeGain(sections, 1000, sampleRate);
  const first: Biquad = sections[0]!;
  sections[0] = { ...first, b0: first.b0 / g, b1: first.b1 / g, b2: first.b2 / g };
  return sections;
}

/**
 * Runs samples through a biquad cascade (transposed direct form II).
 * Keeps its own state, so one instance per signal.
 */
export class Cascade {
  readonly #sections: ReadonlyArray<Biquad>;
  readonly #z1: Float64Array;
  readonly #z2: Float64Array;

  constructor(sections: ReadonlyArray<Biquad>) {
    this.#sections = sections;
    this.#z1 = new Float64Array(sections.length);
    this.#z2 = new Float64Array(sections.length);
  }

  step(x: number): number {
    let y: number = x;
    const sections: ReadonlyArray<Biquad> = this.#sections;
    for (let i = 0; i < sections.length; i++) {
      const q: Biquad = sections[i]!;
      const input: number = y;
      y = q.b0 * input + this.#z1[i]!;
      this.#z1[i] = q.b1 * input - q.a1 * y + this.#z2[i]!;
      this.#z2[i] = q.b2 * input - q.a2 * y;
    }
    return y;
  }
}

/** IEC time constants for the Fast and Slow meter responses. */
export const TIME_CONSTANT = { fast: 0.125, slow: 1 } as const;

/** Per-sample smoothing factor for an exponential average with time constant `tau` seconds. */
export function smoothing(tau: number, sampleRate: number): number {
  return 1 - Math.exp(-1 / (tau * sampleRate));
}

/** The quietest level the app reports, so silence is a number and not -Infinity. */
export const FLOOR_DB = -120;

/** Mean square (power) to decibels relative to digital full scale. */
export function powerToDb(meanSquare: number): number {
  return meanSquare > 0 ? Math.max(FLOOR_DB, 10 * Math.log10(meanSquare)) : FLOOR_DB;
}

/** Amplitude to decibels relative to digital full scale. */
export function amplitudeToDb(amplitude: number): number {
  return amplitude > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(amplitude)) : FLOOR_DB;
}
