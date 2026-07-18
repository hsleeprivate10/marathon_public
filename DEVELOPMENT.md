# Development Guide

## Tooling

The project uses Bun, TypeScript strict mode, Biome, Vitest, Zod, Vite, and Ky. Run `bun install` after dependency changes.

## Test Discipline

Parser tests must use the captured files under `tests/fixtures/`; they must never request a live source. The core suites are:

| Test | Purpose |
| --- | --- |
| `tests/contract.test.ts` | Public JSON schema validation |
| `tests/normalize.test.ts` | Korean name normalization and merging |
| `tests/adapters.test.ts` | Per-source fixture parsing and failure isolation |
| `tests/orchestrator.test.ts` | Sequential collection and generated JSON |
| `tests/official-sites/` | Candidate discovery, live SSRF-safe transport, parsing, identity, merge, fixtures, and the 40-loader-invocation budget |
| `tests/filters.test.ts` | Exact AND filters and month-independent filter behavior |

Before changing a parser, add or update a fixture assertion that would fail before the parser change. Keep TypeScript files below 250 pure lines by splitting parse, network, and presentation concerns.

## Adding or Repairing a Source

1. Confirm its public list/detail path and robots policy manually.
2. Capture a minimal sanitized public HTML/XML fixture under `tests/fixtures/<source>/`.
3. Write a failing fixture test.
4. Parse only fields that are actually present; use `null` for unavailable deadline/price.
5. Normalize only explicitly published course aliases through `src/courses.ts`; unsupported or missing distances produce no course entry.
6. Never add a default `마라톤` course or infer a course from unrelated page text. Keep a known course's fee `null` when no fee is published.
7. Return a typed `AdapterResult` with source metadata rather than throwing through the orchestrator.
8. If the source page has a race-bound explicit official homepage or application link, preserve it in `discoveredLinks`; do not publish candidate provenance in `Race`.
9. Run the full local release check in `OPERATIONS.md`.

## Official-Site Fixtures

Adapter fixtures prove link discovery from source HTML. Official-page fixtures live separately under `tests/fixtures/official-sites/`, and `index.json` maps the exact canonical candidate URL to a trusted local fixture filename. Fixture mode does not apply live DNS/IP policy because it performs no remote request; instead, the fixture loader confines mapping targets to this directory. To refresh one:

1. Capture and minimize public HTML without credentials or personal data; no test may fetch the live site.
2. Update the relevant adapter fixture and assertion if source markup changed.
3. Add or replace the official-page HTML fixture and update its exact URL mapping in `index.json`.
4. Keep mapping targets inside the official fixture directory. Missing mappings and missing files are typed skips, not reasons to use the network.
5. Run the focused adapter/official-site suites, then the complete fixture release path in `OPERATIONS.md`.

Official discovery accepts only explicit race-detail homepage labels or JSON-LD whose `@type` is exactly `Event`, `http://schema.org/Event`, or `https://schema.org/Event`; matching is case-sensitive and rejects longer type names. Application labels remain non-fetching application candidates. Discovery and parsing use the same exact Event-type predicate. The official parser reads Event JSON-LD first and then explicit labels; it does not infer fields from unrelated page text. Identity requires a matching normalized race name and rejects a conflicting published race date/year.

Field precedence is deliberately narrow. Before official loading, an explicit application candidate may update `applicationUrl` only after passing the shared public non-payment HTTP(S) and private-basename policy. Registration destinations remain allowed for application publication. After identity acceptance, name and event date never change; explicit official venue/deadline replace current values; canonical official courses merge with existing courses; non-null official prices replace existing prices for the same course; an explicit registration link may replace `applicationUrl` only through the same policy; the final URL must pass the official-page policy before becoming `officialSiteUrl`; and verification state, verification/modification timestamps, and registration status are refreshed. Official-page loading extends the shared policy with recursively decoded exact registration basenames with or without server extensions. Case and slash direction do not bypass it, while longer benign basenames such as `apiary`, `member-run`, `register-run`, and `application-guide` remain valid. The same official classifier runs for discovery classification, manually constructed candidate rejection, final official URLs, schema publication, and every live initial/redirect boundary. Other null or absent official values preserve the race fields current at that point.

The 40 budget counts official candidate loader invocations. It is not a raw HTTP request count: in live mode the initial request plus at most two validated redirects can produce up to three transport requests per invocation. Candidate load, parse, and identity rejections are counted in `official-sites.message` and do not make the enrichment stage unsuccessful; fixture-index initialization or another stage setup/execution failure does.

## UI Work

`DESIGN.md` is the visual contract. Keep the desktop seven-day grid, mobile event-list fallback, visible form labels, keyboard-accessible controls, source-failure notice, and generated timestamp. Region, course, and status filters are exact AND filters; empty values are wildcards. Filter changes and reset must preserve the displayed month, while previous/next remain the only month controls. Race cards prefer verified `officialSiteUrl` and fall back to `applicationUrl`. Run browser visual QA at 375px, 768px, and 1280px after UI edits.

## Deliberately Out of Scope

- Historical data/change tracking
- User submissions and accounts
- A runtime API/backend/database
- Source logins, CAPTCHA handling, or browser-rendered scraping
- Direct registration/payment flows
