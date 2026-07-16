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

## Fresh Verification Evidence

The following commands passed during this work session on 2026-07-16:

```text
bun run typecheck
bun run lint
bun test                # 66 passing tests
bun run test            # Vitest: 66 passing tests
bun run collect
bun run validate
bun run build
```

The TypeScript no-excuse checker also passed for the changed normalization source and tests. The current Docker Playwright smoke check verified month navigation, region filtering, filter reset, and external race links. Full-page 375px, 768px, and 1280px production captures were inspected before their temporary PNG files were removed.

## Live Collection Observation

A conservative live run was executed after refreshing parsers for the current public markup. It produced 184 deduplicated records. Adapter extraction counts were GoRunning 20, KorMarathon 2, e-Marathon 17, Maedal 10, Marathon Moa 160, RunningMap 10, and MarathonMate 8. KAAF returned no public marathon records in this run; it remains a verification-only adapter.

This is not a completeness guarantee. Each source can change markup or coverage without notice, so future agents must refresh the corresponding fixture and parser together. The UI intentionally surfaces source-level failure metadata, but a successful zero-record parse also requires operational review.

## Known Gaps

- Region inference is deliberately conservative: it only classifies venues that explicitly mention a province or metropolitan city. Unclassified races remain available under the all-regions view.
- Live parser selectors remain inherently fragile across all external sources. Refresh fixtures whenever a source count unexpectedly drops or a source changes its markup.
- The collector has no persisted historical baseline by design. It cannot show what changed between days.
- `races.json` is an artifact, not a committed repository file. A remote GitHub Actions run is needed to validate Pages deployment.
- This workspace snapshot currently has no `.git` directory, so the changes cannot be committed until the intended repository is restored or initialized.

## Recommended Next Agent Steps

1. Restore or initialize the intended Git repository, review the worktree, and create an atomic commit.
2. Configure GitHub Pages and run `workflow_dispatch` once.
3. Refresh the affected public fixture with a red-green parser test whenever an adapter count unexpectedly changes.
4. Expand region inference only when a new, reliable venue-to-region source becomes available.
