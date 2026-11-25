/** Wires the page: start/stop, toggles, calibration, and the render loop. */
import { type InputInfo, type Microphone, startMicrophone } from "./audio.ts";
import type { Frame } from "./frame.ts";
import { drawGraph, type GraphColors, position, readColors } from "./graph.ts";
import { describe, formatClock, formatDuration, safeHours, zone } from "./levels.ts";
import { type Reading, type Response, Session, type Weighting } from "./session.ts";
import {
  DEFAULT_OFFSET,
  loadSettings,
  OFFSET_RANGE,
  saveSettings,
  type Settings,
} from "./settings.ts";

/** Looks up an element the page is known to contain, checking its type. */
function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element: HTMLElement | null = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`#${id} is missing or not a ${type.name}`);
  return element;
}

const app: HTMLElement = byId("app", HTMLElement);
const levelEl: HTMLElement = byId("level", HTMLElement);
const decimalEl: HTMLElement = byId("decimal", HTMLElement);
const unitEl: HTMLElement = byId("unit", HTMLElement);
const responseLabel: HTMLElement = byId("response-label", HTMLElement);
const overloadEl: HTMLElement = byId("overload", HTMLElement);
const describeEl: HTMLElement = byId("describe", HTMLElement);
const barCover: HTMLElement = byId("bar-cover", HTMLElement);
const barMax: HTMLElement = byId("bar-max", HTMLElement);
const canvas: HTMLCanvasElement = byId("graph", HTMLCanvasElement);
const leqEl: HTMLElement = byId("leq", HTMLElement);
const minEl: HTMLElement = byId("min", HTMLElement);
const maxEl: HTMLElement = byId("max", HTMLElement);
const peakEl: HTMLElement = byId("peak", HTMLElement);
const exposureEl: HTMLElement = byId("exposure", HTMLElement);
const clockEl: HTMLElement = byId("clock", HTMLElement);
const startBtn: HTMLButtonElement = byId("start", HTMLButtonElement);
const resetBtn: HTMLButtonElement = byId("reset", HTMLButtonElement);
const errorEl: HTMLElement = byId("error", HTMLElement);
const calChip: HTMLButtonElement = byId("open-cal", HTMLButtonElement);
const calState: HTMLElement = byId("cal-state", HTMLElement);
const dialog: HTMLDialogElement = byId("cal", HTMLDialogElement);
const calLevel: HTMLElement = byId("cal-level", HTMLElement);
const calUnit: HTMLElement = byId("cal-unit", HTMLElement);
const offsetValue: HTMLOutputElement = byId("offset-value", HTMLOutputElement);
const offsetInput: HTMLInputElement = byId("offset", HTMLInputElement);
const inputInfoEl: HTMLElement = byId("input-info", HTMLElement);

const settings: Settings = loadSettings();
const session: Session = new Session();
let mic: Microphone | null = null;
let starting = false;
let wakeLock: WakeLockSentinel | null = null;
let frameRequest = 0;
let colors: GraphColors = readColors(app);

function fixed(db: number): string {
  return db.toFixed(1);
}

// --- Settings ---------------------------------------------------------------

function applySettings(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>("input[name=weighting]")) {
    input.checked = input.value === settings.weighting;
  }
  for (const input of document.querySelectorAll<HTMLInputElement>("input[name=response]")) {
    input.checked = input.value === settings.response;
  }
  const unit = settings.weighting === "A" ? "dB(A)" : "dB(Z)";
  unitEl.textContent = unit;
  calUnit.textContent = unit;
  responseLabel.textContent = settings.response === "fast" ? "Fast" : "Slow";
  const sign = settings.offset >= 0 ? "+" : "";
  offsetValue.textContent = `${sign}${fixed(settings.offset)}`;
  offsetInput.value = String(settings.offset);
  calState.textContent = settings.calibrated
    ? `Offset ${sign}${fixed(settings.offset)}`
    : "Uncalibrated";
  calChip.dataset["calibrated"] = String(settings.calibrated);
  saveSettings(settings);
}

