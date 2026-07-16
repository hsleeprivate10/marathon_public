# Architecture

## Goal

This project serves a read-only domestic marathon calendar without an always-on server. GitHub Actions performs a daily public-web collection and GitHub Pages serves the resulting static artifact.

## Runtime Flow

```text
8 public schedule sites
  -> source adapters
  -> normalization and conservative deduplication
  -> public/races.json
  -> Vite static build (dist/)
  -> GitHub Pages artifact deployment
  -> browser calendar and filters
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
| `src/orchestrator.ts` | Sequential collection, metadata aggregation, JSON write |
| `src/collect.ts` | CLI entry point for live or fixture collection |
| `src/validate.ts` | Zod validation of generated JSON |
| `src/main.ts` | Static browser application |
| `src/style.css` | Token-based responsive calendar styling |
| `.github/workflows/deploy.yml` | Scheduled build and artifact Pages deployment |

## Data Contract

Top-level `CollectionOutput` contains:

- `generatedAt`: ISO collection timestamp.
- `races`: normalized, date-sorted race records.
- `collectionMetadata`: one result for each source with `attempted`, `succeeded`, `recordCount`, and a human-readable `message`.

Every race has the user-required name, event date, nullable registration deadline, venue, nullable per-course price, application URL, notes, URL scheme when known, source IDs, verification information, and registration status. Courses are limited to explicitly observed `풀`, `하프`, `10K`, and `5K` values. A source without a supported published course contributes an empty course list; a known course without a published fee keeps a `null` price. Unknown public information is never guessed.

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
- Course values are never inferred from race names, page-wide navigation text, or unrelated distance fragments.
