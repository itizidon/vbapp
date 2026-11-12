# Internal player ratings V1

Self-assessments, received feedback, and internal skill ratings are separate. The current internal value starts at the first known self-rating. Later self-rating edits never reset it. Existing accounts require an explicit backfill. No historical feedback is replayed by backfill or application startup.

## Storage and transactions

- `PlayerInternalRating`: one current row per user/skill, original baseline, current Decimal(12,8), applied feedback count and revision.
- `PlayerInternalRatingEvent`: immutable initialization/application/correction/rebuild ledger, unique first application key `feedbackId:skillId`, reviewer influence snapshots, created/effective UTC times, global database sequence, revision.
- `SelfAssessmentRatingEvent`: immutable CREATED/UPDATED/BASELINE history, including old/new self-rating and a database sequence. Unchanged values produce no change event.
- `InternalRatingContribution`: private source-per-feedback-per-skill records used for deterministic replay. Reviewer influence fields cannot be changed or deleted; current submitted score/publication/eligibility may change as source feedback changes.

The existing `FeedbackReviewerSkillSnapshot` continues to mean reviewer **self-assessment**, not internal rating. Neither the submitted feedback score nor the self-rating is overwritten by calculations. Public feedback DTOs expose none of the new influence snapshots.

Database triggers record self-rating changes and initialize internal ratings within the source transaction. Signup, self-assessment edits and feedback writes acquire one PostgreSQL transaction advisory lock **before** source row locks. Read-committed reads after acquiring it see the preceding writer's committed state. This globally serializes V1 rating-affecting writes. Source feedback, snapshots, current ratings, and ledger events commit or roll back together. Serialization conflicts are retried up to three times. Application timestamps use the database clock; sequences break equal timestamp ties. Direct trusted SQL writes must acquire the same lock before taking source locks (otherwise callers may need to retry a deadlock).

The new migration adds tables, constraints and triggers without replacing existing source tables. The earlier, still-pending placeholder-removal migration archives those unused tables as `LegacyPlayerSkillRating` / `LegacyPlayerSportRating`. Do not edit a migration that has already been applied in another environment: use that environment's original migration file and a separate forward archival migration if needed. No legacy rating data is imported into this new algorithm.

## Exact algorithm

For the reviewer's matching skill rating `r`, clamp to [1,5]:

```
w = 10 ^ ((r - 1) / 2)
a = BASE_RATE * w / (w + NORMALIZATION)
k = a * reviewer_confidence
new = round_half_up(clamp(old + k * (submitted - old), 1, 5), 8)
actual_delta = new - old
```

V1 uses Prisma Decimal arithmetic. Raw weight, pre-confidence rate and final rate are rounded half-up to 12 places; current ratings and actual deltas use 8 places. Fractional reviewer ratings are supported. A new self-rated 5 reviewer has raw weight 100 but confidence 0.10: their final learning rate is 0.016666666667, not 0.20. A recipient at 3 receiving their score of 5 moves to 3.03333333. Equal feedback records a zero-delta event and still counts as evidence.

These coefficients are product assumptions, not validated measurements of playing ability or reviewer accuracy.

| Environment variable | Default |
| --- | --- |
| `RATING_BASE_RATE` | 0.20 |
| `RATING_NORMALIZATION` | 20 |
| `RATING_NEW_CONFIDENCE` | 0.10 |
| `RATING_SOME_CONFIDENCE` | 0.35 |
| `RATING_ESTABLISHED_CONFIDENCE` | 0.75 |
| `RATING_STRONG_CONFIDENCE` | 1.00 |
| `RATING_SOME_THRESHOLD` | 1 |
| `RATING_ESTABLISHED_THRESHOLD` | 5 |
| `RATING_STRONG_THRESHOLD` | 10 |
| `RATING_GUEST_CONFIDENCE` | 0.05 |

Thresholds must be increasing positive integers; rates/multipliers must be finite and valid fractions. Formula version is 1; snapshots retain actual coefficients after configuration changes. A future formula change should introduce a new algorithm version and explicit replay plan.

Confidence counts **distinct registered, currently eligible, published reviewers for the same skill**: 0 => 0.10; 1–4 => 0.35; 5–9 => 0.75; >=10 => 1.00. Reciprocal pairs do not count as independent evidence: if the prospective reviewer has also rated an evidence contributor in that skill, exclude that contributor. Guests, unpublished/deleted/hidden sources, self-feedback and daily duplicate sources do not build confidence. Skill self-assessment does not establish accuracy. Guests have weight 1 and confidence 0.05. Registered reviewers without an internal rating for that skill use weight 1 and provisional confidence 0.10; the unavailable skill snapshot stays null. No unrelated-skill average is used.

