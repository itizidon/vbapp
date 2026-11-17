> Privacy-purpose update: see [feedback privacy model and rollout](feedback-privacy.md). New private analytics/coaching permissions replace the legacy combined flags for eligibility; historical flags are not migrated into consent.

# Deterministic player feedback profiles (Step 2)

Step 2 extends Step 1's `PlayerFeedbackAnalysisProfile`, source eligibility, observation view, invalidation functions, and worker commands. It makes no model, extraction, embedding, or internal-rating algorithm changes. Aggregation uses three scoped PostgreSQL queries per rebuild, then deterministic TypeScript classification/scoring. No LLM or embedding API is called.

## Setup and commands

Build and explicitly migrate the intended environment before running the new queries or worker:

```bash
pnpm build
pnpm prisma:deploy
```

This implementation does not deploy to Railway or migrate a production database automatically.

With deployment environment variables already injected:

```bash
pnpm feedback:process profiles 100
pnpm feedback:process profiles-all 100
pnpm feedback:process profile PLAYER_UUID SPORT_UUID
```

For the local backend `.env`:

```bash
node --env-file=.env dist/src/feedback-processing/cli.js profiles 100
node --env-file=.env dist/src/feedback-processing/cli.js profiles-all 100
node --env-file=.env dist/src/feedback-processing/cli.js profile PLAYER_UUID SPORT_UUID
```

`profiles` processes one bounded batch; `profiles-all` drains available stale batches until none can complete. Failed profiles back off for 60 seconds, and busy player locks are skipped for a later invocation. `profile` forces one specified profile rebuild. These commands require no OpenAI key and never extract observations or regenerate vectors. The existing `work`/`watch` commands also rebuild profiles after their processing batches. The backend also runs a profile-only worker every five seconds in batches of 20, independently of extraction. It uses the same database locks, revision checks and retry backoff, and makes no provider calls. Explicit `profiles` commands remain available for maintenance. `status` includes cache staleness/error counts.

## Eligibility, identity, dates, and precision

`AnalysisEligibleFeedback` reuses Step 1's `feedback_analysis_eligible` function: published volleyball/beach-volleyball feedback, both analytics and evidence consent, and an actual approval by the assigned reviewer when approval is required. Applicable non-ALLOW moderation excludes the entire review, including numerical ratings. Unassessed/failed/pending extraction can contribute otherwise eligible numerical ratings, but processing coverage is explicitly `PARTIAL`. Weakness rankings and technique improvement classifications are withheld until extraction is complete.

Observations also pass through Step 1's live `EligibleFeedbackObservation` view, enforcing current generation, source hash, completed extraction, ALLOW moderation, and active canonical themes. Queries scope player and sport before aggregation. No match join expands feedback: one combined multi-match review counts once; individual reviews count as separate feedback IDs.

Registered reviewer IDs are accepted only through the existing authenticated submission or completed designated-reviewer approval flow. Distinct identities are counted in SQL. Names typed by guests never establish verified identity. Outputs contain reviewer counts, never individual reviewer IDs, emails, guest names, or raw evidence snippets.

All review dates use `Feedback.createdAt`, consistently across ratings, observations, summary counts, and recency. Match dates are not used because combined reviews can cover multiple matches. Windows are rolling UTC durations of 24-hour days relative to `asOf`: recent `[asOf-90d, asOf]`, previous `[asOf-180d, asOf-90d)`, and last 30 days `[asOf-30d, asOf]`. Future submissions are excluded. Current self-assessment and internal ratings are separate present-day context, not historical reconstructions.

SQL averages use only existing rated rows; missing ratings contribute neither zero nor a denominator increment. Averages are returned as double precision without presentation rounding. Missing averages/deltas are null. Classifications use a named `1e-9` tolerance around thresholds. Scores are rounded to six decimal places and tie-break by canonical theme ID, independently of input order. Identical inputs and `asOf` produce identical analytical metrics; `calculatedAt` is operational metadata.

## Skill statistics and trends

For each active existing primary skill (`attack`, `defense`, `passing`, `setting`, `serving`), the profile returns:

- Eligible numerical count, mean, and latest rated submission timestamp.
- Recent five rated reviews and preceding five, ordered by `(createdAt DESC, feedback ID DESC)`.
- 30-day, 90-day, and preceding comparable 90-day counts/averages.
- Both comparison deltas, classifications, and supporting metric explanations.
- Separately labeled current self-assessment, current weighted internal rating, peer average, and self-minus-peer gap.

`src/feedback-analysis/config.ts` defines the conservative defaults: at least five ratings **in each comparison group**, and an absolute rating delta of at least 0.30 on the existing 1–5 scale. Supported opposing five-review and 90-day directions produce `MIXED`; otherwise a supported nonstable direction is used. Both unsupported comparisons yield `INSUFFICIENT_DATA`. These are descriptive trends, not statistically proven effects.

