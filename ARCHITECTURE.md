# Architecture

## Goal

This project serves a read-only domestic marathon calendar without an always-on server. GitHub Actions performs a daily public-web collection and GitHub Pages serves the resulting static artifact.

## Runtime Flow

```text
8 public schedule sites
  -> source adapters
  -> races + internal race-bound link candidates
  -> normalization and conservative deduplication
  -> bounded official-page identity check and enrichment
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
| `src/adapters/` | One independently failing public-source adapter per site |
| `src/adapters/types.ts` | Request policy, fixture loading, adapter result types |
| `src/normalize.ts` | Name normalization, merge, sort, conservative duplicate key |
| `src/official-sites/` | Explicit-link discovery, safe fetch policy, identity checks, parsing, and field merge |
| `src/orchestrator.ts` | Sequential collection, deduplication, bounded official enrichment, metadata aggregation, JSON write |
| `src/filters.ts` | Exact AND filtering independent of the displayed month |
| `src/collect.ts` | CLI entry point for live or fixture collection |
| `src/validate.ts` | Zod validation of generated JSON |
| `src/main.ts` | Validated-data loading and hash-route coordination |
| `src/page-model.ts` | `home`/`calendar` hash parsing and chronological month grouping |
| `src/home-page.ts` | Semantic homepage composition and month sections |
| `src/home-race-row.ts`, `src/home-art.ts` | Application-linked race rows and deterministic inline SVG art |
| `src/home-menu.ts`, `src/home-month-selector.ts` | Mobile menu and semantic year/month selector DOM behavior |
| `src/home-race-selection.ts` | Pure year/month option derivation and month-section selection |
| `src/calendar-page.ts`, `src/calendar-header.ts`, `src/calendar-grid.ts` | Calendar coordination, shared-brand header/hero, active filters, and responsive month grid |
| `src/race-link.ts` | Race-row destination policy: validated `applicationUrl` |
| `src/source-labels.ts` | Public Korean labels for failed collection-source IDs |
| `src/style.css`, `src/shared-brand-tokens.css` | Global light/dark semantic foundations and shared homepage/calendar brand tokens |
| `src/calendar*.css` | Calendar shell, controls, grid, and responsive styling |
| `src/home*.css` | Homepage tokens, layout, controls, rows, and responsive styling |
| `public/fonts/` | Project-relative Noto Sans KR WOFF2, OFL license, and font stylesheet |
| `.github/workflows/deploy.yml` | Scheduled build and artifact Pages deployment |

## Data Contract

Top-level `CollectionOutput` contains:

- `generatedAt`: ISO collection timestamp.
- `races`: normalized, date-sorted race records.
- `collectionMetadata`: one result for each of the eight source adapters plus `official-sites`, with `attempted`, `succeeded`, `recordCount`, and a human-readable `message`.

Every race has the user-required name, event date, nullable registration deadline, venue, nullable per-course price, application URL, optional verified official-site URL, notes, URL scheme when known, source IDs, verification information, and registration status. Courses are limited to explicitly observed `풀`, `하프`, `10K`, and `5K` values. A source without a supported published course contributes an empty course list; a known course without a published fee keeps a `null` price. Unknown public information is never guessed.

Adapter `discoveredLinks` are internal provenance records, not public race fields. They retain the race deduplication key, link kind, source adapter, source page, and discovery evidence. After race deduplication, candidates from every contributing source are grouped by that key. All official and application candidates share the public non-payment HTTP(S) publication policy. It rejects credentials, localhost/`.local`, non-public IP literals, dedicated `pay`/`payment`/`payments`/`checkout`/`billing` host labels, and payment/checkout/billing/purchase path segments while preserving non-dedicated labels such as `payments-marathon`. Allowed application candidates may replace `applicationUrl`, but are never fetched as official pages.

Official candidates are limited to upcoming races, ordered by event date and Korean name, and attempted until one page passes identity checks or the global 40-loader-invocation budget is exhausted. `fetched` counts candidate loader invocations, not accepted pages, published races, or raw HTTP transports. In live mode one invocation can make up to three separately validated transport requests: the initial request and at most two redirects. `official-sites.recordCount` is the accepted enrichment count; its message reports `candidate`, `fetched`, `accepted`, `rejected`, and `budgetSkipped`. Source adapter metadata continues to describe source extraction separately.

For `official-sites`, `succeeded` means the enrichment stage completed. Individual candidate load, parse, and identity rejections increment `rejected` in the message without making the stage unsuccessful. Fixture-index initialization or other stage setup/execution failures set `succeeded: false`. This differs from the eight adapter records, whose success describes source extraction.

An accepted official page cannot replace the canonical race name or event date. Before any official page load, an explicit application candidate that passes the shared public non-payment URL policy may already replace `applicationUrl`. After identity acceptance, explicit official venue and registration deadline take precedence; official canonical courses are merged; a non-null official price replaces a lower-authority price for the same course; a registration link that passes the application policy may replace `applicationUrl`; the final page URL must pass the stricter official-page policy before becoming `officialSiteUrl`; and verification state, verification/modification timestamps, and registration status are refreshed. Other absent official-page fields preserve the race values current at that point.

## Source Roles

| Adapter | Role |
| --- | --- |
| `gorunning.ts` | Detailed schedule and fee discovery |
| `kormarathon.ts` | Registration period and fee enrichment |
| `emarathon.ts` | SSR schedule and explicit course discovery |
| `maedal.ts` | Metadata-only fallback when detail content is client rendered |
| `kaaf.ts` | Official major-race verification only |
| `marathonmoa.ts` | Broad supplementary schedule discovery |
| `runningmap.ts` | Supplementary schedule discovery |
| `marathonmate.ts` | Cross-checking/secondary discovery |

Adapters must fail independently. A source outage produces metadata and a UI warning, but does not block a Pages artifact from being generated.

## Security and Deployment Boundaries

- No database, API server, account system, Google service account, or user secrets exist.
- The build job receives `contents: read` only.
- The deploy job alone receives `pages: write` and `id-token: write`.
- Generated data is never pushed back to the repository.
- Public collection is limited to public schedule/detail pages; no authentication, CAPTCHA, administrative route, or access-control bypass is allowed.
- Application and official candidates share the public non-payment and private-basename policy, but registration destinations remain valid for application publication. Official-page candidates additionally reject exact `register`/`registration`/`apply`/`application`/`entry`/`signup`/`sign-up`/`join`/`enroll` basenames with or without a server extension; case and backslash variants are equivalent, while longer benign basenames remain valid. This official policy is enforced at discovery, enrichment, live initial/redirect resolution, merge, and schema publication. In live mode, hostnames and every redirect are resolved and rechecked before requesting; localhost, `.local`, dedicated payment hosts/paths, private, loopback, link-local, multicast, and otherwise blocked addresses are rejected. Manually mislabeled official registration candidates are rejected before loader invocation. Each live request is pinned to one validated address to prevent DNS rebinding.
- Live official transport sends only `Accept` and the descriptive User-Agent, follows at most two separately validated redirects, does not retry, accepts HTML/XHTML/plain text only, stops at 1 MiB, and times out. Registration/payment links are not followed.
- Fixture mode does not use the remote URL/DNS transport. Exact URL mappings select trusted local test files, the fixture loader confines mapped paths to its fixture directory, and no network request is made.
- Official collection does not execute page JavaScript and therefore does not support browser-render-only content.
- Course values are never inferred from race names, page-wide navigation text, or unrelated distance fragments.

The default browser route is the homepage; `#/calendar` is the calendar and remains compatible with static GitHub Pages hosting. Homepage search, region/course/status/reset, and favorite controls are visible disabled/read-only previews. Homepage year/month selects retain every month section in the DOM: year limits sections to that year, month limits by month number within the selected year or across all years, and changing year resets month. A specific year or month focuses the first visible heading; empty data disables both selectors with honest options. Calendar filters remain active exact-AND controls; empty values are wildcards, filtering/reset preserve the displayed month, and only previous/next change it. `raceHref()` intentionally returns the schema-validated `applicationUrl`, including when `officialSiteUrl` is available, so race rows lead to the tested application destination.

Shared brand surfaces respond to `prefers-color-scheme` without changing routing or data. Base semantic dark values live in `style.css`; homepage/calendar-specific canvas, filters, borders, headings, links, thumbnails, and elevation live in `shared-brand-tokens.css`. The split prevents light surfaces from inheriting dark global text while retaining one token source per role.
