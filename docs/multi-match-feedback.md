# Multi-match feedback requests

## Behavior

Request feedback now offers General feedback or Selected matches. Match requests support up to 20 eligible matches, explicit selection/deselection, a search of loaded match names/dates/players and loading older pages. Opening from a match preselects it; opening elsewhere does not select every match. Selection order is saved as `displayOrder`.

Each newly opened dialog defaults to **Review each match separately** (`INDIVIDUAL_MATCHES`). The other option, **One review for all matches** (`COMBINED_MATCHES`), remains an explicit choice, even with one match. The dialog shows selected count and estimated skill steps (N × 5 or 5).

Stored match requests use the existing illustrated card component. There is one active skill card at a time. Individual mode shows `Reviewing Match X of N`, read-only teams/players/date/scores, per-match notes, and match navigation. Answers are keyed by match ID and skill ID. Previous matches can be revisited without replacing another match's answers or notes. After the final match, one review screen summarizes every match before one atomic submission. Combined mode rates five skills once and displays the complete included-match context.

General requests and old signed/opaque single-match links retain the original API and quick/card modes. Existing links are not converted or invalidated.

## Same-device approvals

When a registered feedback giver is assigned either on the request or inside an unassigned feedback form:

- Individual mode creates N distinct **Pending** records, all with that giver's reviewer ID. **All selected matches appear in their Account approval queue**, one card at a time. Each can be approved or rejected independently.
- Combined mode creates **one Pending record and one approval card**, listing all selected matches.
- The host phone's signed-in recipient remains the verified preparer (`submittedById`), not the assigned reviewer. Device mode submits explicitly as a guest. Selecting a player never authenticates that player or skips approval.
- Guest-name controls are hidden when an assigned player is selected. Removing an optional assignment restores the guest option.
- No pending or rejected record changes internal ratings or appears as published recipient feedback.

Unassigned guest feedback preserves its existing publication policy. It has no registered account to receive an approval queue.

## Persistence and compatibility

The additive migration is `prisma/migrations/20261113000000_multi_match_feedback/migration.sql`.

- `FeedbackLink` is reused, with `mode` (default Individual), `lastSubmittedAt`, selected match relations and submission receipts. Existing token hashes, expiration and revocation remain authoritative.
- `FeedbackRequestMatch(feedbackLinkId, matchId, displayOrder)` stores ordered, unique request scope with indexed foreign keys.
- `FeedbackSubmission` stores a receipt, a unique `(feedbackLinkId, clientSubmissionId)` pair and a payload hash. A successful receipt and every resulting record commit together.
- `Feedback.submissionId` connects records to their receipt.
- `FeedbackMatch(feedbackId, matchId)` connects one combined record to all its matches.
- `Feedback.matchId` remains the association for individual and legacy feedback. Combined records use only the junction. Deferred database checks prevent mixing both association forms.

No existing feedback, match or link is reset, copied or dropped. New foreign-key restrictions preserve selected-match evidence. There is no production data backfill.

## API and validation

`createGuestFeedbackInvite` retains its old arguments and adds `matchIds` and `reviewMode`. `feedbackInvitation` adds trusted `reviewMode` and ordered `matches`, including the existing safe match previews. Old invitations still expose their singular `match` and an empty request-match list.

`submitFeedbackRequest(input: SubmitFeedbackRequestInput!)` accepts the verified token, a client UUID `submissionId`, optional reviewer assignment/guest name, `asGuest`, and review entries. Individual entries must exactly match the authorized match IDs once each; combined input must contain exactly one entry without a singular match ID. Recipient, sport and mode are resolved from the token's stored link, not URL parameters or client claims.

Creation and submission check recipient authorization, match participation, sport, duplicate IDs, bounded selection, active sport skill IDs, duplicate skills, integer ratings 1–5, comments and minimum one rated skill per review. Match previews are loaded in a batch. Whole-request submissions cannot be bypassed through the old single-feedback mutation.

All writes use the existing rating transaction lock. Concurrent retries with the same receipt ID and payload return the same records; a changed payload for an already committed receipt is rejected. The form retains its UUID across failed/ambiguous attempts, including edits after a network error, and resets it for Next reviewer. Failed transactions leave neither partial feedback nor a completed receipt. Links remain reusable for different reviewer sessions for 24 hours; the receipt is not a single-use restriction on the link. Expiration/revocation still stop new submissions.

`asGuest: false` requires authenticated identity; the server uses the verified account as reviewer for unassigned registered reviews. Assigned drafts always require the designated giver's own authenticated approval. Revocation and exact request scope are checked again during approval.

## Ratings, history and analytics

The existing `InternalRatingsService` handles all published records; there is no second formula. Submission-time reviewer rating/confidence/weight snapshots remain immutable and are used at approval, preserving the earlier delayed-approval fix. Individual batch snapshots are captured before any batch contribution is applied. Event history still takes effect at publication/approval time.

Combined feedback is one record, one average contribution per rated skill and one submission in analytics, irrespective of associated match count. Individual feedback contributes N independent records to feedback counts/averages. The existing one-reviewer/recipient/skill influence limit per UTC day still applies: multiple individual approvals do not bypass the daily rating cap.

`Feedback.matches` and inherited pending approval context normalize legacy/single and combined associations into safe match references. Feedback History labels multi-match records `Combined feedback · N matches` and offers separate included-match links without nested card links. Feedback details preserve full comments and associated matches. Received/submitted history queries accept optional `matchId` scope, matching either association representation before paging. Match details can therefore find the same combined record from each associated match and load older feedback without loading global history first. Combined feedback appears only once in the main history and aggregate queries.

