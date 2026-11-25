/**
 * Runs on the audio thread. Sees every microphone sample, A-weights it,
 * keeps the Fast and Slow averages, and posts a {@link Frame} every 50 ms.
 *
 * Built as its own file (`worklet.js`) because `audioWorklet.addModule` takes
 * a URL, not an import.
 */
import { aWeighting, Cascade, smoothing, TIME_CONSTANT } from "./dsp.ts";
import type { Frame } from "./frame.ts";

// The AudioWorkletGlobalScope globals. The DOM lib describes the page, not
// this scope, so they are declared here.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const FRAME_SECONDS = 0.05;
/** The A-weighting high-passes ring briefly at start; ignore that much input. */
const WARMUP_SECONDS = 0.1;

class MeterProcessor extends AudioWorkletProcessor {
  readonly #weight: Cascade = new Cascade(aWeighting(sampleRate));
  readonly #alphaFast: number = smoothing(TIME_CONSTANT.fast, sampleRate);
  readonly #alphaSlow: number = smoothing(TIME_CONSTANT.slow, sampleRate);
  readonly #frameLength: number = Math.round(FRAME_SECONDS * sampleRate);

  #warmup: number = Math.round(WARMUP_SECONDS * sampleRate);
  #seeded = false;
  #count = 0;
  #sumA = 0;
  #sumZ = 0;
  #peak = 0;
  #fastA = 0;
  #slowA = 0;
  #fastZ = 0;
  #slowZ = 0;

  process(inputs: Array<Array<Float32Array>>): boolean {
    const samples: Float32Array | undefined = inputs[0]?.[0];
    if (samples === undefined) return true;

    const alphaFast: number = this.#alphaFast;
    const alphaSlow: number = this.#alphaSlow;
    for (let i = 0; i < samples.length; i++) {
      const z: number = samples[i]!;
      const a: number = this.#weight.step(z);
      if (this.#warmup > 0) {
        this.#warmup--;
        continue;
      }
      const a2 = a * a;
      const z2 = z * z;
      this.#sumA += a2;
      this.#sumZ += z2;
      const abs: number = Math.abs(z);
      if (abs > this.#peak) this.#peak = abs;
      this.#fastA += alphaFast * (a2 - this.#fastA);
      this.#slowA += alphaSlow * (a2 - this.#slowA);
      this.#fastZ += alphaFast * (z2 - this.#fastZ);
      this.#slowZ += alphaSlow * (z2 - this.#slowZ);

      if (++this.#count === this.#frameLength) this.#post();
    }
    return true;
  }

  #post(): void {
    const n: number = this.#count;
    const energyA = this.#sumA / n;
    const energyZ = this.#sumZ / n;
    if (!this.#seeded) {
      // Start the averages at the first frame's level instead of at silence,
      // so the reading doesn't climb up from -120 dB over the first second.
      this.#fastA = this.#slowA = energyA;
      this.#fastZ = this.#slowZ = energyZ;
      this.#seeded = true;
    }
    const frame: Frame = {
      seconds: n / sampleRate,
      energyA,
      energyZ,
      fastA: this.#fastA,
      slowA: this.#slowA,
      fastZ: this.#fastZ,
      slowZ: this.#slowZ,
      peak: this.#peak,
    };
    // A MessagePort, not a window: there is no target origin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    this.port.postMessage(frame);
    this.#count = 0;
    this.#sumA = 0;
    this.#sumZ = 0;
    this.#peak = 0;
  }
}

registerProcessor("meter", MeterProcessor);
