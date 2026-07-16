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

Before changing a parser, add or update a fixture assertion that would fail before the parser change. Keep TypeScript files below 250 pure lines by splitting parse, network, and presentation concerns.

## Adding or Repairing a Source

1. Confirm its public list/detail path and robots policy manually.
2. Capture a minimal sanitized public HTML/XML fixture under `tests/fixtures/<source>/`.
3. Write a failing fixture test.
4. Parse only fields that are actually present; use `null` for unavailable deadline/price.
5. Normalize only explicitly published course aliases through `src/courses.ts`; unsupported or missing distances produce no course entry.
6. Never add a default `마라톤` course or infer a course from unrelated page text. Keep a known course's fee `null` when no fee is published.
7. Return a typed `AdapterResult` with source metadata rather than throwing through the orchestrator.
8. Run the full local release check in `OPERATIONS.md`.

## UI Work

`DESIGN.md` is the visual contract. Keep the desktop seven-day grid, mobile event-list fallback, visible form labels, keyboard-accessible controls, source-failure notice, and generated timestamp. Run browser visual QA at 375px, 768px, and 1280px after UI edits.

## Deliberately Out of Scope

- Historical data/change tracking
- User submissions and accounts
- A runtime API/backend/database
- Source logins, CAPTCHA handling, or browser-rendered scraping
- Direct registration/payment flows
