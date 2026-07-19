# Development Guide

## Tooling

The project uses Bun, TypeScript strict mode, Biome, Vitest, Zod, Vite, and Ky. Run `bun install` after dependency changes.

Install Playwright Chromium and its system dependencies once with `bunx playwright install --with-deps chromium`. On Linux, the dependency step installs system packages and therefore requires `sudo` or equivalent root access. After setup, run the self-contained production E2E suite normally with `bun run test:e2e`; Playwright starts and stops its project-subpath server automatically.

Normal development and CI environments use Playwright's installed system dependencies. For restricted QA environments where system packages cannot be installed, `playwright.config.ts` can discover browser libraries under the optional, uncommitted `.tmp/qa-root/` fallback. That directory is local infrastructure only and is not required on correctly provisioned machines.

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
| `tests/page-model.test.ts` | Hash-route fallback and chronological homepage month grouping |
| `tests/home-race-selection.test.ts` | Pure homepage year/month options and exact section-selection matrix |
| `tests/home-weather-model.test.ts` | WMO condition mapping, coarse location selection, Seoul fallback, forecast/AQI parsing, and city/district reduction |
| `tests/race-link.test.ts` | Application URL race-row destination policy |
| `e2e/home-month-selector.pw.ts` | Production year/month matrix, option updates, DOM retention, focus, empty state, layout, CJK text, and local assets |
| `e2e/calendar-home-design.pw.ts` | Calendar-to-home history, shared computed design tokens, controls, responsive list/grid, Korean rendering, errors, and overflow at 375/768/1280 |
| `e2e/dark-mode.pw.ts` | Production light-independent dark token, WCAG contrast, overflow, and error checks for both routes at 375/768/1280 |
| `e2e/home-weather.pw.ts` | Current-city and Seoul paths, forecast/AQI/place failure isolation, one-session lifecycle, metric units, attribution, and six responsive light/dark captures |
| `e2e/fixtures/collection.ts` | Typed fixed 2026/2027 `CollectionOutput` plus a Playwright Clock helper pinned to July 2026; includes a shared February, multiple 2026 months, and a July 2026 calendar race |
| `e2e/helpers/` | Shared browser signals, selector inspection, and computed WCAG contrast helpers |

Before changing a parser, add or update a fixture assertion that would fail before the parser change. Shape-dependent browser scenarios must route `e2e/fixtures/collection.ts`; only the separate public-data smoke test reads the built `public/races.json`, and it must not assume years, months, or a current-month race. Keep TypeScript files below 250 pure lines by splitting parse, network, and presentation concerns.

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

`DESIGN.md` is the visual contract. `src/main.ts` coordinates the default homepage and `#/calendar`; page rendering stays split across `home-page.ts`, `home-race-row.ts`, `calendar-page.ts`, and page-scoped CSS imports. Shared homepage/calendar navy, orange, canvas, radius, and elevation tokens live in `shared-brand-tokens.css`; calendar header/hero DOM lives in `calendar-header.ts`, separate from calendar behavior. Homepage weather/AQI/place parsing lives in `home-weather-model.ts`; coarse geolocation, fixed endpoints, independent optional fallbacks, and the session request cache live in `home-weather-client.ts`; semantic rendering and detached-panel protection live in `home-weather.ts`; condition SVG construction lives in `home-weather-icon.ts`. Keep the disclosure visible before the first location request, never render, persist, or log coordinates, retain visible OpenStreetMap attribution for city data, and keep all runtime weather dependencies isolated from race rendering. Homepage search/region/course/status/reset and favorites remain visible disabled/read-only previews with no persistence. Homepage year/month filtering is functional: pure selection rules stay in `home-race-selection.ts`, DOM behavior stays in `home-month-selector.ts`, changing year resets month, and hidden sections remain mounted. Calendar region/course/status filters remain exact AND filters; empty values are wildcards, reset preserves the displayed month, and previous/next remain the only calendar month controls. Race rows always use the validated `applicationUrl`; do not change `raceHref()` to prefer `officialSiteUrl`. Keep the seven-day desktop grid, mobile event-list fallback, source-failure notice below homepage selectors, local project-relative Korean fonts, and hash-route static hosting. Run `bun run test:e2e` plus browser visual QA at 375px, 768px, and 1280px after UI edits.

## Deliberately Out of Scope

- Historical data/change tracking
- User submissions and accounts
- A runtime API/backend/database
- Source logins, CAPTCHA handling, or browser-rendered scraping
- Direct registration/payment flows
