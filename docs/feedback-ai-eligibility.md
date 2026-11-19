# AI evidence eligibility and verified internal ratings

## Rules and provenance

Before this change, private AI eligibility required published feedback and required assigned-reviewer approval. Published guests were already allowed into AI when they had both new private-purpose permissions. However, the internal rating service used publication alone and could apply guest influence. Assignment was not sufficient AI authorization, but analytical reviewer counts could mistake a registered assignment for verification.

The policies are now independent:

| Source | AI Coach | Internal rating |
| --- | --- | --- |
| Authenticated author submits their own review | Eligible with both private-purpose permissions | Eligible; this existing direct submission is self-approval, recorded explicitly on new submissions |
| Assigned reviewer approves | Eligible with both private-purpose permissions | Eligible after authorized approval, once |
| Unverified guest submission | Eligible with both private-purpose permissions | Never eligible |
| Submitted assigned review awaiting approval | Eligible only with both permissions **and** the assigned reviewer's separate pending-recipient-AI disclosure | Never eligible before approval |
| Incomplete draft | Ineligible | Ineligible |
| Rejected, hidden, deleted | Ineligible | Ineligible |
| Moderation-excluded | Ineligible for extraction, profile and retrieval | AI moderation does not introduce a second rating algorithm or silently replay historical ratings |

All AI sources must be submitted, belong to volleyball, pass moderation eligibility, and have current `privateAnalyticsAllowed` and `privateCoachingAllowed` permission/timestamp/notice records. The recipient's AI setting must be enabled. Legacy `analyticsAllowed`/`evidenceAllowed` do not grant permission. Basic numerical charts and public aggregates retain their existing publication/approval and purpose rules; their counts can differ from the AI profile.

`src/feedback/eligibility.ts` exposes `isEligibleForAiAnalysis`, `isEligibleForInternalRating` and `feedbackTrust`. PostgreSQL equivalents enforce the same policies across background work, SQL profiles and retrieval. Tests exercise both. Internal rating synchronization, explicit correction replay, and confidence source queries use the verified policy; no AI view is a rating input. Guests are not used to establish reviewer confidence.

Trust labels come from backend records, never the LLM or a typed guest name:

- `VERIFIED_APPROVED`: published, authenticated author submission or recorded designated-reviewer approval, without rejection.
- `UNVERIFIED_GUEST`: no verified reviewer account.
- `AWAITING_REVIEWER_APPROVAL`: an assigned/unverified account reference. The reference itself proves neither authorship nor approval.

An older direct review qualifies as self-approved only when the recorded authenticated submitter is its reviewer and no assigned approval is required. New direct submissions also write approval timestamps/actor IDs. The migration does not invent historical approval stamps. Private backend records can retain identity for authorization/diversity calculations; Coach outputs contain classifications/counts and opaque feedback/observation references, never account names/emails or reviewer IDs. Free text can still contain identifying information, so existing moderation and source-text handling remain necessary.

## Submitted state and pending privacy

`Feedback.submittedAt` is explicit and defaults to null. Submission services set it after validating an actual completed review. Null records cannot enter AI or be approved/rejected as completed reviews. Existing non-pending records are marked submitted at their creation time because the existing app creates these records through submission. Existing pending records are marked only when they have submission/link/submitter provenance and actual ratings or written content. This conservative historical inference grants no privacy permission.

Historical pending reviews retain `pendingAiAllowed=false`. The assigned authenticated reviewer can opt in through an approval card or Feedback privacy. The separate unchecked disclosure explains that the recipient's private Coach can use ratings, insights **and comment excerpts before approval**. It requires `pending-ai-disclosure-v1`, a server timestamp, and an audit event. The recipient or a preparer cannot make this choice for the assigned reviewer. Ordinary private-purpose consent remains separately required. Revocation removes derived observations/vectors and invalidates saved answers. Approval/publication is still a different decision; raw pending feedback stays restricted to its existing authorized viewers.

No historical private flags are promoted or converted. Old pending records without this new explicit choice remain excluded, even if a prior private coaching permission exists.

## Extraction, vectors and metadata changes

The existing Step 1 extraction schema, provider, source hashing, prompt/model versions, retries, leases and embedding model are reused. Overall and skill comments remain independent sources. Numeric-only reviews do not need extraction or vectors to contribute to Step 2 numerical statistics.

