# Decibels

- Bun is the whole toolchain: bundler, dev server, tests, browser driver. Do not add Vite, a framework, or a service worker library.
- `bun run ci` must pass before handing work back. `bun run test:browser` needs Chrome and is not part of `ci`; run it after touching `src/audio.ts`, `src/worklet.ts`, `src/main.ts`, the build scripts or the service worker.
- Keep every URL in the built app relative. The same `dist/` is served at `nojaf.com/decibels/` and at `/` locally; `bun run preview` serves it under `/decibels/` to catch mistakes.
- The worklet and the service worker are bundled by `scripts/bundle.ts`, not by the HTML bundler. A new file loaded by URL needs the same treatment in `scripts/build.ts` and `scripts/dev.ts`.
- Levels are stored in dBFS and calibrated only when read. Keep it that way, so a calibration change applies to the whole session.
