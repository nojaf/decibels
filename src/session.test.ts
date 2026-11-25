import { describe, expect, test } from "bun:test";

import type { Frame } from "./frame.ts";
import { formatClock, formatDuration, safeHours, zone } from "./levels.ts";
import { FRAME_RATE, HISTORY_SECONDS, type Reading, Session } from "./session.ts";

const frame: (power: number, peak?: number) => Frame = (power: number, peak = 0.1): Frame => ({
  seconds: 0.05,
  energyA: power,
  energyZ: power,
  fastA: power,
  slowA: power,
  fastZ: power,
  slowZ: power,
  peak,
});

const db: (power: number) => number = (power: number): number => 10 * Math.log10(power);

describe("Session", () => {
  test("reads nothing before the first frame", () => {
    expect(new Session().read("A", "fast", 0)).toBeNull();
  });

  test("adds the calibration offset to every number", () => {
    const session: Session = new Session();
    session.push(frame(0.001));
    const reading: Reading = session.read("A", "fast", 100)!;
    expect(reading.level).toBeCloseTo(70);
    expect(reading.leq).toBeCloseTo(70);
    expect(reading.min).toBeCloseTo(70);
    expect(reading.max).toBeCloseTo(70);
  });

  test("Leq is the energy average, not the average of decibels", () => {
    const session: Session = new Session();
    session.push(frame(1));
    session.push(frame(0.0001));
    // Half the time at 0 dB and half at -40 dB averages to about -3 dB.
    expect(session.read("A", "fast", 0)!.leq).toBeCloseTo(db(0.50005), 3);
  });

  test("tracks min and max", () => {
    const session: Session = new Session();
    for (const p of [0.01, 0.1, 0.001]) session.push(frame(p));
    const reading: Reading = session.read("Z", "slow", 0)!;
    expect(reading.min).toBeCloseTo(-30);
    expect(reading.max).toBeCloseTo(-10);
  });

  test("holds the overload warning for a second", () => {
    const session: Session = new Session();
    session.push(frame(0.5, 1));
    expect(session.read("A", "fast", 0)!.clipping).toBe(true);
    for (let i = 0; i < FRAME_RATE; i++) session.push(frame(0.01));
    expect(session.read("A", "fast", 0)!.clipping).toBe(false);
  });

  test("history is oldest first and keeps the last minute", () => {
    const session: Session = new Session();
    const total = HISTORY_SECONDS * FRAME_RATE + 5;
    for (let i = 0; i < total; i++) session.push(frame(i === total - 1 ? 1 : 0.01));
    const history: Float32Array = session.history("A", "fast", 0);
    expect(history.length).toBe(HISTORY_SECONDS * FRAME_RATE);
    expect(history.at(-1)).toBeCloseTo(0);
    expect(history[0]).toBeCloseTo(-20);
  });

  test("reset forgets everything", () => {
    const session: Session = new Session();
    session.push(frame(0.5));
    session.reset();
    expect(session.started).toBe(false);
    expect(Number.isNaN(session.history("A", "fast", 0)[0])).toBe(true);
  });
});

describe("levels", () => {
  test("85 dBA is safe for 8 hours, 88 for 4", () => {
    expect(safeHours(85)).toBeCloseTo(8);
    expect(safeHours(88)).toBeCloseTo(4);
  });

  test("zones", () => {
    expect(zone(60)).toBe("safe");
    expect(zone(80)).toBe("caution");
    expect(zone(85)).toBe("harmful");
  });

  test("formatDuration", () => {
    expect(formatDuration(30)).toBe("no limit");
    expect(formatDuration(2.25)).toBe("2 h 15 min");
    expect(formatDuration(0.5)).toBe("30 min");
    expect(formatDuration(0.001)).toBe("under a minute");
  });

  test("formatClock", () => {
    expect(formatClock(7.9)).toBe("0:07");
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3723)).toBe("1:02:03");
  });
});
