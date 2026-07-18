import path from "node:path";

const port = 4177;
const routePrefix = "/marathon/";
const distRoot = path.resolve("dist");

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith(routePrefix)) return new Response("Not found", { status: 404 });
    const relativePath = pathname.slice(routePrefix.length) || "index.html";
    const filePath = path.resolve(distRoot, relativePath);
    if (!filePath.startsWith(`${distRoot}${path.sep}`))
      return new Response("Not found", { status: 404 });
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file);
  },
});

console.log(`Static preview: http://127.0.0.1:${port}${routePrefix}`);
