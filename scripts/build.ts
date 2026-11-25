/**
 * Production build into dist/, ready to serve from any path.
 *
 * Every URL in the output is relative, so the same dist/ works at
 * nojaf.com/decibels/ and at the root of a local server.
 */
import type { Dirent } from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";

import { bundle, SERVICE_WORKER, WORKLET } from "./bundle.ts";

const root: string = new URL("..", import.meta.url).pathname;
const dist: string = join(root, "dist");

await rm(dist, { recursive: true, force: true });

const page: Bun.BuildOutput = await Bun.build({
  entrypoints: [join(root, "src/index.html")],
  outdir: dist,
  // Fonts referenced from CSS end up inlined as data URLs in the stylesheet.
  minify: true,
});
if (!page.success) {
  for (const log of page.logs) console.error(log);
  process.exit(1);
}

await Bun.write(join(dist, "worklet.js"), await bundle({ entry: WORKLET, minify: true }));

// The manifest names its icons by fixed paths, which the bundler doesn't
// rewrite, so they are copied as they are. Only those: the page's own icons
// are bundled (and hashed) from index.html, and the sprite is a build input.
for (const name of ["pwa-192.png", "pwa-512.png", "maskable-512.png"]) {
  // oxlint-disable-next-line no-await-in-loop
  await cp(join(root, "src/icons", name), join(dist, "icons", name));
}

const files: Array<string> = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter((entry: Dirent): boolean => entry.isFile())
  .map((entry: Dirent): string => relative(dist, join(entry.parentPath, entry.name)))
  .toSorted();

// The cache name changes whenever any file does, which is what makes the
// service worker pick up a new deploy.
const hasher: Bun.CryptoHasher = new Bun.CryptoHasher("sha256");
const contents: Array<Uint8Array> = await Promise.all(
  files.map((file: string): Promise<Uint8Array> => Bun.file(join(dist, file)).bytes()),
);
for (const [i, file] of files.entries()) {
  hasher.update(file);
  hasher.update(contents[i]!);
}
const version: string = hasher.digest("hex").slice(0, 12);

const precache: Array<string> = files.map((file: string): string => `./${file}`);
await Bun.write(
  join(dist, "sw.js"),
  await bundle({
    entry: SERVICE_WORKER,
    minify: true,
    define: {
      DECIBELS_PRECACHE: JSON.stringify(precache),
      DECIBELS_VERSION: JSON.stringify(version),
    },
  }),
);

console.log(`dist/ ready, version ${version}`);
for (const file of [...files, "sw.js"]) {
  console.log(`  ${file.padEnd(40)} ${(Bun.file(join(dist, file)).size / 1024).toFixed(1)} KB`);
}
