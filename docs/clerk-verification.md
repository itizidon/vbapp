# Clerk implementation and local cutover verification

The account architecture, Dashboard setup, metadata, roles, deletion behavior, environment variables, run commands and manual production cutover procedure are documented in [Clerk migration](clerk-migration.md). The pre-change dependency inventory is in [the dependency map](clerk-dependency-map.md).

## Schema changes

Identity-bearing application models now use scalar TEXT Clerk IDs: `Match`, `MatchParticipant`, `Feedback`, `PlayerInternalRating`, `PlayerInternalRatingEvent`, `SelfAssessmentRatingEvent`, `InternalRatingContribution`, `FeedbackLink`, `PlayerFeedbackAnalysisProfile`, `AiCoachConversation`, `AiCoachTurn`, `AiCoachUsage`, `FeedbackPrivacyEvent`, `Drill`, `DrillReferenceVideo`, `DrillVideoSubmission`, `PlayerSkillProgress`, and `DrillCompletion`.

`Sport`, `Skill`, `MatchTeam`, `FeedbackRating`, and `FeedbackReviewerSkillSnapshot` also receive explicit native timestamp annotations matching the existing database. Other fields in these models retain their behavior. Entity UUIDs and entity foreign keys remain intact.

`User`, `SelfAssessment`, `SelfAssessmentRating` and `PlayerTrainingProfile` are removed. The inspected custom provider/verification/OAuth tables are removed as well: `UserAuthProvider`, `OAuthTransaction`, `AuthEmailChallenge`, `AuthProviderDeletion`. Legacy calculated-rating archives are dropped. `ClerkDeletionJob` is a new transient operational outbox/receipt, not an account table. Current self-assessment and training preferences live in Clerk; immutable skill events and calculated analytics remain domain records.

## Completed local destructive operation

Target: local `localhost:5432/sports`. No QA or production database was connected to or changed.

The authorized fresh start removed 2 old accounts and cleared 34 matches, 42 feedback records and their dependent activity. Related nonempty tables before reset included 52 teams, 63 participants, 182 feedback ratings, 2 assessments/10 assessment ratings, 15 reviewer snapshots, 10 internal ratings, 40 internal-rating events, 10 self-rating events, 170 contributions, 21 feedback links, 36 request-match associations, 10 submissions, 33 analysis jobs, 2 analytical profiles, 7 AI conversations, 9 AI turns, 2 AI usage records and 42 privacy events. Three old OAuth transactions were removed. The complete inventory is captured in the backup manifest.

Preserved and fingerprint-verified: all 14 independent content tables, including the existing 4 sports, 16 skills and 19 feedback themes. The local database contained no drills/reference media to lose. Separate disposable migration fixtures verified preservation of a drill, its steps/skills, a reusable reference video and its reference pose/job while removing player submissions.

Backup created before reset:

```text
.backups/clerk/clerk-cutover-2026-11-20T22-14-32-333Z-f7ed0fa9.dump
.backups/clerk/clerk-cutover-2026-11-20T22-14-32-333Z-f7ed0fa9.json
```

The backup was restored into a separate disposable database. SHA-256 and all 55 table fingerprints matched the manifest, including the original 2 accounts, 34 matches and 42 reviews. That recovery-check database was then removed; the restricted backup remains. The live local application database now has no User table, zero old matches/reviews and unchanged catalog fingerprints. Private object storage was not deleted.

## Checks completed

- Backend build and TypeScript checks pass.
- 212 backend unit tests pass, including real RSA Clerk token verification and request-level session verification reuse.
- 183 PostgreSQL integration tests pass on a freshly migrated isolated pgvector database. The separately opt-in paid OpenAI live test was skipped.
- Frontend production build and TypeScript checks pass.
- 201 frontend tests pass, including Clerk player routes, safe return navigation and the server-side token bridge.
- 12 browser checks pass across widths 320, 375, 768, 1024, 1440 and 1920: unconfigured authentication fails closed, retired cookies grant no access, and setup/privacy pages remain usable without horizontal overflow.
- Frontend lint reports no errors and six existing warnings.
- A real local backend boot and HTTP catalog query returned Attack, Defense, Passing, Setting and Serving after the cutover.

Clerk API transport is mocked in automated domain tests; signature verification uses the actual SDK with locally signed fixtures. Live Clerk signup, Google/Facebook connections, verification-email delivery, account editing and external webhook delivery still require the user's development application credentials and Dashboard configuration. The local Clerk keys remain unconfigured at this report's creation. This implementation has not been deployed to production.
