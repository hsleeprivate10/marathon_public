# Architecture

## Goal

This project serves a read-only domestic marathon calendar without an always-on server. GitHub Actions performs public-web collection on `main` pushes, a daily schedule, and manual dispatch; GitHub Pages serves the resulting static artifact.

## Runtime Flow

```text
9 public schedule sites
  -> source adapters
  -> source-detail candidates + transient identity evidence
  -> owned source-detail traversal evidence
  -> bounded level 2/3 traversal
  -> official-page-only materialization
  -> conservative race deduplication
  -> public/races.json
  -> Vite static build (dist/)
  -> GitHub Pages artifact deployment
  -> browser homepage and #/calendar route
```

`races.json` is an artifact of each deployment. It is intentionally ignored by Git and is not a historical database.

## Components

| Path | Responsibility |
| --- | --- |
| `src/contract.ts` | Zod schemas and canonical public data contract |
| `src/courses.ts` | Canonical course aliases, ordering, and deduplication |
| `src/race-logo-url.ts`, `src/race-logo-candidates.ts` | Safe logo URL boundary plus event-specific JSON-LD and race-owned DOM candidate parsing |
| `src/adapters/` | One independently failing public-source adapter per site, including MarathonGo list/detail parsing |
| `src/adapters/types.ts` | Request policy, fixture loading, typed traversal seeds, adapter result types |
| `src/normalize.ts` | Name normalization, merge, sort, conservative duplicate key |
| `src/official-sites/` | Contextual traversal evidence, purpose-aware safe fetch policy, bounded traversal, identity checks, parsing, and official-only materialization |
| `src/orchestrator.ts` | Sequential discovery, bounded traversal materialization, post-materialization deduplication, metadata aggregation, JSON write |
| `src/filters.ts` | Exact AND filtering independent of the displayed month |
| `src/collect.ts` | CLI entry point for live or fixture collection |
| `src/validate.ts` | Zod validation of generated JSON |
| `src/main.ts` | Validated-data loading and hash-route coordination |
| `src/page-model.ts` | `home`/`calendar` hash parsing and chronological month grouping |
| `src/home-page.ts` | Semantic homepage composition and month sections |
| `src/home-weather-model.ts`, `src/home-weather-client.ts`, `src/home-weather.ts`, `src/home-weather-icon.ts` | Typed weather/place/AQI parsing, one-session browser requests, semantic hero rendering, and condition SVGs |
| `src/home-race-row.ts`, `src/home-race-media.ts` | Official-site-linked or non-clickable race rows, remote event logos, and local fallback media |
| `src/home-menu.ts`, `src/home-month-selector.ts` | Mobile menu and semantic year/month selector DOM behavior |
| `src/home-race-selection.ts` | Pure year/month option derivation and month-section selection |
| `src/calendar-page.ts`, `src/calendar-header.ts`, `src/calendar-grid.ts` | Calendar coordination, shared-brand header/hero, active filters, and responsive month grid |
| `src/race-link.ts` | Race-row destination policy: `officialSiteUrl` href or no href |
| `src/source-labels.ts` | Public Korean labels for failed collection-source IDs |
| `src/style.css`, `src/shared-brand-tokens.css` | Global light/dark semantic foundations and shared homepage/calendar brand tokens |
| `src/calendar*.css` | Calendar shell, controls, grid, and responsive styling |
| `src/home*.css` | Homepage tokens, layout, controls, rows, and responsive styling |
| `public/fonts/` | Project-relative Noto Sans KR WOFF2, OFL license, and font stylesheet |
| `.github/workflows/deploy.yml` | Push, scheduled, and manual collection/build with artifact Pages deployment |

## Data Contract

Top-level `CollectionOutput` contains:

- `generatedAt`: ISO collection timestamp.
- `races`: normalized, date-sorted race records.
- `collectionMetadata`: one result for each of the nine source adapters plus `official-sites`, with `attempted`, `succeeded`, `recordCount`, and a human-readable `message`.

Every published race has the user-required name, event date, nullable registration deadline, venue, nullable per-course price, race-specific application URL, optional verified official-site URL, optional HTTPS `logoUrl`, notes, source IDs, verification information, and registration status. Those public race fields come from an accepted official page first. The nine source adapters provide discovery candidates, source detail URLs, transient identity evidence, typed traversal seeds, and, for MarathonGo only, an internal trusted detail carrying owned-detail date/venue. That MarathonGo detail may complete only missing official event date or venue after safe final URL and same-race identity acceptance; official values win, conflicts reject, and all other public fields stay official-page-owned. Schedule and index sites are discovery identity sources only. Courses are limited to explicitly observed `풀`, `하프`, `10K`, and `5K` values on the official page. Unknown public information, including a missing event logo, is never guessed.

