/**
 * Dev server with hot reload, using Bun's HTML imports.
 *
 * The microphone needs a secure context. `localhost` counts; a phone browsing
 * to your LAN address does not. For that, set TLS_CERT and TLS_KEY to a
 * certificate the phone trusts (mkcert makes one), or on Android use
 * chrome://inspect port forwarding so the phone sees it as localhost.
 */
import { join } from "node:path";

import index from "../src/index.html";
import { bundle, WORKLET } from "./bundle.ts";

const root: string = new URL("..", import.meta.url).pathname;
const port: number = Number(process.env["PORT"] ?? 3000);
const cert: string | undefined = process.env["TLS_CERT"];
const key: string | undefined = process.env["TLS_KEY"];

const server: Bun.Server<undefined> = Bun.serve({
  port,
  hostname: "0.0.0.0",
  ...(cert !== undefined && key !== undefined
    ? { tls: { cert: Bun.file(cert), key: Bun.file(key) } }
    : {}),
  development: { hmr: true, console: true },
  routes: {
    "/": index,
    // Rebuilt per request, so edits to the worklet apply on the next Start.
    "/worklet.js": async (): Promise<Response> =>
      new Response(await bundle({ entry: WORKLET, minify: false }), {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      }),
    "/icons/:name": (req: Bun.BunRequest<"/icons/:name">): Response => {
      const file: Bun.BunFile = Bun.file(join(root, "src/icons", req.params.name));
      return new Response(file);
    },
  },
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`decibels dev server on ${server.url}`);
