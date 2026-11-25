# Decibels

A sound level meter for your phone, as an installable PWA that works offline.
Live at https://nojaf.com/decibels/

It shows the current level in dB(A) or dB(Z) with Fast or Slow response, a bar
meter, the last minute as a graph, Leq, min, max and peak for the session, and
how long a day the session's Leq is safe by the NIOSH limit (85 dBA for 8
hours, halved for every 3 dB more).

## Running it

```bash
mise install
bun install
bun dev
```

Then open http://localhost:3000. The microphone only works in a secure
context: `localhost` is one, your LAN address over plain http is not. To try
it on a phone during development, either:

- Android: plug in the phone, open `chrome://inspect` on the desktop, and
  forward port 3000, so the phone reaches it as `localhost:3000`.
- Any phone: make a certificate the phone trusts (mkcert does this) and start
  with `TLS_CERT=cert.pem TLS_KEY=key.pem bun dev`.

| Command                | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `bun dev`              | Dev server with hot reload                            |
| `bun run build`        | Type-check and build to `dist/`                       |
| `bun run preview`      | Serve `dist/` under `/decibels/`, service worker live |
| `bun fmt`              | Format everything                                     |
| `bun lint`             | Type-aware lint with oxlint                           |
| `bun check`            | Type-check                                            |
| `bun run test`         | Unit tests                                            |
| `bun run test:browser` | The built app in headless Chrome, fed a test tone     |
| `bun run ci`           | Format check, lint, type-check, unit tests            |
| `bun run icons`        | Rebuild the app icons from the Loudred sprite         |

The whole stack is Bun: its HTML bundler builds the page, `Bun.serve` runs the
dev and preview servers, `Bun.WebView` drives Chrome for the browser test.
The only non-Bun build dependency is sharp, for the icons, because
`Bun.Image` does not read SVG.

The Bun version is pinned twice: in `mise.toml` for local work and in
`packageManager` in `package.json` for CI. Bump both together.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. The repo must be called `decibels` under the
`nojaf` account, whose Pages site is served at nojaf.com. One-time setup on
the repo:

**Settings → Pages → Build and deployment → Source: GitHub Actions**

Every URL in `dist/` is relative (the page, the manifest's `start_url` and
`scope`, the worklet, the service worker), so the build needs no base path.

## How it works

- `src/dsp.ts`: A-weighting as three biquads for the context's sample rate,
  plus the Fast/Slow smoothing factors and dB conversions. No DOM, so the
  worklet, the page and `bun test` all use it.
- `src/worklet.ts`: an AudioWorklet that sees every sample, runs the A-weighting
  and the four exponential averages (A/Z × Fast/Slow), and posts a frame every
  50 ms. Built separately to `worklet.js`, because `addModule` takes a URL.
- `src/session.ts`: collects frames into Leq, min, max, peak and a 60 s history
  for all four combinations, so flipping a toggle mid-session loses nothing.
  Stored in dBFS; the calibration offset is added when reading, so
  recalibrating applies to the whole session.
- `src/audio.ts`: opens the microphone with echo cancellation, noise
  suppression and auto gain off, and reports back which of those the browser
  actually honoured (shown in the calibration sheet).
- `src/sw.ts`: precaches every file in `dist/`. `scripts/build.ts` fills in the
  file list and a content hash, so each deploy gets a new cache.

### Accuracy

The A-weighting filter is within 0.05 dB of the IEC 61672 curve up to 1 kHz
and within class 1 tolerance up to 12.5 kHz. The browser test feeds a 1 kHz
tone at −20 dBFS through Chrome's fake microphone and checks the screen reads
80.0 ± 0.3 dB at the default offset of 100.

The weak link is the phone. Its microphone's sensitivity differs per model,
so until calibrated the number can be 10 dB or more off. Phone microphones also
roll off below about 100 Hz and clip somewhere around 90 to 110 dB SPL; the
app shows **Overload** when the input reaches full scale, because the reading
is then too low. iOS Safari does not always let auto gain be switched off,
which flattens loud sounds; the calibration sheet says when that happens.

### Calibrating

Open the chip in the top right. Hold the phone next to a reference meter, make
a steady noise (pink noise, a fan, a held tone), and nudge the offset until both
agree. The offset is stored on the device.

### Screen and background

The app holds a screen wake lock while measuring, because most phones stop the
microphone when the screen turns off or the app goes to the background. When
the app comes back to the front it resumes the audio and takes the lock again.
