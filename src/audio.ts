/**
 * Opens the microphone with the browser's voice processing turned off and
 * feeds it to the meter worklet.
 */
import type { Frame } from "./frame.ts";

/** What the browser actually gave us, which can differ from what we asked for. */
export type InputInfo = {
  label: string;
  sampleRate: number;
  /** `true` or `false` as reported; `undefined` when the browser doesn't say. */
  echoCancellation: boolean | undefined;
  noiseSuppression: boolean | undefined;
  autoGainControl: boolean | undefined;
};

export type Microphone = {
  info: InputInfo;
  /** Resume after the OS suspended audio (a call, the app going to the background). */
  resume(): Promise<void>;
  stop(): Promise<void>;
};

export type StartOptions = {
  onFrame(frame: Frame): void;
  /** The track ended without us stopping it: unplugged, revoked, taken by another app. */
  onEnded(): void;
};

const CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    // A meter wants the raw signal. Each of these, left on, changes the level.
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
  video: false,
};

const optionalBool: (v: unknown) => boolean | undefined = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

/** Must be called from a user gesture, or the AudioContext starts suspended. */
export async function startMicrophone(options: StartOptions): Promise<Microphone> {
  const context: AudioContext = new AudioContext({ latencyHint: "interactive" });
  let stream: MediaStream | null = null;
  let meter: AudioWorkletNode;
  try {
    // Resume right away while we still hold the user gesture; iOS needs this
    // before the first await.
    const resumed: Promise<void> = context.resume();
    // If getUserMedia fails first, close() below rejects this; nothing else awaits it.
    resumed.catch((): void => {});
    stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    await resumed;
    await context.audioWorklet.addModule(new URL("worklet.js", document.baseURI));

    const source: MediaStreamAudioSourceNode = context.createMediaStreamSource(stream);
    meter = new AudioWorkletNode(context, "meter", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    // Some browsers only run nodes that lead to the speakers. Route through a
    // muted gain so the worklet is pulled without anything being heard.
    const mute: GainNode = context.createGain();
    mute.gain.value = 0;
    source.connect(meter).connect(mute).connect(context.destination);
  } catch (error) {
    // Release the microphone too, or the recording indicator stays on with
    // nothing left that could turn it off.
    for (const t of stream?.getTracks() ?? []) t.stop();
    await context.close();
    throw error;
  }
  const opened: MediaStream = stream;

  const onMessage: (event: MessageEvent<Frame>) => void = (event: MessageEvent<Frame>): void =>
    options.onFrame(event.data);
  meter.port.addEventListener("message", onMessage);
  // addEventListener, unlike onmessage, doesn't start the port by itself.
  meter.port.start();

  const track: MediaStreamTrack = opened.getAudioTracks()[0]!;
  const settings: MediaTrackSettings = track.getSettings();
  const onEnded: () => void = (): void => options.onEnded();
  track.addEventListener("ended", onEnded);

  return {
    info: {
      label: track.label,
      sampleRate: context.sampleRate,
      echoCancellation: optionalBool(settings.echoCancellation),
      noiseSuppression: optionalBool(settings.noiseSuppression),
      autoGainControl: optionalBool(settings.autoGainControl),
    },
    async resume(): Promise<void> {
      if (context.state !== "running") await context.resume();
    },
    async stop(): Promise<void> {
      track.removeEventListener("ended", onEnded);
      meter.port.removeEventListener("message", onMessage);
      for (const t of opened.getTracks()) t.stop();
      await context.close();
    },
  };
}