function setOffset(offset: number): void {
  const clamped: number = Math.min(OFFSET_RANGE.max, Math.max(OFFSET_RANGE.min, offset));
  settings.offset = Math.round(clamped * 10) / 10;
  settings.calibrated = true;
  applySettings();
  render();
}

document.addEventListener("change", (event: Event): void => {
  const input = event.target as HTMLInputElement;
  if (input.name === "weighting") settings.weighting = input.value as Weighting;
  else if (input.name === "response") settings.response = input.value as Response;
  else return;
  applySettings();
  render();
});

calChip.addEventListener("click", (): void => dialog.showModal());

dialog.addEventListener("click", (event: MouseEvent): void => {
  const target = event.target as HTMLElement;
  // A tap on the backdrop lands on the dialog itself, outside the form.
  if (target === dialog) {
    dialog.close();
    return;
  }
  const nudge: string | undefined = target.closest<HTMLElement>("[data-nudge]")?.dataset["nudge"];
  if (nudge !== undefined) setOffset(settings.offset + Number(nudge));
});

offsetInput.addEventListener("input", (): void => setOffset(Number(offsetInput.value)));

byId("cal-default", HTMLButtonElement).addEventListener("click", (): void => {
  settings.offset = DEFAULT_OFFSET;
  settings.calibrated = false;
  applySettings();
  render();
});

// --- Microphone info ---------------------------------------------------------

function row(label: string, value: string, bad = false): string {
  return `<div><dt>${label}</dt><dd${bad ? ' class="bad"' : ""}>${value}</dd></div>`;
}

function showInputInfo(info: InputInfo): void {
  const processing: (label: string, on: boolean | undefined) => string = (
    label: string,
    on: boolean | undefined,
  ): string =>
    on === undefined
      ? row(label, "Not reported")
      : on
        ? row(label, "On, readings affected", true)
        : row(label, "Off");
  inputInfoEl.innerHTML = [
    row("Device", escapeHtml(info.label || "Default microphone")),
    row("Sample rate", `${info.sampleRate} Hz`),
    processing("Auto gain", info.autoGainControl),
    processing("Noise suppression", info.noiseSuppression),
    processing("Echo cancellation", info.echoCancellation),
  ].join("");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c: string): string => `&#${c.charCodeAt(0)};`);
}

// --- Start / stop -------------------------------------------------------------

async function start(): Promise<void> {
  if (mic !== null || starting) return;
  starting = true;
  startBtn.disabled = true;
  errorEl.hidden = true;
  try {
    mic = await startMicrophone({
      onFrame: (frame: Frame): void => session.push(frame),
      onEnded: (): void => {
        void stop("The microphone stopped. Tap start to try again.");
      },
    });
    showInputInfo(mic.info);
    app.dataset["state"] = "running";
    startBtn.textContent = "Stop";
    resetBtn.disabled = false;
    await lockScreen();
    if (mic === null) return; // stopped while waiting for the wake lock
    render();
    loop();
  } catch (error) {
    showError(error);
  } finally {
    starting = false;
    startBtn.disabled = false;
  }
}

async function stop(message?: string): Promise<void> {
  const current: Microphone | null = mic;
  mic = null;
  cancelAnimationFrame(frameRequest);
  app.dataset["state"] = "idle";
  startBtn.textContent = "Start";
  if (message !== undefined) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }
  const lock: WakeLockSentinel | null = wakeLock;
  wakeLock = null;
  await lock?.release().catch((): void => {});
  await current?.stop();
  render();
}

function showError(error: unknown): void {
  const name: string = error instanceof DOMException ? error.name : "";
  errorEl.textContent =
    name === "NotAllowedError"
      ? "Microphone access was blocked. Allow it in your browser's site settings, then try again."
      : name === "NotFoundError"
        ? "No microphone found."
        : `Could not start the microphone: ${error instanceof Error ? error.message : String(error)}`;
  errorEl.hidden = false;
}