`FeedbackAnalysisJob.trustAtExtraction` records the classification seen at extraction, while `trustClassification` tracks current backend verification. Existing old jobs have no invented extraction-time trust snapshot; their current metadata is derived. Retrieval always rechecks live source eligibility and trust.

Approval of an already AI-eligible pending review refreshes current metadata and invalidates the analytical cache without changing its content hash, generation, observations, or embeddings. In-flight work still rechecks eligibility, leases and revisions before commit. Content edits use existing invalidation/reprocessing. Rejection, hiding, deletion or permission loss remove observations and cascade-remove vector jobs/vectors; live views immediately prevent retrieval. A blocked moderation decision is preserved across approval and consent changes.

## SQL profiles and conservative scoring

Profile algorithm version is 3; the internal rating algorithm version/coefficients are unchanged. SQL calculates:

- All-eligible skill average, separate verified/unverified averages and counts, and classification-specific recent/preceding 90-day statistics. Existing last-five and time-window comparisons remain available as descriptive all-source measurements; verified-only comparisons support Coach improvement claims.
- Theme counts once per feedback ID and sentiment, with raw observation counts separately available. Positive/negative/neutral support is split by classification for all time, recent and preceding periods. Distinct verified reviewers count only authenticated approved sources. Pending assignments never add verified diversity. Same guest names do not merge people or claim independence.
- Combined multi-match reviews count once because aggregates use feedback IDs rather than joining matches. Individual feedback records retain their existing semantics.

`FEEDBACK_TRUST_WEIGHTS` in `src/feedback-analysis/config.ts` is explicit source configuration: verified 1.0, guest 0.35, pending 0.35. These initial weights are heuristic, not scientifically validated. Change them deliberately and bump the profile algorithm version/rebuild caches when changing the configuration.

The existing weakness components and coefficients remain intact. A separate trust factor is applied **once**, after the existing diversity factor. For each theme:

1. Each stable account contributes at most one negative evidence unit across the ranking's time scope. Guest submissions are opaque sources, not inferred identities.
2. Weight guest/pending sources by the configured trust weights.
3. Cap their combined influence at 0.35 per distinct verified negative source, with a minimum single contextual allowance when there are no verified sources.
4. Divide the capped evidence units by the literal negative-submission count to form the trust factor.

Raw counts remain unchanged; weighted values are never described as review counts. Rankings supported by verified evidence sort before exclusively unverified hypotheses. Repeated or guest-only submissions have conservative influence and limited reviewer diversity. Technique improvement is withheld without independent verified support in both periods. This is not an abuse detection or identity verification system; guests cannot establish diversity.

Coach prompt `bvbtips-coach-v2` and deterministic fact rendering identify unverified evidence, use database counts, prefer independently supported conclusions and treat comments as untrusted data. Existing source revision checks prevent old answers from masquerading as current verified evidence. The player-facing Coach summary explains verified/guest/awaiting-approval counts without adding reviewer identities.

## Historical backfill: existing commands

No new runner is introduced. Existing CLI uses the broader live SQL policy, source hashes and model/prompt versions. Each feedback ID is visited once, independent of match associations. Already-current extraction is skipped; missing embeddings use existing idempotent jobs. Failures and backoff remain safely resumable.

Run in the backend directory. These examples explicitly select the **local** `.env`; first verify the sanitized host/database printed by the CLI. Replace `PLAYER_UUID` with the recipient account ID. Preview never calls paid providers:

```sh
pnpm build
pnpm feedback:preview --env-file .env --player-id PLAYER_UUID --batch-size 50
```

After reviewing eligibility, trust counts and cost estimates, explicitly queue eligible historical comments and permit paid processing:

```sh
pnpm feedback:backfill --env-file .env --player-id PLAYER_UUID --batch-size 50
pnpm feedback:work --env-file .env --player-id PLAYER_UUID --batch-size 50 --execute
pnpm feedback:profiles --env-file .env --player-id PLAYER_UUID
pnpm feedback:ready --env-file .env --player-id PLAYER_UUID
```

The scripts already include `--all`; batches limit each page/work unit while continuing until eligible work is exhausted. Rerun the same commands to resume after backoff. Inspect failed jobs and use the existing explicit `retry-failed`/`retry-embeddings` commands when appropriate. Do not reset jobs by editing their rows. For all players, omit `--player-id` only after reviewing an all-player preview.