## Theme frequency, denominators, and improvement

SQL first collapses observations to one `(theme, feedback ID)` row with separate positive/negative/neutral flags. Three negative observations in one review contribute three raw observations but one negative review. A mixed review can count once as positive and once as negative, and only once in overall theme feedback count. Therefore sentiment counts can sum to more than overall mentions.

For skill-related themes, `SKILL_WRITTEN_REVIEWS` counts the union of eligible reviews with a nonempty comment for a related skill or an eligible observation attributed to that skill, plus actual reviews mentioning the theme. For general themes, `ELIGIBLE_WRITTEN_REVIEWS` counts reviews with any written overall/per-skill feedback. This is contextual written coverage, **not proof every reviewer evaluated the exact technique**. Rating-only reviews do not inflate written denominators. Each theme exposes its denominator label, numerator, denominator, and total eligible review count. Period rates use period-specific coverage; a zero denominator produces null.

Technique classifications require five relevant written reviews and three theme-mentioning submissions in **each** period. The meaningful rate change is 0.15 (15 percentage points):

- `LIKELY_IMPROVING`: negative rate falls and positive rate rises by at least 0.15, numerical 90-day skill trend improves, and both periods have at least two verified theme reviewers.
- `POSSIBLY_IMPROVING`: positive corroboration improves with compatible evidence, but numerical/diversity support is weaker.
- `POSSIBLY_DECLINING`: negative rate rises with falling positive evidence or a declining numerical trend.
- `MIXED`: opposing supported numerical/comment signals, or rising/falling positive and negative signals together.
- `STABLE`: sufficient data without corroborated directional evidence.
- `INSUFFICIENT_DATA`: inadequate period coverage or unfinished extraction.

Fewer negative comments alone never means improvement. Missing comments are never counted as positive evidence. Every classification includes the observed counts/rates and numerical trend.

## Recurring weaknesses and evidence

Rankings require five eligible feedback IDs, at least three distinct negatively mentioning submissions for a theme, and five relevant written reviews. A feedback ID is a distinct submission, not proof of an independent person. There are at most five results.

The default weighted heuristic is:

| Component             | Weight | Normalized definition                                                                                                                                     |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low skill rating      | 0.30   | `(5 - associated peer average) / 4`; missing if fewer than five associated numerical ratings. Multiple related skills use their count-weighted peer mean. |
| Negative mention rate | 0.30   | Negative reviews / relevant written reviews.                                                                                                              |
| Reviewer agreement    | 0.20   | Distinct verified negative reviewers / distinct verified reviewers in relevant written coverage. Missing when verified coverage is zero.                  |
| Recency               | 0.10   | `max(0, 1 - daysSinceLatestNegative / 90)`.                                                                                                               |
| Persistence           | 0.10   | Negative theme-review count / all theme-review count.                                                                                                     |

Each component is clamped to `[0,1]`. Missing components receive zero weight and remaining weights are renormalized. The weighted sum is multiplied by 100. With fewer than two verified negative reviewers, the result is explicitly `LIMITED_REVIEWER_DIVERSITY`, marked tentative, and multiplied by 0.5. Typed guest names never improve reviewer agreement. At least two verified negative reviewers can support `SUFFICIENT` evidence under these heuristic thresholds. This is not a scientifically validated ranking or calibrated probability.

Raw review volume alone does not increase the normalized score. Each result includes the relevant rating count/mean, negative numerator/denominator, verified reviewer count, evidence factor, and effective component weights. Profile/skill/theme evidence statuses distinguish no data, small samples, partial processing, and limited diversity. The internal weighted skill rating algorithm is not changed or substituted for peer averages.

## Caching, invalidation, and rebuilding

The existing cache gains algorithm version, expiry, attempt/error timestamps, a sanitized error code, and retry time. The snapshot remains JSON in the existing row; no second profile table or Redis is introduced. Change `PROFILE_ALGORITHM_VERSION` whenever aggregation semantics or thresholds change.

Source changes, processing/moderation transitions, observation changes, self/internal rating changes, and catalog changes invalidate the cache transactionally. The last successful snapshot is retained privately if rebuilding fails; stale/revision-mismatched/expired/wrong-version snapshots are never served. Cache expiry is the next UTC midnight so time windows/recency advance even without new reviews.

Rebuilds use a per-player-and-sport transaction advisory lock, three batched queries, and a revision comparison before atomically replacing the snapshot. Concurrent builds skip an occupied lock; source edits during calculation prevent an obsolete commit. Queries have a five-second database statement timeout and rebuild transactions a 20-second bound. Failures retain the last snapshot, store `PROFILE_REBUILD_FAILED` without source text, and retry after 60 seconds. Source invalidation clears retry delay so new input can rebuild immediately.

