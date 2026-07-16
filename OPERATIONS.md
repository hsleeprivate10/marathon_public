# Operations Runbook

## One-Time GitHub Setup

1. Create a GitHub repository and place this project on its default branch.
2. In **Settings → Pages**, select **GitHub Actions** as the publishing source.
3. Open **Actions → Collect and deploy marathon calendar** and run it manually once.
4. Confirm the deploy job reports a Pages URL and open `/races.json` on that URL.

The workflow runs daily at `06:20 UTC`. GitHub schedules can be delayed, so `workflow_dispatch` is the recovery path for a missed schedule.

## Local Release Check

```bash
bun install
bun run typecheck
bun run lint
bun test
bun run test
bun run collect -- --fixture tests/fixtures
bun run validate
bun run build
```

`bun test` matches the GitHub Actions test step. `bun run test` executes the same fixture suite through Vitest so both supported test paths remain healthy.

Use `bun run collect` only for a conservative live public-source check. It writes `public/races.json`, which is ignored by Git. The next Vite build copies it to `dist/races.json`.

## Reading Collection Health

Inspect `public/races.json`:

```json
{
  "generatedAt": "...",
  "collectionMetadata": [
    { "id": "gorunning", "attempted": true, "succeeded": true, "recordCount": 0, "message": "..." }
  ]
}
```

- `succeeded: false`: request or parsing failure. The public page shows the source in its partial-collection notice.
- `succeeded: true` with `recordCount: 0`: response was readable but yielded no parser matches. Treat this as a parser/data-quality investigation, not as proof that no events exist.
- Registration fees, deadlines, and application URLs require confirmation at the organizer link before registration.

## Source Policy

- Keep requests sequential and bounded per adapter.
- Preserve the descriptive User-Agent in `src/adapters/types.ts`.
- Do not add logins, headless-browser bypasses, CAPTCHA solving, hidden APIs, or aggressive retries.
- Update fixture HTML and parser tests together whenever a source layout changes.

## Remote-Only Checks

These require an actual GitHub repository and cannot be proved locally:

- GitHub cron execution and delay behavior
- OIDC Pages deployment
- `upload-pages-artifact` to `deploy-pages` integration
- Published Pages URL and CDN cache behavior