Inventory reports eligible, skipped, failed, remaining and numeric-only counts, classification counts, and estimated LLM/embedding operations. Worker completion reports processed records and extraction/embedding attempts. Set optional budget assumptions `FEEDBACK_ESTIMATED_EXTRACTION_USD_PER_REVIEW` and `FEEDBACK_ESTIMATED_EMBEDDING_USD_PER_OBSERVATION` to show USD planning estimates; unconfigured costs are reported as null. They are operator estimates, not live provider prices or a spending limit. Observation cardinality is unknown before extraction (0–50 per review); retries can add cost. Extraction runs record actual token usage and embedding jobs record request attempts. No live provider requests or paid backfill were executed during implementation.

Backfill never calls internal rating synchronization or rewrites rating events. Historical permissions and rating events stay unchanged. A later explicit correction to an internal rating source still uses the normal correction workflow, now enforcing the stricter verified-only policy; rollout itself schedules no historical replay.

## Migration and Railway rollout

Required migration: `20261121000000_separate_ai_rating_eligibility`. It adds submission/disclosure metadata and job trust metadata, replaces the AI eligibility/transition functions, invalidates derived profiles and saved Coach answer content. It preserves original reviews, ratings, permissions, internal contributions, snapshots and event history. No source reviews are deleted and no paid jobs are bulk-enqueued. The SQL has an explicit transaction and five-second lock timeout.

1. Select and verify the intended Railway project/environment/database. Back up PostgreSQL and test restore separately. Test the migration and mixed-trust approval flows on QA first.
2. Pause paid workers and drain old backend processes for the cutover. Build/regenerate Prisma, apply `pnpm prisma:deploy` with the explicitly selected database, and start the new backend. Do not use reset, `db push`, seed, or internal rating backfill for this rollout.
3. Deploy the frontend with the new disclosure and trust summary after the backend/schema is ready. Old frontend/backend versions lack the new disclosure/metadata contract; do not use old backends that can apply guest influence.
4. Let the SQL-only profile worker rebuild version-3 caches, or run `feedback:profiles`. Verify no-comment profiles, pending privacy, approval once, guest no-rating events and source removal before enabling paid workers.
5. Run the read-only historical preview. Review original collection permissions; do not grant historical consent automatically. Only explicitly authorize paid processing after previewing scope/cost. No production migration, backfill or Railway deployment is performed automatically.

The CLI blocks remote/production targets without explicit flags. For an authorized Railway shell using injected secrets, append `--allow-remote --allow-production --confirm-database YOUR_DATABASE` to the commands and omit `--env-file .env`; `YOUR_DATABASE` must match the actual database name. Do not bypass target checks or paste credentials into logs.

Prefer a forward fix over rollback. If reverting application code, disable AI/feedback submission paths and workers first; do not revert to code that rates guests or ignores pending privacy. Retain disclosure/audit data and original feedback. Reversing schema changes requires a reviewed recovery migration and backup, never deletion of applied migration history. Profile cache/answer invalidation is expected and recoverable through authorized rebuilds, not by restoring stale answer text.

## File map and verification

- Prisma schema/new migration: submission state, pending disclosure, trust metadata, SQL policies and transition triggers.
- `src/feedback/eligibility.ts`, `privacy.ts`, `feedback.service.ts`, `src/internal-ratings/internal-ratings.service.ts`: independent policies, authenticated consent and verified-only rating inputs.
- `src/feedback-processing/{worker,profiles,maintenance}.ts`, `src/feedback-analysis/{queries,models,config,calculations}.ts`: existing pipeline/backfill reuse and trust-classified deterministic aggregates/scoring.
- `src/ai-coach/{tools,facts,engine,service}.ts` and versioned v2 prompt: scoped retrieval, trust labels and source-based facts.
- Frontend approval/privacy controls, privacy notice and Coach summary: explicit pending disclosure and understandable evidence provenance.
- Policy, PostgreSQL integration, existing rating/approval/multi-match regression, SQL scoring, Coach and frontend consent tests cover the changed contract. AI providers are fake in automated verification; no live paid API call is required.

Local verification applied the migration only to disposable test databases and the confirmed `localhost:5432/sports` application database. The application backup is `/tmp/vbapp-before-ai-eligibility-20261118.dump` (mode 0600). No production connection/deployment, paid backfill or historical rating replay was performed.
