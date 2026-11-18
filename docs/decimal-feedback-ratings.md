# Decimal peer feedback ratings

Peer feedback accepts 1.0–5.0 in exact tenths. Self assessments remain whole-number ratings. Quick and Card Review share nullable state: focusing a slider does not answer a category; moving it, pressing Enter/Space, or releasing a pointer deliberately commits a score. Clear restores null; Skip remains distinct. Empty categories are omitted from submissions, never saved as zero.

## Implementation map

- `prisma/schema.prisma` and `20261120000000_decimal_feedback_ratings`: `FeedbackRating.rating`, `InternalRatingContribution.submittedRating`, and `PlayerInternalRatingEvent.submittedRating` become PostgreSQL NUMERIC(3,1). The latter two must preserve the exact submitted peer score for approval/replay/audit compatibility. Existing internal current ratings, deltas, weights, reviewer snapshots, self assessments, and learning rates retain their original types.
- `src/common/feedback-rating.ts`, `inputs.ts`, `models.ts`, `src/feedback/rating.resolver.ts`: strict number/range/tenth validation, GraphQL Float inputs/outputs, explicit Prisma Decimal to JSON number conversion. The approval subtype has its own field resolver. Missing entries remain optional; existing submission validity rules still apply.
- `feedback-rating-slider.tsx`, `feedback-quick-ratings.tsx`, `feedback-category-card.tsx`: one accessible native range control with exact keyboard tenths, pointer/touch input, filled track, one-decimal value and clear action. Original card images, navigation, comments, and match state remain in place.
- Feedback cards, review summary and approval cards show individual values to one decimal; retained read-only stars fill proportionally. Analytics averages retain full calculation precision and display two decimals; individual samples display one.
- Internal rating algorithm version and coefficients are unchanged. Decimal equality prevents comment edits from spuriously replaying contributions. Historical approved contributions are not recalculated by this migration.
- SQL analytics/profile calculations consume fractional ratings. The migration invalidates derived player profile caches; it does not enqueue comment extraction, change privacy permissions, regenerate embeddings, or call an LLM.

The API rejects 0, 5.5, 3.55, NaN, Infinity and noncanonical floating arithmetic artifacts. It validates before writes, without rounding. PostgreSQL preserves existing range CHECK constraints and stores exact tenths. PostgreSQL NUMERIC typmod coercion itself can round finer direct-SQL inputs; applications must use the validated API rather than rely on the type to reject excess precision.

## Railway rollout

No production migration or deployment was executed as part of this change. Before deployment:

1. Select the intended Railway project, environment and PostgreSQL service. Verify the backend DATABASE_URL points to that database without exposing credentials. Keep an isolated QA database. Take a restorable PostgreSQL backup and test restore to a separate database.
2. Test this migration and the complete new backend on QA. Regenerate Prisma Client with `pnpm prisma:generate`; build with `pnpm build`. Do not run `prisma migrate dev`, `db push`, reset, seed, or rating backfills against production for this rollout.
3. Coordinate a maintenance window for backend cutover. Drain old backend processes/workers, apply `pnpm prisma:deploy` using the selected environment's DATABASE_URL, and start the newly built backend. Three ALTER TYPE operations can acquire exclusive locks/rewrite tables; estimate duration on a representative copy first. The migration has a five-second lock timeout and explicit transaction. Investigate a failed migration and PostgreSQL state before using Prisma migration resolution; never blindly mark it applied.
4. Verify the new backend returns numeric Float scores, accepts 4.7, rejects 3.55, and still requires authorized approval. New code checks all three storage column types before writing ratings and refuses unmigrated storage. This is a deployment guard, not a replacement for the migration.
5. Deploy the new frontend only after backend verification. Whole-number values supplied through the new Float input still work; explicit GraphQL Int variable declarations for Float positions must be updated. Old backend versions validate integers and have an Int-oriented Prisma client: do not route decimal traffic through them or assume old/new backend versions can safely overlap during this schema cutover.
6. Rebuild stale SQL profiles using the existing worker or the command below, then verify feedback history, approval and analytics. Existing publication, moderation, approval and analytics permissions still determine eligibility. Ratings-only profiles need neither comments nor embeddings.

Run from the backend directory, with the intended target's environment variables available. Local example (the explicit env file should refer to the local database):

```sh
pnpm feedback:process profiles-all --env-file .env
pnpm feedback:ready --env-file .env
```

For an explicitly authorized Railway production shell, use the injected backend environment and name the intended database (replace `YOUR_DATABASE`):

```sh
pnpm feedback:process profiles-all --allow-remote --allow-production --confirm-database YOUR_DATABASE
pnpm feedback:ready --allow-remote --allow-production --confirm-database YOUR_DATABASE
```

The CLI prints a sanitized database target; verify it before proceeding. `profiles-all` rebuilds stale SQL caches only and does not call paid providers. Do not run extraction, `ratings:backfill`, or historical event replay for this migration. Ordinary feedback changes continue to invalidate caches through existing services.

## Rollback

Prefer a forward fix once decimal scores exist. Back up before any rollback. Reverting just application code is unsafe because old Prisma clients expect integer columns. To return to integer storage, first stop decimal submissions/workers and explicitly check **all three** columns for fractional values. If any exist, stop: do not round, truncate or delete them. Keep decimal storage and deploy a compatible fix, or explicitly plan a separately approved recovery that preserves those records.

For an integer-only database, a DBA can review the following transactional schema rollback after backup and application shutdown. This is documentation, not an automatically executed migration:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "FeedbackRating", "PlayerInternalRatingEvent", "InternalRatingContribution" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "FeedbackRating" WHERE rating <> trunc(rating))
  OR EXISTS (SELECT 1 FROM "PlayerInternalRatingEvent" WHERE "submittedRating" <> trunc("submittedRating"))
  OR EXISTS (SELECT 1 FROM "InternalRatingContribution" WHERE "submittedRating" <> trunc("submittedRating"))
  THEN RAISE EXCEPTION 'Fractional ratings exist; rollback refused'; END IF;
END $$;
ALTER TABLE "FeedbackRating" ALTER rating TYPE integer USING rating::integer;
ALTER TABLE "PlayerInternalRatingEvent" ALTER "submittedRating" TYPE integer USING "submittedRating"::integer;
ALTER TABLE "InternalRatingContribution" ALTER "submittedRating" TYPE integer USING "submittedRating"::integer;
COMMIT;
```

Prisma does not provide automatic down migrations. Reconcile migration history using a reviewed forward migration/recovery plan before redeploying. Do not edit/delete an applied migration or blindly change `_prisma_migrations`. The SQL above does not replay any historical internal rating events.

## Verification

Backend tests cover legacy integer conversion without changes to internal state/event history; strict decimal validation; Float GraphQL submission/approval serialization; exact storage; pending approval concurrency/idempotence; comment-only edits; individual/combined multi-match semantics; SQL averages/trends and ratings-only player profiles. Frontend tests cover null/skip/clear, descriptions, precise keyboard controls, shared mode state, submission payloads, and approval/history formatting. Browser tests exercise real mouse and touch input, mobile overflow and decimal mode/match state.

Local migration verification used a disposable database populated with the prior integer schema and a real contribution before applying the new migration. Historical 4 became 4.0 while its internal current rating, revision and audit events stayed unchanged. The local application database was backed up before applying the migration; production was not accessed.