A read only queues a missing profile and returns cache readiness. It does not block on a numerical rebuild. A daily-expired or outdated cache is selected by the same existing stale-profile worker path. Request-local memoization shares one cached read across multiple GraphQL analytical operations for the same actor/sport.

## Private GraphQL operations

All four operations use `GqlAuthGuard`; player identity comes only from `CurrentUser`. There is no client `userId` argument. Public account visibility does not grant access to these private analytical profiles.

- `myFeedbackAnalysisProfile(sportId: ID!)`
- `mySkillAnalysis(sportId: ID!)`
- `myThemeTrends(sportId: ID!)`
- `myTopWeaknesses(sportId: ID!)`

Each returns `state`, `rebuildQueued`, and `lastErrorCode`. The complete query returns a nullable `profile`; the others return typed skill/theme/weakness arrays. A stale cache returns null/no derived rows with `state: STALE`, which is different from a ready profile with insufficient evidence. Timestamp fields are ISO-8601 UTC strings. Percentages are fractions from 0–1 with explicit counts.

```graphql
query MyFeedbackProfile($sportId: ID!) {
  myFeedbackAnalysisProfile(sportId: $sportId) {
    state
    rebuildQueued
    lastErrorCode
    profile {
      algorithmVersion
      asOf
      totalEligibleFeedbackCount
      evidenceStatus
      skills {
        skillId
        peer {
          count
          average
        }
        trend
        ninetyDayComparison {
          recent {
            count
            average
          }
          previous {
            count
            average
          }
          delta
          explanation
        }
      }
      weaknesses {
        themeId
        priorityScore
        supportingFeedbackCount
        relevantFeedbackCount
        negativeMentionRate
        distinctVerifiedReviewers
        evidenceStatus
        components {
          name
          value
          effectiveWeight
        }
      }
    }
  }
}
```

## Verification and scope

`test/feedback-analysis-calculations.spec.ts` covers deterministic classifications, thresholds, missing components, and scores. `test/integration/feedback-analysis.integration.spec.ts` covers real SQL aggregation, dates, consent/moderation/approval, deduplication, guests, combined matches, context ratings, cache errors/races, guarded GraphQL, and player isolation. Tests use disposable migrated PostgreSQL with pgvector and no paid provider requests.

```bash
pnpm build
pnpm exec tsc --noEmit
TEST_DATABASE_URL=postgresql://... pnpm test --testTimeout=60000
pnpm lint
```

The repository's backend lint command currently requires an ESLint executable/configuration that is not installed; this existing tooling issue is reported separately from TypeScript/test results. No frontend, AI chat, drill recommendations, new embedding model, or additional analytics database is added. Existing dashboard queries remain separate from this consent-gated private coaching profile.

### Development query-plan check

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` was run on 1,000 synthetic eligible reviews/ratings/observations in a disposable PostgreSQL 17 database. After removing a repeated coverage-to-feedback join, one warm development run measured approximately 11 ms for the summary, 13 ms for skills, and 52 ms for themes, returning 1, 5, and 19 rows respectively. The earlier theme plan took about 1,015 ms and discarded roughly seven million nested-loop row pairs. No speculative indexes were added. These are local synthetic measurements, not production latency guarantees; larger catalogs and player histories should be profiled on representative infrastructure.

## Implementation map

- `src/feedback-analysis/queries.ts`: scoped summary, skill/window, and deduplicated theme/coverage SQL.
- `src/feedback-analysis/calculations.ts` and `config.ts`: trends, evidence, normalized weakness scoring, and named thresholds.
- `src/feedback-analysis/models.ts`, `service.ts`, and `resolver.ts`: typed private GraphQL results, authenticated cache access, request memoization.
- `src/feedback-processing/profiles.ts` and `cli.ts`: existing-cache extension, locks, revision checks, retries, bounded/all/single-player rebuild commands.
- `src/analytics/analytics.module.ts` and `src/schema.gql`: registration and generated API schema.
- `prisma/schema.prisma` and `prisma/migrations/20261117000000_player_feedback_profiles/migration.sql`: cache metadata, shared eligible-feedback view, source invalidation triggers.
- `test/feedback-analysis-calculations.spec.ts`, `test/integration/feedback-analysis.integration.spec.ts`, and the updated Step 1 processing integration test: deterministic metrics, SQL/auth/concurrency tests, bounded-queue test isolation.
- `README.md`, this guide, and `docs/feedback-processing.md`: setup, formulas, assumptions, and operational instructions.
