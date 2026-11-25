/**
 * Service worker: precaches the whole app so it opens offline, and swaps in
 * a new version as soon as one is deployed.
 *
 * `scripts/build.ts` fills in the two constants below. Paths are relative to
 * the worker's own URL, so the app works under any base path (/decibels/ on
 * GitHub Pages, / locally).
 */

declare const DECIBELS_PRECACHE: Array<string>;
declare const DECIBELS_VERSION: string;

// The service worker globals, typed locally: the WebWorker lib clashes with
// the DOM lib the rest of the app compiles against.
type ExtendableEvent = Event & { waitUntil(promise: Promise<unknown>): void };
type FetchEvent = ExtendableEvent & {
  request: Request;
  respondWith(response: Promise<Response>): void;
};
type Worker = {
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  registration: { scope: string };
};

const worker: Worker = self as unknown as Worker;
const CACHE = `decibels-${DECIBELS_VERSION}`;
const resolve: (path: string) => string = (path: string): string =>
  new URL(path, worker.registration.scope).href;
const INDEX: string = resolve("./index.html");

worker.addEventListener("install", (event: ExtendableEvent): void => {
  event.waitUntil(
    (async (): Promise<void> => {
      const cache: Cache = await caches.open(CACHE);
      // Bypass the HTTP cache: GitHub Pages sends max-age=600, and an old
      // index.html from there would point at chunks this deploy removed.
      await cache.addAll(
        DECIBELS_PRECACHE.map(
          (path: string): Request => new Request(resolve(path), { cache: "reload" }),
        ),
      );
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener("activate", (event: ExtendableEvent): void => {
  event.waitUntil(
    (async (): Promise<void> => {
      const stale: Array<string> = (await caches.keys()).filter(
        (name: string): boolean => name.startsWith("decibels-") && name !== CACHE,
      );
      await Promise.all(stale.map((name: string): Promise<boolean> => caches.delete(name)));
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener("fetch", (event: FetchEvent): void => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(worker.registration.scope)) return;
  event.respondWith(
    (async (): Promise<Response> => {
      const cache: Cache = await caches.open(CACHE);
      // The app is one page: its scope URL and index.html. Deeper paths go to
      // the network, because the page's relative chunk URLs would not
      // resolve from there.
      const path: string = request.url.split("?")[0] ?? request.url;
      const isApp: boolean =
        request.mode === "navigate" && (path === worker.registration.scope || path === INDEX);
      const key: Request | string = isApp ? INDEX : request;
      return (await cache.match(key, { ignoreSearch: true })) ?? fetch(request);
    })(),
  );
});
