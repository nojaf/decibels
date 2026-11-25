import { describe, expect, test } from "bun:test";

import { aWeighting, Cascade, cascadeGain, powerToDb, smoothing } from "./dsp.ts";

const toDb: (gain: number) => number = (gain: number): number => 20 * Math.log10(gain);

// The analog curve from IEC 61672-1, which the digital filter approximates.
function relativeResponse(f: number): number {
  return (
    (12194 ** 2 * f ** 4) /
    ((f ** 2 + 20.6 ** 2) *
      Math.sqrt((f ** 2 + 107.7 ** 2) * (f ** 2 + 737.9 ** 2)) *
      (f ** 2 + 12194 ** 2))
  );
}

function analog(hz: number): number {
  return toDb(relativeResponse(hz) / relativeResponse(1000));
}

describe("A-weighting", () => {
  // Allowed deviation from the analog curve. Pre-warping the 12 kHz pole
  // pushes the 4 to 10 kHz region up a little; IEC class 1 allows +1.5 dB at
  // 8 kHz and +2 dB at 10 kHz.
  const reference: Array<[hz: number, tolerance: number]> = [
    [31.5, 0.05],
    [63, 0.05],
    [125, 0.05],
    [250, 0.05],
    [500, 0.05],
    [1000, 0.001],
    [2000, 0.1],
    [4000, 0.4],
    [8000, 1],
    [10000, 1],
  ];

  for (const sampleRate of [44100, 48000]) {
    for (const [hz, tolerance] of reference) {
      test(`${hz} Hz at ${sampleRate} Hz sample rate is within ${tolerance} dB`, () => {
        const gain: number = toDb(cascadeGain(aWeighting(sampleRate), hz, sampleRate));
        expect(Math.abs(gain - analog(hz))).toBeLessThanOrEqual(tolerance);
      });
    }
  }

  test("filtering a 1 kHz sine keeps its power", () => {
    const sampleRate = 48000;
    const cascade: Cascade = new Cascade(aWeighting(sampleRate));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < sampleRate; i++) {
      const y: number = cascade.step(Math.sin((2 * Math.PI * 1000 * i) / sampleRate));
      // Skip the first 100 ms while the 20 Hz high-passes settle.
      if (i >= sampleRate / 10) {
        sum += y * y;
        n++;
      }
    }
    expect(powerToDb(sum / n)).toBeCloseTo(powerToDb(0.5), 1);
  });

  test("filtering a 100 Hz sine drops it by about 19 dB", () => {
    const sampleRate = 48000;
    const cascade: Cascade = new Cascade(aWeighting(sampleRate));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < sampleRate; i++) {
      const y: number = cascade.step(Math.sin((2 * Math.PI * 100 * i) / sampleRate));
      if (i >= sampleRate / 2) {
        sum += y * y;
        n++;
      }
    }
    expect(powerToDb(sum / n) - powerToDb(0.5)).toBeCloseTo(-19.1, 0);
  });
});

describe("smoothing", () => {
  test("reaches 1 - 1/e of a step after one time constant", () => {
    const sampleRate = 48000;
    const alpha: number = smoothing(0.125, sampleRate);
    let y = 0;
    for (let i = 0; i < 0.125 * sampleRate; i++) {
      y += alpha * (1 - y);
    }
    expect(y).toBeCloseTo(1 - Math.exp(-1), 3);
  });
});

describe("powerToDb", () => {
  test("full-scale power is 0 dB", () => {
    expect(powerToDb(1)).toBe(0);
  });

  test("silence is the floor, not -Infinity", () => {
    expect(powerToDb(0)).toBe(-120);
  });
});