`logoUrl` is event-only provenance, not general site branding. The shared logo parser accepts exact `Event` or `SportsEvent` JSON-LD logo evidence, logo-marked event images, or logo-marked DOM images owned by the same dated race block; race name, date, year, and ordinal association must agree. This parser is deliberately separate from official-site discovery and identity enrichment, whose structured discovery contract remains exact `Event`. Generic site logos, generic images, ambiguous candidates, headers/navigation/footer branding, favicons, touch icons, placeholders, non-HTTPS URLs, credentials, local/private destinations, and malformed values are omitted. Adapter extraction examines only HTML the adapter already owns for the race and never adds an image request, detail request, crawler, retry, or collection budget.

Logo rejection or absence is non-fatal and does not change source success, official candidate counts, or the existing adapter-detail and 40 official-loader budgets. Published event logos are official-page materialization data, not source-list or source-detail fallback data.

Logo merge precedence is intentionally narrow. Normalization keeps the first validated adapter `logoUrl` across duplicate races; later adapter duplicates fill it only when the earlier race has none. An identity-accepted official page with a matching event logo may replace that adapter value. An accepted page without a logo, a rejected official page, or an unsafe candidate must preserve the current value or keep the field absent.

Adapter output is candidate-only. Source list and search pages produce source-detail candidates plus transient title/date evidence. Owned source-detail pages may discover typed official or application traversal seeds from explicit labels, homepage fields, exact Event JSON-LD, organizer URLs, and application CTAs. Application seeds are traversal evidence only: they may be inspected by the central traversal engine, but they are not merged, not published, and not UI hrefs. Exact seed URLs may be coalesced before fetch as a budget optimization, but semantic race deduplication happens only after official pages materialize `Race` records.

Traversal chains are ordered by event date, Korean name, and URL. Level 0 is the source list, level 1 is the owned source detail, level 2 is an external official or application seed, and level 3 is an optional final official page. Redirects are revalidated separately and do not consume semantic depth. The traversal budget is 40 external fetches per run, 2 per race chain, 10 per host, and 3 sorted child links from an identity-accepted page. `fetched` counts external page fetches, not accepted pages or published races. In live mode every request and each of the at most two redirects is URL-purpose, DNS, public-IP, redirect, timeout, content-type, and 1 MiB body gated. `official-sites.recordCount` is the accepted official materialization count; its message reports `seed`, `fetched`, `accepted`, `rejected`, `policyRejected`, `fetchRejected`, `identityRejected`, `depthSkipped`, `cycleSkipped`, `hostBudgetSkipped`, and `runBudgetSkipped`. Source adapter metadata continues to describe discovery separately.

For `official-sites`, `succeeded` means the enrichment stage completed. Individual policy, fetch, parse, identity, depth, cycle, host-budget, and run-budget rejections increment the message counters without making the stage unsuccessful. Fixture-index initialization or other stage setup/execution failures set `succeeded: false`. This differs from the nine adapter records, whose success describes source extraction.

An accepted official page materializes the public race. Identity evidence from source pages helps match title and date, but official page content supplies the published fields. `applicationUrl` comes only from a safe registration URL parsed on the accepted official page, or from the accepted official page URL itself when no safe registration URL is present. It remains accepted registration or page data and never becomes a browser href. The final page URL must pass the stricter official-page policy before becoming `officialSiteUrl`, which is the only race destination the UI may use. Verification state, verification/modification timestamps, and registration status are set after materialization.

## Source Roles

| Adapter | Role |
| --- | --- |
| `gorunning.ts` | Discovery index and owned detail official-homepage discovery |
| `marathongo.ts` | MarathonGo domestic list plus owned `/raceDetail/domestic/{slug}` detail traversal evidence and date/venue-only trusted detail provenance |
| `kormarathon.ts` | Discovery index and owned detail official-homepage discovery |
| `emarathon.ts` | Discovery index and owned detail official-homepage discovery |
| `maedal.ts` | Discovery index and owned detail official-homepage discovery |
| `kaaf.ts` | Discovery index and owned detail official-homepage discovery |
| `marathonmoa.ts` | Discovery index and owned detail official-homepage discovery |
| `runningmap.ts` | Discovery index and owned detail official-homepage discovery |
| `marathonmate.ts` | Discovery index and owned detail official-homepage discovery |