## Eligibility and source lifecycle

- Only PUBLISHED feedback with an active skill and a recipient internal baseline is eligible. Neither analytics nor evidence consent controls rating eligibility.
- One influence per reviewer/recipient/skill per UTC day. For guests, identity is the server-signed invitation nonce, not an editable name. General and match feedback share the same daily cap. Multiple legitimate submissions are still saved as feedback.
- No guessed recipient baseline: feedback received before skill initialization remains source feedback only. Backfill does not apply it. Explicitly publishing/editing a previously unprocessed source after initialization can introduce it at that new application time.
- Publication captures the reviewer's current matching internal rating and confidence once. Later reviewer changes do not alter previous contributions. A previously pending source gets snapshots at first eligible publication.
- A new eligible source appends one event. Reprocessing the same source is a no-op. Repeat requests creating separate feedback rows are rate-limited by the daily influence cap.
- A rating edit, hide, delete, removed category or restoration deterministically replays that recipient/skill's contributions from the original baseline, in contribution sequence order, using the frozen rates. The earliest currently published contribution in each identity/day window is selected. Hiding an earlier duplicate can promote the next source in that window.
- Replays increment the rating revision and append a baseline plus REBUILT events. They also append a non-chart CORRECTION event recording the actual before/after current-rating difference, even if zero. All old ledger revisions remain immutable. Current history queries return the **latest corrected timeline**, not a mixture of archived revisions. Owners can inspect all revisions through `internalRatingAudit` (ordered by recording time/sequence, including non-chart corrections, with no influence snapshots); staff with database access can also audit all revisions; no administrator role exists in the current auth model.
- Comments/consent-only changes do not affect ratings. A removed source skill is replayed out; an added skill is applied independently. Initial/source foreign keys and immutable ledgers prevent physical deletion of rating evidence; ordinary feedback deletion stays soft.

## Private GraphQL API

All rating queries require authentication and `userId` equal to the token owner, regardless of public account visibility. There is no public write endpoint for internal ratings or influence fields. Administrator access is not granted without an existing authorized admin identity/role system.

```graphql
query Current($userId: ID!, $sportId: ID!) {
  internalRatings(userId: $userId, sportId: $sportId) {
    skillId skillName initialRating currentRating feedbackCount revision algorithmVersion updatedAt
  }
}
query Internal($userId: ID!, $skillId: ID!, $from: DateTime, $before: DateTime, $cursor: String, $revision: Int) {
  internalRatingHistory(userId: $userId, skillId: $skillId, from: $from, before: $before, cursor: $cursor, revision: $revision, limit: 100) {
    revision hasMore nextCursor
    baseline { id sequence timestamp recordedAt previousRating newRating delta type }
    items { id sequence timestamp recordedAt previousRating newRating delta type }
  }
}
query Self($userId: ID!, $skillId: ID!, $from: DateTime, $before: DateTime, $cursor: String) {
  selfAssessmentHistory(userId: $userId, skillId: $skillId, from: $from, before: $before, cursor: $cursor, limit: 100) {
    revision hasMore nextCursor
    baseline { id sequence timestamp recordedAt previousRating newRating delta type }
    items { id sequence timestamp recordedAt previousRating newRating delta type }
  }
}
```

Illustrative response shape (IDs omitted here only for readability):

```json
{"internalRatingHistory":{"revision":1,"hasMore":false,"nextCursor":null,"baseline":null,"items":[{"sequence":"1","timestamp":"2026-11-11T12:00:00.000Z","recordedAt":"2026-11-11T12:00:00.000Z","previousRating":3,"newRating":3,"delta":0,"type":"INITIALIZED"},{"sequence":"2","timestamp":"2026-11-11T13:00:00.000Z","recordedAt":"2026-11-11T13:00:00.000Z","previousRating":3,"newRating":3.03333333,"delta":0.03333333,"type":"FEEDBACK_APPLIED"}]}}
```

