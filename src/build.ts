/**
 * build command — copies public/races.json into dist/ for deployment.
 *
 * Usage:
 *   bun run src/build.ts
 *
 * This is a simple copy operation for Vite Pages deployment.
 * The build step does NOT collect data — it assumes races.json already exists.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const srcPath = resolve(projectRoot, "public", "races.json");
const distDir = resolve(projectRoot, "dist");
const destPath = resolve(distDir, "races.json");

try {
  await mkdir(distDir, { recursive: true });
  await copyFile(srcPath, destPath);
  console.log("Build complete: copied races.json to dist/");
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    console.error("Build failed: public/races.json not found. Run `bun run collect` first.");
    process.exit(1);
  }
  throw error;
}
