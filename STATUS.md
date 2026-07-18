# Current Status

## Completed

- Replaced the original SQLite and Google Sheets design with a static TypeScript pipeline.
- Added eight independently failing source adapters and a Zod-validated canonical JSON contract.
- Added normalization, deterministic sort, source metadata, fixture-based tests, static Vite calendar, filters, freshness display, and partial-source warning.
- Added a least-privilege daily GitHub Actions Pages artifact workflow.
- Added architecture, operations, and development handoff documents.
- Filtered page headings and leaked HTML fragments before publishing `races.json`.
- Limited courses to explicit source data for `풀`, `하프`, `10K`, and `5K`; sources without distance data publish an empty course list.
- Derived broad regions from explicitly named venues so the region filter has live options.
- Kept mobile event metadata visible while limiting grid cards to titles; tablet titles truncate to one line to prevent vertical Korean word breaks.
- Constrained filter controls to their grid track and limited course filters to the four canonical course values.
- Kept region, course, and registration-status filters on the displayed month with exact AND semantics and empty-value wildcards.
- Added optional verified `officialSiteUrl`, conservative race-bound link discovery across all eight adapters, and post-deduplication official-page enrichment.
- Unified `applicationUrl` and `officialSiteUrl` publication behind one public non-payment URL policy, including dedicated payment host and payment/checkout/billing/purchase path rejection.
- Added a global 40 official candidate loader-invocation budget without limiting published races, plus zero-network local fixture mappings and live-only SSRF/redirect/content/body safety boundaries.

## Fresh Verification Evidence

Todo 10 release verification is recorded in `.omo/evidence/task-10-fixed-month-official-site-enrichment.md`. On 2026-07-17, the exact fixture release sequence passed: frozen install made no changes; typecheck and lint passed; Bun and Vitest each passed 284 tests across 20 files; fixture collection, schema validation, and production build passed. The TypeScript no-excuse checker reported no violations in all 46 changed TypeScript files.

One subsequent live collection exited successfully, and its generated artifact passed schema validation and a production build. Invariant parsing found all eight adapter metadata IDs plus `official-sites` and parsed an official `fetched` loader-invocation value within the budget of 40. This run published no `officialSiteUrl`; deterministic schema and live safe-transport suites cover URL rejection behavior. External race, source, candidate, and accepted counts are observations rather than release assertions; partial source failure remains an allowed valid outcome.

The later payment/public URL policy verification is recorded separately in `.omo/evidence/payment-public-url-policy.md`: both current full runners pass 397 tests across 23 files, including contract, parser, merge, enrichment, discovery, all-adapter, detail-fallback, redirect, encoded-path, and punctuation-boundary coverage. The Todo 10 counts above remain a historical snapshot of that earlier release run.

Exact JSON-LD Event typing and extension-suffixed private path verification is recorded in `.omo/evidence/exact-event-private-path-boundaries.md`. Discovery and parsing now share one case-sensitive exact predicate, and the shared publication/fetch policy rejects private basenames with the seven supported server extensions across discovery, application, schema, initial, and redirect boundaries. Both full runners pass 553 tests across 33 files.

Failure QA exercised both an absent official fixture index and a present index with a missing URL mapping. Both retained the base race, produced schema-valid output with zero accepted enrichment, made zero live official fetch calls, and removed their temporary directories. The absent index correctly made the enrichment stage unsuccessful; the ordinary missing-mapping rejection did not. The existing Todo 9 production Playwright evidence remains the browser proof for fixed-month filters and official/application link selection; Todo 10 changed documentation only and did not rerun the UI.

## Known Gaps

- Region inference is deliberately conservative: it only classifies venues that explicitly mention a province or metropolitan city. Unclassified races remain available under the all-regions view.
- Live parser selectors remain inherently fragile across all external sources. Refresh fixtures whenever a source count unexpectedly drops or a source changes its markup.
- Official-site discovery is conservative and can omit unlabeled or browser-render-only pages. Enrichment failures, source outages, and the 40-loader-invocation budget leave base races intact.
- Official identity and field parsing are limited to explicit received HTML/JSON-LD; the collector does not execute JavaScript, log in, submit forms, or follow registration/payment flows.
- The collector has no persisted historical baseline by design. It cannot show what changed between days.
- `races.json` is an artifact, not a committed repository file. A remote GitHub Actions run is needed to validate Pages deployment.

## Recommended Next Agent Steps

1. Review the dirty worktree and Todo 10 evidence before deciding on any commit; this task intentionally creates no commit.
2. Configure GitHub Pages and run `workflow_dispatch` once when remote deployment verification is desired.
3. Refresh the affected adapter fixture, official-page fixture mapping, and red-green parser test whenever public markup changes.
4. Expand region inference only when a new, reliable venue-to-region source becomes available.