`from` is inclusive, `before` exclusive. Baseline is the latest actual event strictly before `from`, or null if none exists. Pagination sorts timestamp then sequence, with 1–250 items per page. Pass the first page's revision for subsequent internal-history pages; corrections invalidate stale pages instead of mixing timelines. Sequence cursors are scoped to the owner/skill/revision. Pages use repeatable-read transactions so rows and baseline share a consistent view. All API timestamps are UTC. Raw weights, confidence and reviewer snapshots are absent from every history response. `internalRatingAudit(userId, skillId, from, before, cursor, limit)` returns the same page shape with per-event revision, recording-time timestamps, and a null baseline; it is an audit ledger rather than a continuous chart.

## Frontend

Analytics retains Daily Average, Each Feedback, backend category selection, win rate, 1W/1M/3M/YTD/1Y/ALL controls and the original feedback switch. The new Chart mode dropdown adds Internal Rating and Self-Assessment. Both use backend events, fixed 1–5 Y axes, actual timestamps and a step line, with paginated loading, exact-value tooltips, delta/event labels and an accessible data table. A real pre-range baseline is carried to the range opening; no baseline is invented. Initialization-only histories show their recorded initial point. All pages in the selected range are loaded before graphing.

## Rollout and backfill

No production migration/backfill is run by this implementation. The checked-in Railway configuration explicitly clears automatic pre-deploy commands. Existing external CI/deploy automation must likewise be reviewed before releasing. Do not enable the new backend on an unmigrated database.

1. Build and verify from this commit: `pnpm exec prisma generate`, `pnpm build`, `pnpm test:unit`; frontend: `npm test`, `npm run typecheck`, `npm run build`.
2. Local/QA: with that environment's `DATABASE_URL` loaded, explicitly run `pnpm prisma:deploy`. This applies forward migrations; never use reset or db push to replace existing data.
3. After building, preview `pnpm ratings:backfill --dry-run`, then explicitly run `pnpm ratings:backfill --apply`. The compiled command uses environment variables, not an automatic `.env` loader. For local development with a root `.env`, use `node --env-file=.env dist/prisma/backfill-internal-ratings.js --dry-run` / `--apply`.
4. Review the JSON counts (`examined`, missing `internalRatings`, `selfBaselines`, `initializationEvents`). A second apply should report zero changes. Baselines use the currently known self-rating and **the backfill time**, not invented original signup timestamps. Existing internal ratings are not replaced. Process is resumable in bounded 200-source batches and per-source transactions.
5. Production: take a database backup, validate the migration history on a representative QA database, then have the authorized release operator execute the migration and reviewed backfill commands in a dedicated release job using the production database connection. Coordinate these with the application rollout; prevent rating-affecting writes during the backfill window to avoid provisional missing-baseline behavior. Deploy the frontend after the API is available. No historical feedback replay is part of this release.

## Limits

V1 uses a global lock, so throughput is intentionally limited; corrections replay O(n) contributions for one skill and append a new revision. Large histories may require queued rebuilds/checkpoints and a versioned worker design. Charts load all selected events in pages, so ALL can still be expensive for unusually large ledgers. Pagination revision checks protect internal history from concurrent corrections; self-history is append-only. Confidence and daily caps reduce basic manipulation but cannot prove independent identity or prevent coordinated accounts; a new guest invite creates a new guest identity. No match outcome weighting, externally verified credentials, reputation accuracy calibration, cross-skill averaging or historical weight propagation is claimed.


## Validation performed

Backend Prisma generation, `pnpm build`, TypeScript checking and 72 unit tests passed. Eleven PostgreSQL integration tests passed against disposable databases, including initialization, self-rating independence, confidence/reciprocity, guest/missing-rating fallback, concurrent writes, idempotency, lifecycle replay, immutable audit history, private date-filtered pagination/baselines and backfill dry-run/idempotency. The seed and compiled backfill dry-run command were also exercised.

Frontend TypeScript checking, 68 unit tests and `npm run build -- --webpack` passed. Two opt-in Playwright checks passed at 375px and 1440px against a temporary production frontend/backend and disposable database; they verified feedback-driven internal changes, independent self-rating changes and responsive chart modes. To reproduce only against a disposable migrated/seeded database: set `INTERNAL_RATINGS_E2E=true` and `PLAYWRIGHT_BASE_URL` to the test frontend, then run `npm run test:e2e -- internal-ratings.spec.ts --project=width-375 --project=width-1440 --workers=1`. The default Turbopack build could not bind its CSS worker port in the execution environment; the supported webpack production build completed successfully. No production migrations or backfills were run.
