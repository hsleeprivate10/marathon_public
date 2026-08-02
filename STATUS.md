# Current Status

## Completed

- Replaced the original SQLite and Google Sheets design with a static TypeScript pipeline.
- Added nine independently failing source adapters and a Zod-validated canonical JSON contract.
- Added normalization, deterministic sort, source metadata, fixture-based tests, static Vite calendar, filters, freshness display, and partial-source warning.
- Added a least-privilege daily GitHub Actions Pages artifact workflow.
- Added architecture, operations, and development handoff documents.
- Filtered page headings and leaked HTML fragments before publishing `races.json`.
- Limited courses to explicit source data for `풀`, `하프`, `10K`, and `5K`; sources without distance data publish an empty course list.
- Derived broad regions from explicitly named venues so the region filter has live options.
- Kept mobile event metadata visible while limiting grid cards to titles; tablet titles truncate to one line to prevent vertical Korean word breaks.
- Constrained filter controls to their grid track and limited course filters to the four canonical course values.
- Kept region, course, and registration-status filters on the displayed month with exact AND semantics and empty-value wildcards.
- Added optional verified `officialSiteUrl`, conservative race-bound traversal evidence across all nine adapters, and post-deduplication official-page enrichment.
- Unified `applicationUrl` and `officialSiteUrl` publication behind one public non-payment URL policy, including dedicated payment host and payment/checkout/billing/purchase path rejection.
- Added bounded traversal budgets of 40 external fetches per run, 2 per race chain, 10 per host, and 3 child links per accepted page, plus zero-network local fixture mappings and live-only SSRF/redirect/content/body safety boundaries.
- Added a homepage weather panel with current city/district, temperature, humidity, cloud cover, wind, precipitation, US AQI, PM2.5, and PM10. Browser location uses two-decimal coordinates, falls back to `서울특별시 중구`, and keeps forecast, city lookup, and air-quality failures isolated.
- Current UI link behavior uses only `officialSiteUrl` for homepage rows and calendar events. Races without `officialSiteUrl` render as non-clickable content with no hover, focus, or click affordance; `applicationUrl` remains accepted official registration or page data but is not used as a UI href. Current collection writes and deploys valid empty output when at least one source succeeds but zero official races are accepted, while all-source failure still fails closed and preserves existing output.
- Added MarathonGo as the second schedule adapter. Its list/detail pages provide source-detail identity and application traversal evidence only; fixture proof publishes the external final official URL and never a MarathonGo or source application URL.
- Added owner-approved MarathonGo owned-detail provenance for missing official date/venue after external same-race identity. The contract is date/venue-only, conflict-rejecting, and adds `marathongo` to `sources` only when a field is actually filled; `sourceDetailUrl` remains private.
- `race-event-logos` 작업이 완료됐다. 모든 계획 체크박스와 최종 검증 wave F1, F2, F3, F4가 완료 및 `APPROVE` 상태이며, 공개 계약에는 선택적 `logoUrl`만 추가됐다. 대회별 로고는 신뢰 가능한 HTTPS 이벤트 전용 증거에서만 게시하고, 없거나 실패하면 `logo1.png`로 한 번만 fallback한다. 홈페이지와 캘린더의 공유 브랜드는 `logo2.png`를 사용한다.

## Fresh Verification Evidence

Todo 10 documentation alignment is recorded in `.omo/evidence/task-10-multi-hop-race-page-traversal.txt`. On 2026-07-31, the docs were aligned with the implemented nine-source bounded traversal contracts and the current verified fixture/UI evidence. The session evidence available before this doc update reported 1049 unit tests passing, 70 full E2E scenarios passing, and the current visual manifest passing. This doc update did not claim a new live collection, production deployment, or GitHub Pages update.

Multi-hop fixture evidence from Todo 7 recorded `metadataCount=10`, source IDs `gorunning,marathongo,kormarathon,emarathon,maedal,kaaf,marathonmoa,runningmap,marathonmate,official-sites`, MarathonGo success, `officialRecordCount=3`, `raceCount=3`, and final MarathonGo official URL `https://saunarun-official.example.org/2026`, with no source or MarathonGo URL published. Todo 9 browser evidence recorded home and calendar anchors at 375, 768, and 1280 widths for the MarathonGo final official URL and a verified HTTP official URL, while pending rows stayed non-clickable and displayed `공식 홈페이지 확인 중`.

Todo 10 release verification is recorded in `.omo/evidence/task-10-fixed-month-official-site-enrichment.md`. On 2026-07-17, the exact fixture release sequence passed: frozen install made no changes; typecheck and lint passed; Bun and Vitest each passed 284 tests across 20 files; fixture collection, schema validation, and production build passed. The TypeScript no-excuse checker reported no violations in all 46 changed TypeScript files.

One earlier live collection exited successfully before the multi-hop traversal work, and its generated artifact passed schema validation and a production build. That historical run is not evidence that the current nine-source traversal collected live races or that production was updated. Current live success is reserved for final QA. External race, source, seed, and accepted counts are observations rather than release assertions; partial source failure remains an allowed valid outcome.

