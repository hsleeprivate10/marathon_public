# Operations Runbook

## One-Time GitHub Setup

1. Create a GitHub repository and place this project on its default branch.
2. In **Settings → Pages**, select **GitHub Actions** as the publishing source.
3. Open **Actions → Collect and deploy marathon calendar** and run it manually once.
4. Confirm the deploy job reports a Pages URL and open `/races.json` on that URL.

The workflow runs on every `main` push and daily at `06:20 UTC`. GitHub schedules can be delayed, so `workflow_dispatch` is the recovery path for a missed schedule.

Open-Meteo and OpenStreetMap Nominatim are non-blocking browser runtime dependencies, not part of the collection or Pages build. A forecast outage must produce only the hero's unavailable-weather message; air-quality and reverse-geocode outages must degrade only their own fields. None may block race data, navigation, or deployment. Browser geolocation denial, timeout, or lack of support must use the fixed Seoul fallback without calling Nominatim. Current-position reverse geocoding is limited to one end-user-triggered request per application session, carries the browser Referer, and displays OpenStreetMap attribution. Keep aggregate traffic well below the public Nominatim limit of one request per second; use a caching proxy or replace the provider before traffic approaches that limit.

## Local Release Check

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run test
bun run collect -- --fixture tests/fixtures
bun run validate -- --file .tmp/races.fixture.json
bun run collect
bun run validate
bun run build
```

`bun test` matches the GitHub Actions test step. `bun run test` executes the same fixture suite through Vitest so both supported test paths remain healthy.

Use `bun run collect` only for a conservative live public-source check. It writes `public/races.json`, which is ignored by Git. The next Vite build copies it to `dist/races.json`.

Fixture collection writes `.tmp/races.fixture.json`, outside the deployable `public/` directory. It reads adapter captures from `tests/fixtures/<adapter>/` and exact official URL-to-file mappings from `tests/fixtures/official-sites/index.json`. These mappings select trusted local test files, and the fixture loader confines targets to its fixture directory. Fixture mode does not invoke live DNS/IP/redirect handling and must remain zero-network. A missing/invalid index is a stage-initialization failure (`official-sites.succeeded: false`); a missing mapping or file is an ordinary rejected candidate reported in the message while the stage can remain successful. Never add a live fallback to fixture mode.

For a fixture-only release gate that must not alter `public/races.json`, use the pinned Bun binary and run the following commands in order:

```bash
/home/lhs/.bun/bin/bun run typecheck
/home/lhs/.bun/bin/bun run lint
/home/lhs/.bun/bin/bun test
/home/lhs/.bun/bin/bun run test
/home/lhs/.bun/bin/bun run collect -- --fixture tests/fixtures
/home/lhs/.bun/bin/bun run validate -- --file .tmp/races.fixture.json
/home/lhs/.bun/bin/bun run build
/home/lhs/.bun/bin/bun run test:e2e
```

Afterward, require schema-valid `.tmp/races.fixture.json` and `dist/races.json`, and require `dist/logo1.png` and `dist/logo2.png` to exist with non-zero size. Fixture collection must still pass when network transports throw: logo extraction parses only captured adapter/official HTML and never downloads a candidate image. Keep the `.tmp` fixture only when its hash is part of release evidence; remove other temporary servers, browsers, ports, and probe artifacts.

## Reading Collection Health

Inspect `public/races.json`:

```json
{
  "generatedAt": "...",
  "collectionMetadata": [
    { "id": "gorunning", "attempted": true, "succeeded": true, "recordCount": 0, "message": "..." },
    { "id": "official-sites", "attempted": true, "succeeded": true, "recordCount": 0, "message": "candidate=0 fetched=0 accepted=0 rejected=0 budgetSkipped=0" }
  ]
}
```

- For the eight adapter records, `succeeded: false` means source request/parsing failure. `succeeded: true` with `recordCount: 0` means the source was readable but yielded no parser matches; it is not proof that no events exist.
- For `official-sites`, `succeeded` means the enrichment stage completed. Ordinary candidate load, parse, or identity rejection increments `rejected` without setting `succeeded: false`. A fixture-index initialization problem or another stage setup/execution failure sets it to `false`.
- `official-sites.recordCount` is accepted enrichment. Its message separates discovered candidates, candidate loader invocations, accepted pages, rejected candidates, and candidates skipped by budget.
- `fetched` must be at most 40 and counts candidate loader invocations, not raw HTTP requests. A live invocation can issue the initial request plus at most two validated redirects, for up to three live transport requests. The budget is not a cap on `races`; output race coverage must not be truncated when it is exhausted.
- Fixture mode and live mode fail closed when no official page is accepted. There is no source-field fallback for public dates, venues, courses, prices, registration state, notes, logos, or `applicationUrl`.
- Registration fees, deadlines, and application URLs require confirmation at the organizer link before registration.

## Source Policy

- Keep requests sequential and bounded per adapter.
- Preserve the descriptive User-Agent in `src/adapters/types.ts`.
- Do not add logins, headless-browser bypasses, CAPTCHA solving, hidden APIs, or aggressive retries.
- Update fixture HTML and parser tests together whenever a source layout changes. Every adapter must keep at least one mapped positive source-detail to official-page fixture chain and one fail-closed chain.
- Treat optional `logoUrl` as event-only official materialization data. Accept only canonical public HTTPS values tied to exact Event/SportsEvent structured data or logo-marked HTML owned by the same dated race; omit HTTP, malformed, ambiguous, generic, placeholder, favicon/touch-icon, site-header, and cross-race values.
- Logo discovery is parse-only over already owned HTML. It must not fetch image URLs, add detail requests, introduce a crawler/proxy/cache, change retries, or increase adapter detail and official loader budgets. Logo absence or rejection is non-fatal and must not reduce race coverage or mark a source failed.
- Discover official pages only from an explicit race-bound homepage label or Event/organizer structured URL whose `@type` is exactly `Event`, `http://schema.org/Event`, or `https://schema.org/Event` on an owned source detail. Never fetch source-detail application, payment, social, file, admin, or arbitrary external links.
- Publish `applicationUrl` only from an accepted official page: prefer a safe registration URL parsed there, otherwise use the accepted official page URL. Source-detail registration and payment links are never publication fallbacks.
- For each live remote official URL and redirect, extend that shared policy with exact registration destinations (`register`, `registration`, `apply`, `application`, `entry`, `signup`, `sign-up`, `join`, `enroll`) with or without a server extension. Case changes, recursive encoding, and backslashes do not bypass rejection; longer basenames such as `apiary`, `member-run`, `register-run`, and `application-guide` remain valid. The same restriction applies when merging or publishing `officialSiteUrl`. Resolve and reject blocked hostnames and IP ranges; pin the validated address; send no cookies/auth; allow at most two redirects; disable retries; enforce a 15-second request timeout, accepted text/HTML content types, and a 1 MiB response limit. A manually constructed `official-site` registration candidate is counted as rejected before loader invocation. This policy does not run against local fixture mappings.
- Official pages do not execute JavaScript. Client-render-only data remains unavailable unless it is also present in the received HTML.

## Live Invariant Check

After one live `bun run collect`, validate and build, then inspect invariants rather than external counts:

- metadata IDs include all eight adapter IDs and `official-sites`;
- parse `official-sites.message` and require loader-invocation count `fetched <= 40`;
- every published `applicationUrl` and `officialSiteUrl` passes the shared public non-payment HTTP(S) policy;
- every published `logoUrl` is canonical HTTPS event evidence; generic/favicons are absent, and races without a logo remain valid;
- the race array remains the deduplicated collection result and is not sliced to 40;
- no published field contains seeded source-list or source-detail poison values, and no source-detail application URL appears in output;
- source failures may be present and do not invalidate a schema-valid artifact.

Do not assert exact source, race, candidate, accepted, or enrichment counts. They vary with public sites. A local run also does not prove GitHub scheduling, OIDC, Pages, or CDN behavior.

## Remote-Only Checks

These require an actual GitHub repository and cannot be proved locally:

- GitHub cron execution and delay behavior
- OIDC Pages deployment
- `upload-pages-artifact` to `deploy-pages` integration
- Published Pages URL and CDN cache behavior
