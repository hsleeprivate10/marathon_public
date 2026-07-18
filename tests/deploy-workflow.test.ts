import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");

describe("Pages deployment workflow", () => {
  it("deploys when main receives a push", () => {
    expect(workflow).toContain('  push:\n    branches: ["main"]');
  });
});