The later payment/public URL policy verification is recorded separately in `.omo/evidence/payment-public-url-policy.md`: both current full runners pass 397 tests across 23 files, including contract, parser, merge, enrichment, discovery, all-adapter, detail-fallback, redirect, encoded-path, and punctuation-boundary coverage. The Todo 10 counts above remain a historical snapshot of that earlier release run.

Exact JSON-LD Event typing and extension-suffixed private path verification is recorded in `.omo/evidence/exact-event-private-path-boundaries.md`. Discovery and parsing now share one case-sensitive exact predicate, and the shared publication/fetch policy rejects private basenames with the seven supported server extensions across discovery, application, schema, initial, and redirect boundaries. Both full runners pass 553 tests across 33 files.

Failure QA exercised both an absent official fixture index and a present index with a missing URL mapping. Both retained the base race, produced schema-valid output with zero accepted enrichment, made zero live official fetch calls, and removed their temporary directories. The absent index correctly made the enrichment stage unsuccessful; the ordinary missing-mapping rejection did not. The existing Todo 9 production Playwright evidence remains the browser proof for fixed-month filters and official/application link selection; Todo 10 changed documentation only and did not rerun the UI.

On 2026-07-19, the weather and location release checks passed: Bun and Vitest each passed 710 tests across 39 files; TypeScript strict checking, Biome, the TypeScript no-excuse checker, and the production Vite build passed; Playwright passed 29 production browser scenarios. Six fresh weather captures cover 375px, 768px, and 1280px in light and dark modes, and two independent visual reviews found no clipping, overflow, CJK wrapping, logo overlap, or runner overlap.

`race-event-logos` 최종 완료 증거는 `.omo/plans/race-event-logos.md`, `.omo/evidence/final-compliance.md`, `.omo/evidence/final-quality.md`, `.omo/evidence/final-visual.md`, `.omo/evidence/final-scope.md`에 기록되어 있다. 계획의 Todo 1부터 11까지와 F1부터 F4까지 모두 체크됐고, F1 compliance, F2 quality/security, F3 visual/browser, F4 scope audit가 모두 `APPROVE`로 끝났다.

최종 F3 시각 검증은 `logo2.png` preload 제거 뒤 다시 실행됐으며 mobile과 desktop Lighthouse 중앙값이 모두 `100/100/100/100`이다. 같은 최종 증거에서 targeted Playwright는 `46 passed`, targeted Biome은 exit 0, typecheck는 exit 0, build는 exit 0으로 기록됐다. F2 최종 품질 증거도 typecheck, lint, Bun, Vitest, full Playwright E2E, `git diff --check` 통과를 기록한다. LSP diagnostics는 TypeScript/Biome LSP 서버가 설치되어 있지 않고 이전에 설치가 거절되어 실행할 수 없었으며, 대신 compiler, Biome, unit, integration, E2E gate를 사용했다.

QA 뒤 `public/races.json`은 계속 absent 상태다. `dist/races.json`은 로컬 build와 static audit를 위한 생성 artifact일 뿐 커밋 데이터가 아니며, 최종 scope 증거도 생성 JSON을 저장소 파일로 다루지 않는 현재 운영 방침을 확인했다. 새 라이브 수집 성공이나 원격 GitHub Pages 배포 완료는 이 문서에서 주장하지 않는다.

## Known Gaps

- Region inference is deliberately conservative: it only classifies venues that explicitly mention a province or metropolitan city. Unclassified races remain available under the all-regions view.
- Live parser selectors remain inherently fragile across all external sources. Refresh fixtures whenever a source count unexpectedly drops or a source changes its markup.
- Official-site traversal is conservative and can omit unlabeled, browser-render-only, unavailable, generic, source self-link, wrong-race, payment, private, admin, API, or stale 404 pages. Enrichment failures, source outages, and traversal budgets leave accepted official races only; source fields are not fallback publication data.
- Official identity and field parsing are limited to explicit received HTML/JSON-LD; the collector does not execute JavaScript, use Public Data/ODCloud API, CSV fallback, service keys, GitHub Secrets, a browser scraper, a database, a server, log in, submit forms, or follow registration/payment flows.
- The collector has no persisted historical baseline by design. It cannot show what changed between days.
- `races.json` is an artifact, not a committed repository file. A remote GitHub Actions run is needed to validate Pages deployment.
- Public Nominatim usage is suitable only while aggregate end-user traffic remains well below one request per second. Move city lookup behind a caching proxy or replace the provider before traffic approaches that limit.

## Recommended Next Agent Steps

1. Confirm the GitHub Actions Pages run completes after the weather release push.
2. Run `workflow_dispatch` when remote deployment verification or an immediate data refresh is desired.
3. Refresh the affected adapter fixture, official-page fixture mapping, and red-green parser test whenever public markup changes.
4. Expand region inference only when a new, reliable venue-to-region source becomes available.