Adapters must fail independently. A source outage produces metadata and a UI warning, but does not block a Pages artifact from being generated.

## Security and Deployment Boundaries

- No database, API server, account system, Google service account, service key, GitHub Secret, Public Data/ODCloud API, CSV fallback, or production browser scraper exists.
- The build job receives `contents: read` only.
- The deploy job alone receives `pages: write` and `id-token: write`.
- Generated data is never pushed back to the repository.
- Public collection is limited to public schedule/detail pages; no authentication, CAPTCHA, administrative route, or access-control bypass is allowed.
- Application and official seeds share the public non-payment and private-basename policy. Application seeds are valid only for traversal inspection, never for publication. Official-page candidates additionally reject exact `register`/`registration`/`apply`/`application`/`entry`/`signup`/`sign-up`/`join`/`enroll` basenames with or without a server extension; case and backslash variants are equivalent, while longer benign basenames remain valid. This official policy is enforced at discovery, enrichment, live initial/redirect resolution, merge, and schema publication. In live mode, hostnames and every redirect are resolved and rechecked before requesting; localhost, `.local`, dedicated payment hosts/paths, private, loopback, link-local, multicast, and otherwise blocked addresses are rejected. Manually mislabeled official registration candidates are rejected before loader invocation. Each live request is pinned to one validated address to prevent DNS rebinding.
- Live traversal transport sends only `Accept` and the descriptive User-Agent, follows at most two separately validated redirects, does not retry, accepts HTML/XHTML/plain text only, stops at 1 MiB, and times out. A verified final HTTP official page is allowed after all gates pass, while HTTPS remains preferred.
- Fixture mode does not use the remote URL/DNS transport. Exact URL mappings select trusted local test files, the fixture loader confines mapped paths to its fixture directory, and no network request is made.
- Logo extraction in fixture and live collection is parse-only over already-owned HTML. It never downloads the candidate image and does not add to adapter detail or official loader budgets.
- Official collection does not execute page JavaScript and therefore does not support browser-render-only content.
- Course values are never inferred from race names, page-wide navigation text, or unrelated distance fragments.

The default browser route is the homepage; `#/calendar` is the calendar and remains compatible with static GitHub Pages hosting. Homepage search, region/course/status/reset, and favorite controls are visible disabled/read-only previews. Homepage year/month selects retain every month section in the DOM: year limits sections to that year, month limits by month number within the selected year or across all years, and changing year resets month. A specific year or month focuses the first visible heading; empty data disables both selectors with honest options. Calendar filters remain active exact-AND controls; empty values are wildcards, filtering/reset preserve the displayed month, and only previous/next change it. `raceHref()` returns `officialSiteUrl ?? null`. Homepage rows and calendar events create anchors only for that non-null official URL; otherwise they render non-clickable race content with no hover, focus, click, or pointer affordance. `applicationUrl` is accepted official registration or page data, but it never serves as a UI href.

Homepage weather is a browser-only runtime boundary, separate from the build-time `races.json` pipeline. `home-weather-client.ts` requests low-accuracy browser geolocation once per application session, rounds successful coordinates to two decimal places, and starts one required Open-Meteo forecast request plus independent Open-Meteo air-quality and OpenStreetMap Nominatim reverse-geocode requests. `home-weather-model.ts` parses every external JSON boundary with Zod and reduces Nominatim output to city/district names before `home-weather.ts` renders it with visible attribution. The fixed Seoul City Hall fallback uses the known `서울특별시 중구` label without calling Nominatim. The shared promise prevents hash-route reconstruction from repeating location/API requests; disconnected panels are not mutated. Coordinates are not rendered, persisted, or logged. Air-quality or city lookup failures degrade only those fields, while a forecast failure remains isolated to the hero panel.

Shared brand surfaces respond to `prefers-color-scheme` without changing routing or data. Base semantic dark values live in `style.css`; homepage/calendar-specific canvas, filters, borders, headings, links, thumbnails, and elevation live in `shared-brand-tokens.css`. The split prevents light surfaces from inheriting dark global text while retaining one token source per role.

The browser alone loads an accepted remote event logo. Monthly-row images are decorative, lazy, low priority, asynchronously decoded, and use `referrerpolicy="no-referrer"`; collection, build, and validation never download the image, and no remote logo is cached or proxied by the application. A missing `logoUrl` starts with project-relative `public/logo1.png`, while a remote load error clears its handler and switches to `logo1.png` exactly once. Both homepage and calendar headers use project-relative `public/logo2.png`; header branding does not participate in event-logo extraction or fallback selection.
