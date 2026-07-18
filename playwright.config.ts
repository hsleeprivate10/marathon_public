import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const quoteForShell = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const packageManagerExecutable = process.env.npm_execpath ?? "bun";
// Optional uncommitted fallback for restricted QA hosts without system browser libraries.
const localLibraryRoot = join(projectRoot, ".tmp/qa-root/usr/lib");
const localLibraryPaths = existsSync(localLibraryRoot)
  ? [
      localLibraryRoot,
      ...readdirSync(localLibraryRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(localLibraryRoot, entry.name)),
    ]
  : [];
const browserEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

if (localLibraryPaths.length > 0) {
  browserEnvironment.LD_LIBRARY_PATH = [...localLibraryPaths, browserEnvironment.LD_LIBRARY_PATH]
    .filter((path) => path !== undefined)
    .join(":");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  outputDir: ".tmp/playwright-results",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4177/marathon/",
    ...(localLibraryPaths.length > 0 ? { launchOptions: { env: browserEnvironment } } : {}),
  },
  webServer: {
    command: `${quoteForShell(packageManagerExecutable)} run e2e/static-server.ts`,
    url: "http://127.0.0.1:4177/marathon/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