## Deployment

Build the backend from `vbapp` using the existing commands:

```sh
pnpm install --frozen-lockfile
pnpm build
```

Before starting the matching backend/frontend release, an authorized release operator must explicitly apply reviewed migrations in the intended Railway environment, using that backend service's database configuration:

```sh
pnpm prisma:deploy
```

Confirm `20261113000000_multi_match_feedback` succeeds, then start the backend with the existing `pnpm start:prod` command and deploy the matching frontend. No new environment variables or seed/backfill operation are required. Keep the repository's `railway.backend.json` automatic pre-deploy migration setting unchanged; no production migration is run by this feature or its build. Existing application databases were not modified during implementation.

## Verification

- Backend unit tests and code-first GraphQL schema generation.
- PostgreSQL integration tests for ordered scope, atomic rollback, duplicate/tampered/missing reviews, concurrent retry receipts, legacy links, registered/guest identity, independent pending approvals, exact combined counts and one application per rated skill.
- Explicit same-device regression: the recipient's phone submits an individual batch with a giver selected on the form, and every selected match appears in that giver's queue.
- Frontend tests for selection/default mode, mode switching, per-match answer/note retention, final single submission and stable retry IDs.
- Production browser tests with real accounts and an isolated database at 320, 375 and 1440px: create a request on the recipient's account, assign the giver, review on the same device, inspect the giver's complete Account queue, approve/reject separately, and discover combined feedback from both matches without duplication.

## Implementation files

Schema and migration: `prisma/schema.prisma`, the migration above. Backend: `src/feedback/request.models.ts`, `invitation.models.ts`, `feedback.resolver.ts`, `feedback.service.ts`, `src/common/models.ts`, generated `src/schema.gql`. Frontend: `feedback-request-dialog.tsx`, new `feedback-match-picker.tsx`, shared `feedback-form.tsx` and `feedback-category-card.tsx`, `pending-feedback-approvals.tsx`, `feedback-card.tsx`, `feedback-pages.tsx`, `match-pages.tsx`, invitation page identity key, `lib/api.ts`, `hooks.ts`, `types.ts`, and scoped `globals.css`. Regression tests are in `test/integration/multi-match-feedback.integration.spec.ts`, existing history tests, frontend form/request tests, and `frontend/tests/e2e/multi-match-feedback.spec.ts`.

## Starting an independent guest review after completion

The success screen for a match request now offers **Leave Another Review** after the entire individual batch or combined review is confirmed. `startGuestReviewSession(token, completedSubmissionId)` requires the original review-session bearer token and that session’s committed client receipt ID. It rejects missing, incomplete, mismatched, expired or revoked authorization. A receipt from a different review session does not authorize the handoff.

The backend signs a bounded guest-only capability referencing the original link and the completed database receipt. Repeated handoff requests return the same capability. Its expiration is capped to the original invitation, including when the login JWT configuration uses a shorter lifetime. Every use rechecks the original link, revocation, expiry, receipt and current selected-match scope. The original link keeps its assigned reviewer. Handoff tokens cannot submit as authenticated reviewers or assign a registered reviewer; guest records retain ordinary unverified guest publication and rating rules. A signed-in host may remain recorded as draft submitter for audit, never as the guest’s verified reviewer or source rating snapshot.

On confirmed handoff, the frontend fetches the new guest session, clears guest name, giver selection, all skill ratings/comments, overall/match notes, sharing flags and progress, and returns to Match 1 / skill 1. Quick/Card presentation is preserved. The recipient, matches and individual/combined configuration come from the unchanged authorized request. A fresh UUID identifies the next batch; retries retain the existing UUID, hash checks and transactional idempotency. Original feedback, Pending assignments, snapshots and rating events are untouched. Failed or pending handoffs keep the completed success state and never clear its answers. New empty forms have no exit warning; meaningful new guest edits use the existing exit protection.

The handoff token stays in memory rather than replacing the original shared URL. Refreshing or reopening that URL therefore opens the original invitation with an empty draft and its original assignment; it never automatically resubmits old answers. Drafts are not persisted. Handoffs do not extend the 24-hour reuse window or bypass existing request throttling.

This update adds the GraphQL mutation above and the `guestSession` invitation field, reusing `FeedbackLink` and `FeedbackSubmission`. It adds no Prisma model, migration, environment variable or seed/backfill step. Deploy the matching backend before the frontend so the new query/mutation fields exist.

Validation for the handoff update: 160 frontend tests, 100 backend unit tests, 37 PostgreSQL integration tests on a disposable database, backend/frontend production builds, TypeScript, and six mocked-API browser flows at 320/375/1440px passed. Three-match database checks preserve the original Pending queue and immutable snapshots, isolate new guest records in individual and combined modes, reject impersonation and unauthorized/mismatched receipt reuse, retain retry IDs without duplicate events, and honor parent expiration/revocation. Browser checks also refresh the original link to confirm its assignment remains intact.

Account authentication also rejects invitation and follow-up JWT capabilities as Bearer account sessions, including tokens with account-looking fields. Normal account tokens require matching UUID `id` and `sub` claims. Optional authentication retains valid anonymous invitation access without assigning guest capabilities a submitter identity.
