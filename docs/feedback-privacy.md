# Feedback privacy purposes and rollout

## Scope and unresolved legal review

The operator says BVBTips is currently offered in the USA only. The repository does not identify the legal entity, business location, user states, revenue/processing thresholds, provider contract, real retention schedule, or the legal privacy contact before this change. The operator has now supplied support@bvbtips.com as the privacy contact. Registration permits ages 13–120; guest flows have no reliable age verification. No previous public privacy policy or Terms of Service route was found. Do not infer contractual necessity, legitimate interests, CCPA coverage/exemption, or sufficient consent for minors from this code.

This implementation uses explicit, unchecked, optional authorization for private analytics and external AI processing. Ordinary feedback submission remains possible without it. This is a conservative technical gate, not a legal conclusion that a checkbox establishes a lawful basis in every situation. A qualified review must establish the appropriate notices/basis, state obligations, treatment of minors and rights process before public rollout. Public sharing always requires its own affirmative opt-in in this version. Additional advertising, training, unrelated research and public comment/identity disclosure are not authorized by these choices.

Authoritative review starting points: [California CPPA FAQs](https://cppa.ca.gov/faq.html), [FTC children's privacy guidance](https://www.ftc.gov/business-guidance/privacy-security/childrens-privacy), [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data). US-only operation does not establish that particular state statutes apply; evaluate actual facts. Future expansion requires reassessment.

## Previous behavior found

- `analyticsAllowed` and `evidenceAllowed` both default false. The form labeled the first as **public** aggregate permission and the second as future supporting evidence.
- A cross-player skill-average query used analyticsAllowed alone. Ordinary private rating charts used neither permission. Step 1 extraction/vectors, Step 2 profiles and Coach evidence required both flags, conflating public and private purposes.
- Publication, designated-reviewer approval and moderation already guarded AI eligibility. Private account visibility never granted other players access to Coach records. Guest names do not establish independent verified people.
- No public policy/Terms was found. Account privacy text mentioned the older flags. Soft deletion retained original ratings/snapshots. No assumption is made that old notices authorized AI processing.

Legacy fields remain stored and accepted for API compatibility, but no longer authorize new private AI or public aggregates. They are not copied into new permission fields, and false historical values never become grants.

## New purpose model

| Purpose | Authorization | Consumer |
| --- | --- | --- |
| Private numerical performance analytics | privateAnalyticsAllowed + privateAnalyticsConsentAt + current privacyNoticeVersion | Owner-only charts via PrivateAnalyticsEligibleFeedback / equivalent Prisma predicate |
| Private AI analytics/coaching | Above + privateCoachingAllowed + privateCoachingConsentAt + recipient aiCoachingEnabled | Extraction, vectors, Step 2 AI-oriented profile, weakness/themes, Coach tools and evidence |
| Optional public aggregates | publicAnalyticsAllowed + publicConsentAt + publicConsentVersion | Aggregate skill-average endpoint only; minimum 10 reviews and 5 registered reviewers |
| Public comments/identity disclosure | No grant introduced | No public feedback endpoint enabled |
| Advertising, model training, unrelated research | No grant introduced | Not implemented/authorized |

Basic numerical charts and public aggregates retain publication/approval requirements. AI coaching additionally accepts eligible submitted guests and explicitly disclosed pending assigned reviews under the [separate AI eligibility policy](feedback-ai-eligibility.md). Known moderation exclusions remain excluded. Private profiles and tools always scope to the authenticated recipient. The basic private numerical charts can use private-analytics-only permission without sending it to the AI profile/provider. AI-derived profiles therefore can have different counts from numerical-only charts. No historical ratings, internal rating coefficients, reviewer influence snapshots, match relationships or approval decisions are rewritten. Future guest submissions are excluded from internal rating adjustments.

Shared SQL functions and views implement purpose-specific eligibility. The numerical Prisma predicate matches the private numerical view, including approval field comparison and live moderation. The public endpoint returns only aggregate rating/count, with no comments or reviewer metadata; thresholds are risk reduction, not proof of anonymity. A public player account still only exposes the existing match-history capability.

## UI and consent records

The review screen shows **How your feedback is used**, an OpenAI disclosure, a real `/privacy` link, and one unchecked optional private-processing choice. This combines related private analytics/coaching in the quick submission UI, while individual permissions can be changed separately in `/privacy/feedback`. There is no public checkbox on the submission form.

The privacy settings page supports separate registered-reviewer controls and a distinct optional public-sharing section. A preparer cannot authorize AI for another assigned reviewer; draft permissions are not granted. The assigned reviewer can opt in from the approval card or privacy page, separately from approving publication. Reviewer identity is authenticated for settings changes, and the recipient cannot grant consent on their behalf.

`FeedbackPrivacyEvent` records purpose, grant/withdrawal, server timestamp, notice version, actor role and authenticated actor ID where applicable. Metadata is server-generated; a true grant must include the displayed `feedback-privacy-v1` notice version. Withdrawal needs no new notice acceptance. Toggling public sharing does not renew private consent timestamps. Repeat unchanged settings do not create duplicate decision events.

Unverified guests receive a signed purpose-limited receipt after submission. It can only withdraw permissions, not read feedback, impersonate an account or grant permission. It is valid one year from original submission and independent of the 24-hour feedback invitation. Receipt issuance is deterministic for safe submission retries. The browser link uses a fragment (not sent to the server); withdrawal sends the token in a GraphQL POST body. The UI asks guests to save the link before handing over the device. Guest withdrawals are auditable as unverified receipt actions, not registered identity verification. Lost/expired receipts require an operator-assisted rights process; set a real privacy contact before rollout.

Recipients can disable AI coaching under Account privacy. This removes their derived observations/vectors and saved answer content. Re-enabling does not change reviewer grants or automatically perform paid analysis.

## Withdrawal, deletion and caches

Permission changes use the existing source-row locks, generations, lease revocation and queue invalidation. Private permission loss deletes associated observations and cascade-deletes vectors/jobs, marks analytical profiles stale and removes saved Coach answer/evidence JSON for the affected recipient/sport. Chat questions and usage/audit metadata remain subject to the retention policy; historical answers cannot be reconstructed from old tool transcripts because none are stored. Hiding, rejection, deletion and approval loss are enforced by the same live checks. Moderation exclusions are preserved when private permissions or recipient preferences change.

Numerical-only permission withdrawal excludes the review from private numerical charts. AI withdrawal leaves ordinary numerical analytics allowed if its separate permission remains true. Public withdrawal only affects aggregates. Source removal invalidates Coach histories immediately; in-flight work still has to pass live eligibility and revision checks before committing. Physical deletion cascades privacy events/derived rows. Original soft-deleted feedback/ratings are not automatically purged; legal retention and verified physical-deletion procedures remain an operator responsibility.

Responses already delivered to browsers or an external provider cannot be recalled by local SQL invalidation. Provider deletion/retention rights must follow the actual contract and account configuration.

## External processing and minimization

Extraction sends overall/per-skill free-text comments, opaque source keys, skill slugs and the taxonomy to OpenAI. It omits reviewer account email/username, user IDs, match rosters and reviewer rating snapshots. Free text itself may contain identity/PII and is sent for moderation/extraction, so the notice does not claim anonymity. Embeddings send contextualized skill/theme/sentiment/evidence, not entire comments by default. Coach sends user questions, limited chat history, private authorized aggregates and bounded evidence with opaque references for citation validation. No account API keys are sent to the frontend.

Responses calls use store:false. [OpenAI documents](https://developers.openai.com/api/docs/guides/your-data) default abuse-monitoring retention up to 30 days with exceptions; API data is not trained on by default unless opted into sharing. Zero Data Retention/Modified Abuse Monitoring are account-specific, not inferred. Verify operator sharing settings, provider agreement, subprocessors, transfers and retention before making deployment-specific promises. Conversation retention defaults to 90 days from creation and requires scheduled cleanup; usage retention/pruning and feedback retention must be reviewed separately.

## Migration and safe Railway rollout

1. Complete legal/operational review: legal entity, states/users, minors, chosen basis/notices, real privacy contact, rights handling, provider agreement/data settings, retention and historic-purpose compatibility. There is no completed Terms of Service in this repo.
2. Back up the intended database and test `20261119000000_feedback_privacy_purposes` in QA. This is additive for original feedback fields/tables. It clears now-ineligible derived observations/vectors and saved Coach answer content and invalidates caches. Original comments, ratings, legacy flags and approvals remain unchanged. No historical permission is promoted and no paid backfill runs.
3. Stop old paid workers during the coordinated rollout. Apply reviewed migrations explicitly with `pnpm prisma:deploy` in the authorized environment, then deploy backend/worker code together, followed by the frontend. No Railway deployment is performed here. Never run an old worker that uses legacy permissions after a new withdrawal.
4. Set server-side frontend `PRIVACY_CONTACT_EMAIL` before the frontend build (the policy page is pre-rendered) to the operator-provided `support@bvbtips.com` address (or a reviewed replacement). `/privacy` explicitly shows when it is missing; do not publish with the fallback incomplete operator details. Resolve the operator/legal notice before public release.
5. Verify `/privacy`, `/privacy/feedback`, guest receipts, Account opt-out, pending approvals, withdrawal and cache removal. Check profiles through `pnpm feedback:ready --env-file .env` for local use, or explicitly selected authorized remote configuration. SQL-only profile rebuilding remains automatic; paid extraction remains an explicit worker.
6. Preview the historical report (`pnpm feedback:preview --env-file .env`). `privacyReport` counts legacy permissions, missing new private authorization, pending approvals and public opt-ins without printing comments/identities. Groups overlap; they are not a sum. Historical treatment is unresolved until original collection notices and compatible purpose/authorization are reviewed. Leave excluded records unchanged. Registered reviewers can make new choices after reading the notice; unverified historical guests must not be silently reauthorized.
7. After authorized reviewers opt in, explicitly queue/process only eligible records using the existing backfill commands. There is no blanket `UPDATE` setting old booleans true.

Rollback must preserve the new restrictions: disable paid workers and affected public/AI endpoints if reverting application code. Do not roll back to code that ignores new withdrawals. Keep permission/audit records; rebuild derived data only after authorization is established.

## Implementation and verification map

- Model/migration: `prisma/schema.prisma`, `prisma/migrations/20261119000000_feedback_privacy_purposes/migration.sql`.
- Permissions and audit: `src/feedback/privacy.ts`, `private-eligibility.ts`, submission service/module, GraphQL inputs/models and multi-match review inputs.
- Eligibility consumers: analytics resolver/dashboard, profile queries, extraction worker, backfill report, Coach service/messages.
- UI: feedback form/notice/settings/summary/details, Account privacy, approval cards, shared API/types/validation and the two `/privacy` routes. `frontend/.env.example` documents the contact setting; the local ignored environment file contains the supplied contact.
- Tests: purpose/authority unit tests, PostgreSQL privacy and existing pipeline/Coach/approval/multi-match suites, frontend consent/receipt/policy/form tests, and browser checks across 320/375/768/1024/1440/1920 widths.

The complete backend suite passed (273 tests, one opt-in live test skipped); the final targeted privacy run passed 16 checks including added moderation/timestamp cases. Frontend suite: 170 passed. Six browser viewport checks passed. Typechecks and backend build passed. Frontend production build passed with `--webpack`; the runner blocks Turbopack's CSS helper port/process creation. Frontend lint has no errors and six pre-existing warnings; backend lint cannot run because its existing eslint executable/dependency is missing. No real provider requests or paid backfill were run. The tested migration was applied only to the backed-up localhost development database.
