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
| `tests/race-link.test.ts` | Official-site-only race-row destination policy |
| `tests/race-logo-url.test.ts`, `tests/race-logo-candidates.test.ts` | HTTPS logo boundary, generic/favicon rejection, exact Event/SportsEvent evidence, ownership, identity, ambiguity, and precedence |
| `tests/adapters-logo-community.test.ts`, `tests/adapters-official-detail.test.ts` | Adapter-owned HTML extraction, relative URLs, absent/generic/cross-race cases, and zero-network fixture behavior |
| `e2e/home-month-selector.pw.ts` | Production year/month matrix, option updates, DOM retention, focus, empty state, layout, CJK text, and local assets |
| `e2e/home-race-logos.pw.ts`, `e2e/logo-integration.pw.ts`, `e2e/shared-brand-logo.pw.ts` | Remote success, missing/rejected/404 fallback, no-referrer, lazy loading, one-shot logo1, both-header logo2, subpath assets, and responsive geometry |
| `e2e/calendar-home-design.pw.ts` | Calendar-to-home history, shared computed design tokens, controls, responsive list/grid, Korean rendering, errors, and overflow at 375/768/1280 |
| `e2e/dark-mode.pw.ts` | Production light-independent dark token, WCAG contrast, overflow, and error checks for both routes at 375/768/1280 |
| `e2e/home-weather.pw.ts` | Current-city and Seoul paths, forecast/AQI/place failure isolation, one-session lifecycle, metric units, attribution, and six responsive light/dark captures |
| `e2e/fixtures/collection.ts` | Typed fixed 2026/2027 `CollectionOutput` plus a Playwright Clock helper pinned to July 2026; includes a shared February, multiple 2026 months, and a July 2026 calendar race |
| `e2e/helpers/` | Shared browser signals, selector inspection, and computed WCAG contrast helpers |

Before changing a parser, add or update a fixture assertion that would fail before the parser change. Shape-dependent browser scenarios must route `e2e/fixtures/collection.ts`; only the separate public-data smoke test reads the built `public/races.json`, and it must not assume years, months, or a current-month race. Keep TypeScript files below 250 pure lines by splitting parse, network, and presentation concerns.

Event-logo work follows the same failing-fixture-first rule. Positive fixtures must bind one logo to one race name and date; negative fixtures must independently cover absent images, generic images, favicons/placeholders, header branding, neighboring races, ambiguous candidates, client-only strings, malformed/HTTP URLs, and relative URL resolution. Adapter tests must trap network transports and prove extraction uses only the race-owned HTML already returned by the adapter, with identical output across detail budgets. Official tests must prove that logo parsing accepts exact `Event`/`SportsEvent` records independently of the exact-`Event` official discovery rule, and that only an identity-accepted official page can replace the first adapter logo.

## Adding or Repairing a Source

1. Confirm its public list/detail path and robots policy manually.
2. Capture a minimal sanitized public HTML/XML fixture under `tests/fixtures/<source>/`.
3. Write a failing fixture test.
4. Parse only the source-detail URL plus transient identity evidence needed to match an official page. Do not publish source dates, venues, courses, prices, notes, logos, registration state, or `applicationUrl`.
5. Fetch only owned source detail pages. A source detail URL must pass the adapter detail policy and match the source-detail context used for discovery.
6. Discover official homepage candidates only from the owned source detail. Registration, application, and payment links on that page are negative evidence only.
7. Return a typed `AdapterResult` with `discoveryCandidates`, `discoveredOfficialCandidates`, source metadata, and stage counters rather than throwing through the orchestrator.
8. If the already-loaded source HTML contains event-specific logo evidence, treat it as test evidence only unless official materialization accepts it through the current contract. Do not fetch an image/detail page, accept generic branding, or change any request budget to obtain a logo.
9. Treat logo absence or rejection as an omitted optional field, not an adapter failure.
10. Run the full local release check in `OPERATIONS.md`.

## Official-Site Fixtures

Adapter fixtures prove link discovery from source HTML. Official-page fixtures live separately under `tests/fixtures/official-sites/`, and `index.json` maps the exact canonical candidate URL to a trusted local fixture filename. Fixture mode does not apply live DNS/IP policy because it performs no remote request; instead, the fixture loader confines mapping targets to this directory. To refresh one:

