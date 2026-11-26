/**
 * The built app in headless Chrome, with a generated WAV file standing in for
 * the microphone. A tone of known level goes in, so the number on screen can
 * be checked end to end: getUserMedia, the worklet, A-weighting, the session
 * and the default calibration offset.
 *
 * Needs Chrome. Run with `bun run test:browser`; `bun run ci` leaves it out.
 */
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Subprocess } from "bun";

setDefaultTimeout(30_000);

const ROOT: string = join(import.meta.dir, "..");
const SAMPLE_RATE = 48_000;
/** RMS level of the test tone, relative to full scale. */
const TONE_DBFS = -20;
/** `DEFAULT_OFFSET` in src/settings.ts. */
const OFFSET = 100;

/** A mono 16-bit WAV with a sine at `hz` whose RMS level is `dbfs`. */
function sineWav(hz: number, dbfs: number, seconds: number): Uint8Array {
  const amplitude: number = Math.SQRT2 * 10 ** (dbfs / 20);
  const n: number = SAMPLE_RATE * seconds;
  const buffer: ArrayBuffer = new ArrayBuffer(44 + n * 2);
  const view: DataView = new DataView(buffer);
  const ascii: (offset: number, s: string) => void = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const sample: number = amplitude * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }
  return new Uint8Array(buffer);
}

function freePort(): number {
  const probe: Bun.Server<undefined> = Bun.serve({
    port: 0,
    fetch: (): Response => new Response(),
  });
  const port: number = probe.port ?? 0;
  void probe.stop(true);
  return port;
}

let dir = "";
let preview: Subprocess | null = null;
let view: Bun.WebView | null = null;
let base = "";
const errors: Array<string> = [];

async function until(expression: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    // oxlint-disable-next-line no-await-in-loop
    if (await view!.evaluate<boolean>(expression)) return;
    // oxlint-disable-next-line no-await-in-loop
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function text(selector: string): Promise<string> {
  return await view!.evaluate<string>(
    `document.querySelector(${JSON.stringify(selector)}).textContent`,
  );
}

/** The big number on screen, integer and decimal joined. */
async function level(): Promise<number> {
  return Number((await text("#level")) + (await text("#decimal")));
}

beforeAll(async (): Promise<void> => {
  const build: Subprocess = Bun.spawn(["bun", "scripts/build.ts"], {
    cwd: ROOT,
    stdout: "ignore",
  });
  expect(await build.exited).toBe(0);

  dir = await mkdtemp(join(tmpdir(), "decibels-e2e-"));
  const wav: string = join(dir, "tone.wav");
  await Bun.write(wav, sineWav(1000, TONE_DBFS, 10));

  const port: number = freePort();
  preview = Bun.spawn(["bun", "scripts/preview.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdout: "ignore",
  });
  base = `http://127.0.0.1:${port}/decibels/`;
  for (let i = 0; i < 100; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const up: boolean = await fetch(base).then(
      (r: Response): boolean => r.ok,
      (): boolean => false,
    );
    if (up) break;
    // oxlint-disable-next-line no-await-in-loop
    await Bun.sleep(50);
  }

  view = new Bun.WebView({
    backend: {
      type: "chrome",
      argv: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${wav}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    width: 390,
    height: 844,
    console: (type: string, ...args: Array<unknown>): void => {
      if (type === "error") errors.push(args.map(String).join(" "));
    },
  });
  await view.navigate(base);
  await until(`document.querySelector("#start") !== null`);
});

afterAll(async (): Promise<void> => {
  view?.close();
  preview?.kill();
  await preview?.exited;
  await rm(dir, { recursive: true, force: true });
});

test("a 1 kHz tone at -20 dBFS reads 80 dB(A) with the default offset", async (): Promise<void> => {
  await view!.click("#start");
  await until(`document.querySelector("#app").dataset.state === "running"`);
  // Let the Slow average settle too; Fast is what's on screen by default.
  await Bun.sleep(2500);
  expect(Math.abs((await level()) - (TONE_DBFS + OFFSET))).toBeLessThanOrEqual(0.3);
  expect(await text("#describe")).toBe("Heavy traffic");
  expect(Number(await text("#leq"))).toBeCloseTo(TONE_DBFS + OFFSET, 0);
  // Peak is the sine's crest: 3 dB above its RMS.
  expect(Number(await text("#peak"))).toBeCloseTo(TONE_DBFS + OFFSET + 3, 0);
  await Bun.write(join(ROOT, "e2e/screenshot.png"), await view!.screenshot());
});

test("A and Z agree at 1 kHz", async (): Promise<void> => {
  await view!.click("label:has(input[value=Z])");
  await until(`document.querySelector("#unit").textContent === "dB(Z)"`);
  expect(Math.abs((await level()) - (TONE_DBFS + OFFSET))).toBeLessThanOrEqual(0.3);
});

test("the service worker precaches the app", async (): Promise<void> => {
  await until(`caches.keys().then(k => k.length > 0)`);
  const cached: number = await view!.evaluate<number>(
    `caches.keys().then(k => caches.open(k[0])).then(c => c.keys()).then(r => r.length)`,
  );
  expect(cached).toBeGreaterThan(8);
});

test("Stop keeps the session on screen, Start begins a new one", async (): Promise<void> => {
  // The meter has been running since the first test.
  await view!.click("#start");
  await until(`document.querySelector("#app").dataset.state === "idle"`);
  // stop() finishes tearing down after the state flips; let it settle.
  await Bun.sleep(300);
  const stopped: string = await text("#clock");
  expect(stopped).not.toBe("0:00");
  await Bun.sleep(300);
  expect(await text("#clock")).toBe(stopped);

  await view!.click("#start");
  await until(`document.querySelector("#app").dataset.state === "running"`);
  // An empty session also shows 0:00; wait for frames of the new one.
  await until(`document.querySelector("#leq").textContent !== "--"`);
  expect(await text("#clock")).toBe("0:00");
});

test("no errors in the console", (): void => {
  expect(errors).toEqual([]);
});
