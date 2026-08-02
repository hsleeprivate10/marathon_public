import path from "node:path";
import { e2eCollection } from "./fixtures/collection.js";

const port = 4177;
const routePrefix = "/marathon/";
const distRoot = path.resolve("dist");
const immutableAssetPattern = /\.(?:css|js|png|svg|woff2)$/u;

function cacheHeaders(relativePath: string): HeadersInit {
  if (relativePath === "index.html") return { "Cache-Control": "no-cache" };
  if (immutableAssetPattern.test(relativePath))
    return { "Cache-Control": "public, max-age=31536000, immutable" };
  return { "Cache-Control": "public, max-age=300" };
}

function fallbackRacesJson(): Response {
  return new Response(JSON.stringify(e2eCollection), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith(routePrefix)) return new Response("Not found", { status: 404 });
    const relativePath = pathname.slice(routePrefix.length) || "index.html";
    if (relativePath === "races.json") return fallbackRacesJson();
    const filePath = path.resolve(distRoot, relativePath);
    if (!filePath.startsWith(`${distRoot}${path.sep}`))
      return new Response("Not found", { status: 404 });
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file, { headers: cacheHeaders(relativePath) });
  },
});

console.log(`Static preview: http://127.0.0.1:${port}${routePrefix}`);
