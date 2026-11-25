/**
 * Bundles the two scripts that load by URL rather than through the page:
 * the audio worklet and the service worker. Shared by the dev server and the
 * production build.
 */

export type Bundle = {
  entry: string;
  minify: boolean;
  define?: Record<string, string>;
};

/** Returns the bundled JavaScript, or throws with Bun's build log. */
export async function bundle({ entry, minify, define }: Bundle): Promise<string> {
  const result: Bun.BuildOutput = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify,
    ...(define === undefined ? {} : { define }),
  });
  if (!result.success) {
    throw new AggregateError(result.logs, `Bundling ${entry} failed`);
  }
  return await result.outputs[0]!.text();
}

export const WORKLET: string = new URL("../src/worklet.ts", import.meta.url).pathname;
export const SERVICE_WORKER: string = new URL("../src/sw.ts", import.meta.url).pathname;