startBtn.addEventListener("click", (): void => {
  void (mic === null ? start() : stop());
});

resetBtn.addEventListener("click", (): void => {
  session.reset();
  if (mic === null) resetBtn.disabled = true;
  render();
});

// The screen going dark stops the microphone on most phones; keep it on.
async function lockScreen(): Promise<void> {
  if (!("wakeLock" in navigator)) return;
  try {
    const lock: WakeLockSentinel = await navigator.wakeLock.request("screen");
    if (mic === null) await lock.release();
    else {
      // A visibility change can request a second lock while the first is pending.
      void wakeLock?.release().catch((): void => {});
      wakeLock = lock;
    }
  } catch {
    // Low battery mode and some browsers refuse. The meter still works.
  }
}

document.addEventListener("visibilitychange", (): void => {
  if (document.visibilityState !== "visible" || mic === null) return;
  // The OS may have suspended audio, and a wake lock is dropped when hidden.
  mic.resume().catch(showError);
  void lockScreen();
});

// --- Rendering ------------------------------------------------------------------

let drawnFrames = -1;

/** Redraws when the worklet has posted something new (20 times a second), not on every display frame. */
function loop(): void {
  if (session.frames !== drawnFrames) render();
  frameRequest = requestAnimationFrame(loop);
}

function render(): void {
  drawnFrames = session.frames;
  const reading: Reading | null = session.read(
    settings.weighting,
    settings.response,
    settings.offset,
  );
  renderReading(reading);
  drawGraph(
    canvas,
    session.history(settings.weighting, settings.response, settings.offset),
    colors,
  );
}

function renderReading(reading: Reading | null): void {
  if (reading === null) {
    levelEl.textContent = "--";
    decimalEl.textContent = ".-";
    describeEl.textContent = mic === null ? "Tap start to listen" : "Listening…";
    calLevel.textContent = "--";
    for (const el of [leqEl, minEl, maxEl, peakEl]) el.textContent = "--";
    exposureEl.textContent = "";
    clockEl.textContent = "0:00";
    barCover.style.left = "0%";
    barMax.style.left = "0%";
    delete app.dataset["zone"];
    overloadEl.hidden = true;
    return;
  }

  // Round once, so the big number and the stats (toFixed) agree.
  const level: number = Math.max(0, Math.round(reading.level * 10) / 10);
  const [whole, decimal] = level.toFixed(1).split(".");
  levelEl.textContent = whole ?? "0";
  decimalEl.textContent = `.${decimal ?? "0"}`;
  calLevel.textContent = fixed(level);
  describeEl.textContent = describe(level);
  app.dataset["zone"] = zone(level);
  overloadEl.hidden = !reading.clipping;

  barCover.style.left = `${position(level) * 100}%`;
  barMax.style.left = `calc(${position(reading.max) * 100}% - 2px)`;

  // Clamped like the big number: below 0 dB only means "under the noise floor".
  leqEl.textContent = fixed(Math.max(0, reading.leq));
  minEl.textContent = fixed(Math.max(0, reading.min));
  maxEl.textContent = fixed(Math.max(0, reading.max));
  peakEl.textContent = fixed(Math.max(0, reading.peak));

  clockEl.textContent = formatClock(reading.seconds);
  // The NIOSH limit is defined for A-weighted Leq; for Z there is nothing honest to say.
  exposureEl.textContent =
    settings.weighting === "A" && reading.seconds >= 5
      ? `Safe at this Leq: ${formatDuration(safeHours(reading.leq))} a day`
      : "";
}

new ResizeObserver((): void => render()).observe(canvas);
void document.fonts.ready.then((): void => {
  colors = readColors(app);
  render();
});

applySettings();
render();

if ("serviceWorker" in navigator) {
  // The dev server has no service worker, so this 404s there; that's fine.
  navigator.serviceWorker.register("./sw.js").catch((): void => {});
}
