import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { OfficialPageLoader } from "./enrichment.js";

const FixtureIndexSchema = z.record(z.string().url(), z.string().min(1));

export class OfficialFixtureIndexError extends Error {
  readonly fixtureDir: string;

  constructor(fixtureDir: string, cause: unknown) {
    super(`Invalid official-site fixture index: ${fixtureDir}`, { cause });
    this.name = "OfficialFixtureIndexError";
    this.fixtureDir = fixtureDir;
  }
}

export async function createFixtureOfficialPageLoader(
  fixtureDir: string,
): Promise<OfficialPageLoader> {
  let mappings: z.infer<typeof FixtureIndexSchema>;
  try {
    const raw = await readFile(resolve(fixtureDir, "index.json"), "utf8");
    mappings = FixtureIndexSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new OfficialFixtureIndexError(fixtureDir, error);
  }

  return async (url) => {
    const mapped = mappings[url];
    if (mapped === undefined) return { kind: "skipped", url, reason: "missing-mapping" };
    const path = resolve(fixtureDir, mapped);
    const relation = relative(fixtureDir, path);
    if (relation.startsWith("..") || isAbsolute(relation)) {
      return { kind: "skipped", url, reason: "missing-file" };
    }
    try {
      return { kind: "success", url, body: await readFile(path, "utf8") };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return { kind: "skipped", url, reason: "missing-file" };
    }
  };
}
