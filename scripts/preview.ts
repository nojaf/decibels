/**
 * Serves dist/ under /decibels/, the same path GitHub Pages uses, so a
 * base-path mistake shows up here and not after deploying. The service worker
 * is live, so this is the place to test offline behaviour.
 */
import { join, normalize } from "node:path";

const dist: string = new URL("../dist", import.meta.url).pathname;
const BASE = "/decibels/";
const port: number = Number(process.env["PORT"] ?? 4173);

const server: Bun.Server<undefined> = Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith(BASE)) return Response.redirect(BASE, 302);
    const relativePath: string = normalize(pathname.slice(BASE.length) || "index.html");
    if (relativePath.startsWith("..")) return new Response("Not found", { status: 404 });
    const file: Bun.BunFile = Bun.file(join(dist, relativePath));
    if (await file.exists()) return new Response(file);
    return new Response("Not found", { status: 404 });
  },
});

console.log(`decibels preview on ${new URL(BASE, server.url)}`);