1. Capture and minimize public HTML without credentials or personal data; no test may fetch the live site.
2. Update the relevant adapter fixture and assertion if source markup changed.
3. Add or replace the official-page HTML fixture and update its exact URL mapping in `index.json`.
4. Keep mapping targets inside the official fixture directory. Missing mappings and missing files are typed skips, not reasons to use the network.
5. Run the focused adapter/official-site suites, then the complete fixture release path in `OPERATIONS.md`.

Official discovery accepts only explicit race-detail homepage labels or JSON-LD whose `@type` is exactly `Event`, `http://schema.org/Event`, or `https://schema.org/Event`; matching is case-sensitive and rejects longer type names. Application labels on source details are negative evidence only. Discovery and parsing use the same exact Event-type predicate. The official parser reads Event JSON-LD first and then explicit labels; it does not infer fields from unrelated page text. Identity requires a matching normalized race name and rejects a conflicting published race date/year.

Logo candidates are a separate parse-only concern: exact `Event` and `SportsEvent` JSON-LD plus race-owned, logo-marked DOM may supply a candidate, but they do not create an official-page candidate or relax official identity. Candidate images are never fetched during collection. On merge, the first adapter logo survives later adapter duplicates and an accepted official page with no selected logo; a selected candidate from an identity-accepted official page takes final precedence.

Field authority is deliberately narrow. Source list and detail pages never provide published `Race` fields. Official materialization creates the public race only after identity acceptance, with required official fields parsed from the accepted page. `applicationUrl` comes only from a safe registration URL parsed on that accepted official page, or from the accepted official page URL itself. The final URL must pass the official-page policy before becoming `officialSiteUrl`, and verification state, verification/modification timestamps, and registration status are set after materialization. Official-page loading extends the shared policy with recursively decoded exact registration basenames with or without server extensions. Case and slash direction do not bypass it, while longer benign basenames such as `apiary`, `member-run`, `register-run`, and `application-guide` remain valid. The same official classifier runs for discovery classification, manually constructed candidate rejection, final official URLs, schema publication, and every live initial/redirect boundary.

The 40 budget counts official candidate loader invocations. It is not a raw HTTP request count: in live mode the initial request plus at most two validated redirects can produce up to three transport requests per invocation. Candidate load, parse, and identity rejections are counted in `official-sites.message` and do not make the enrichment stage unsuccessful; fixture-index initialization or another stage setup/execution failure does.

## UI Work

`DESIGN.md` is the visual contract. `src/main.ts` coordinates the default homepage and `#/calendar`; page rendering stays split across `home-page.ts`, `home-race-row.ts`, `calendar-page.ts`, and page-scoped CSS imports. Shared homepage/calendar navy, orange, canvas, radius, and elevation tokens live in `shared-brand-tokens.css`; calendar header/hero DOM lives in `calendar-header.ts`, separate from calendar behavior. Homepage weather/AQI/place parsing lives in `home-weather-model.ts`; coarse geolocation, fixed endpoints, independent optional fallbacks, and the session request cache live in `home-weather-client.ts`; semantic rendering and detached-panel protection live in `home-weather.ts`; condition SVG construction lives in `home-weather-icon.ts`. Keep the disclosure visible before the first location request, never render, persist, or log coordinates, retain visible OpenStreetMap attribution for city data, and keep all runtime weather dependencies isolated from race rendering. Homepage search/region/course/status/reset and favorites remain visible disabled/read-only previews with no persistence. Homepage year/month filtering is functional: pure selection rules stay in `home-race-selection.ts`, DOM behavior stays in `home-month-selector.ts`, changing year resets month, and hidden sections remain mounted. Calendar region/course/status filters remain exact AND filters; empty values are wildcards, reset preserves the displayed month, and previous/next remain the only calendar month controls. Race rows and calendar events use `officialSiteUrl` as the only UI href. When it is absent, render static race content with no hover, focus, click, or pointer affordance. Keep `applicationUrl` as accepted official registration or page data only, never as a UI href. Keep remote row logos decorative, lazy, no-referrer, and browser-only; missing or failed images use project-relative `logo1.png`, with a failed remote source switching only once. Both route headers use project-relative `logo2.png`. Keep the seven-day desktop grid, mobile event-list fallback, source-failure notice below homepage selectors, local project-relative Korean fonts, and hash-route static hosting. Run `bun run test:e2e` plus browser visual QA at 375px, 768px, and 1280px after UI edits.

## Deliberately Out of Scope

- Historical data/change tracking
- User submissions and accounts
- A runtime API/backend/database
- Source logins, CAPTCHA handling, or browser-rendered scraping
- Direct registration/payment flows
