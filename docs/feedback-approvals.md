# Assigned feedback links and approvals

The existing feedback-link dialog now offers **Assign feedback giver**, a debounced username search over registered members. It displays usernames and generated avatars, never email addresses. Selection stores the immutable user ID; the recipient is excluded in search and rejected by server validation. The dialog retains QR/copy/share and same-device guest review.

A newly created link is a reusable, 24-hour, 256-bit random opaque token. Only its SHA-256 hash is stored in `FeedbackLink`. The record contains the recipient, optional assigned reviewer, sport, optional match, creation/expiry times and optional revocation timestamp. The token contains no user IDs or private claims. Existing signed JWT invitations continue to work as unassigned links until their original expiry; these older stateless invitations cannot be individually revoked.

The public form resolves its recipient, skills, match and assigned reviewer from the verified invitation API, including for opaque tokens. Assignment is read-only. Anyone holding a valid link may prepare a draft; submission does not authenticate or approve the designated reviewer. A valid signed-in session is recorded separately as `submittedById`. Guest names are preserved as submitted names, not verified identities. Expired/malformed optional sessions do not establish submitter identity or stop anonymous link use. Approval/rejection always require a valid authenticated session.

## Publication and rating behavior

| Link / action | Result | Rating effect |
| --- | --- | --- |
| Unassigned link submission | PUBLISHED immediately, preserving existing behavior | Existing guest or authenticated-reviewer algorithm applies |
| Assigned link submission, even by the selected reviewer | PENDING | No contributions, internal rating events, average/count inclusion or recipient feedback visibility |
| Assigned reviewer approves | PUBLISHED, with `approvedAt` and `approvedById` | Existing reviewer-weighted algorithm runs atomically |
| Assigned reviewer rejects | REJECTED, with `rejectedAt`, `rejectedById`, optional reason | No rating changes; retained for reviewer audit |

Approval uses the existing `ratingTransaction` advisory lock and existing `InternalRatingsService.syncFeedback`. It does not implement another algorithm. The reviewer’s current skill rating and confidence are read during approval, and immutable contributions/events preserve those calculation inputs. Events take effect at approval time. Existing active-skill rules, provisional/missing-reviewer handling, reciprocal confidence exclusions and one-reviewer influence per skill/UTC-day still apply. Multiple approved drafts from the same reviewer in one day can therefore be published without receiving duplicate internal influence.

All active recipient skill baselines must already exist before approval; otherwise the transaction fails with an initialization error and leaves the draft Pending. This avoids claiming successful rating processing without a baseline. No automatic production backfill is performed. Use the separately documented, explicitly authorized internal-rating backfill process when migrating legacy accounts.

Approval/rejection validate the designated reviewer, distinct recipient, matching link, sport/match scope and pending state. Repeating the same completed decision is idempotent. Opposite decisions are rejected. Concurrent decisions serialize; publication, audit fields, contributions, current ratings and events commit together or roll back together. Generic feedback updates cannot publish pending or rejected assigned drafts. Those drafts cannot be deleted through the generic delete action.

Invitation expiry stops new submissions; it does not invalidate drafts submitted while the link was valid. Revoking a link stops new submissions and new approvals. Its pending drafts can still be rejected to clear the queue. Already completed decisions remain idempotent after revocation.

Pending/rejected assigned drafts are excluded from recipient lists and detail access, public rating aggregates and private current averages. Only the designated reviewer can access their pending queue and decision history through authenticated APIs. Published feedback identifies that reviewer as the author, while preserving the preparer’s identity in storage. Normal unassigned feedback retains its existing publication and private snapshot behavior.

## Account queue

`PendingFeedbackApprovals` adds a compact **Pending Feedback Approvals** section to Account. It shows exactly one card, with recipient, match context, submission time, submitted name, all skill ratings/comments, overall comment and Pending status. It displays a remaining count and separate Reject / Approve Feedback actions. Buttons lock during a request. Only confirmed decisions remove a card; failed actions retain it and show an error. The next card fades in, respecting reduced-motion preferences. When empty it shows **You're all caught up!**

The backend returns at most ten cards plus a lookahead cursor and an actor-scoped total count in a repeatable-read transaction. Includes load recipients, matches and skill names in bounded batches without per-card network/database queries. The UI processes the first card and refreshes the first bounded batch after a decision, so larger queues drain without loading every draft. Existing in-process GraphQL throttling also applies to link creation, public submission and decisions. There is no external notification service.

## Schema and migration

`prisma/migrations/20261112000000_feedback_approvals/migration.sql` is an additive migration, wrapped in a PostgreSQL transaction:

- Adds `FeedbackLink`, hash uniqueness and recipient/reviewer indexes and foreign keys.
- Adds `REJECTED` to `FeedbackStatus` without changing existing meanings.
- Adds nullable feedback link, submitter, approval/rejection actors, timestamps and reason, plus `approvalRequired` defaulting to false for all existing records.
- Adds an index for the reviewer’s pending queue and a feedback-link index.
- Extends the existing feedback identity check only for assigned drafts, allowing both designated reviewer and preparer guest name. The original check remains for unassigned records. The existing no-self-review check remains, with an additional no-self-assignment check on links.

No tables/records are dropped or reset. Existing feedback remains unassigned. The migration does not convert existing feedback into pending drafts or change match status. Generated Prisma Client and `src/schema.gql` must ship with the matching backend version.

## GraphQL

```graphql
mutation Invite($recipientId: ID!, $sportId: ID!, $reviewer: ID) {
  createGuestFeedbackInvite(recipientId: $recipientId, sportId: $sportId,
    assignedReviewerId: $reviewer) { token expiresAt linkId }
}
query Invitation($token: String!) {
  feedbackInvitation(token: $token) {
    recipientId recipientUsername approvalRequired assignedReviewer { id username }
    sport { id skills { id name description active } }
  }
}
query Queue($cursor: ID) {
  myPendingFeedbackApprovals(cursor: $cursor) {
    totalCount nextCursor
    items {
      id recipientUsername status createdAt overallComment guestName
      match { id playedAt description }
      ratings { skillId skillName rating comment }
    }
  }
}
mutation Approve($id: ID!) { approveFeedback(feedbackId: $id) { id status approvedAt } }
mutation Reject($id: ID!, $reason: String) {
  rejectFeedback(feedbackId: $id, reason: $reason) { id status rejectedAt rejectionReason }
}
mutation Revoke($id: ID!) { revokeFeedbackLink(linkId: $id) }
```

`submitGuestFeedback` accepts the existing input shape; the token resolves reviewer identity and assignment. It does not accept reviewer ID, submitter ID or status. The existing `submittedFeedback` query supplies the reviewer’s audit/history records, including approval/rejection timestamps and optional rejection reason. A separate history UI is optional and was not added. Link revocation is available through the authenticated API; no link management screen was added.

## Files

- `prisma/schema.prisma` and the migration: persistence and audit relations.
- `src/feedback/feedback.service.ts`: secure stored invitations, legacy compatibility, Pending submission, privacy, transactional decisions and queue.
- `src/feedback/feedback.resolver.ts`, `invitation.models.ts`, new `approval.models.ts`, `src/common/models.ts`, generated `src/schema.gql`: GraphQL.
- New `src/common/optional-gql-auth.guard.ts`, `src/auth/auth.module.ts`: optional verified submitter attribution on the public link mutation.
- `src/common/inputs.ts`: bounded written feedback/skill comments.
- New `frontend/src/components/reviewer-picker.tsx`: existing members search and optional assignment.
- New `frontend/src/components/pending-feedback-approvals.tsx`: one-card queue and decisions.
- `feedback-request-dialog.tsx`, `feedback-form.tsx`, `/f/[token]/page.tsx`: assigned and opaque-link support, distinct submission/approval copy.
- `account-page.tsx`, scoped `globals.css`: queue placement and reduced-motion transition.
- `frontend/src/lib/api.ts`, `types.ts`, `feedback-card.tsx`, `feedback-pages.tsx`: rejected status and truthful published reviewer names.
- Integration, optional-auth, frontend workflow and opt-in browser tests; existing invitation and privacy fixtures updated.

## Railway / local deployment

No new environment variables or dependencies are needed. Keep the existing `DATABASE_URL`, `JWT_SECRET`, CORS and frontend proxy configuration. JWT secret rotation still affects legacy signed links and login sessions; new opaque links are backed by the database and expire independently.

Build the backend with the existing `pnpm build` command (generates Prisma Client and compiles Nest). Build the frontend from `frontend/` with `npm run build`. Validation here used `npm run build -- --webpack` for Next.js.

**Before serving the new backend/frontend**, apply the migration to the intended environment:

```sh
pnpm prisma:deploy
```

For Railway, add `pnpm prisma:deploy` as the backend’s pre-deploy command, then deploy the matching backend and frontend. The existing `railway.backend.json` currently has an empty `preDeployCommand`; it has deliberately not been changed to silently trigger migrations on your next production deployment. Configure it for the intended QA/production service when you authorize deployment. Apply to QA first and verify the assignment/approval flow before production rollout. The migration is compatible with old rows and unassigned links, but the new app requires the new table/columns, so deploy schema before switching app traffic. Restart local services after applying the migration locally.

No migration or backfill was run against the existing application database. All database checks used disposable PostgreSQL containers. No demo seeding is required for deployment.

## Verification

- Backend unit tests cover existing invitation/publication behavior, recipient filtering, snapshots and optional authenticated submitter handling.
- PostgreSQL integration tests cover assignment, exclusion of the recipient, secure hashes, expiration/revocation, scope tampering, legacy and reusable unassigned links, Pending isolation, queue pagination, authorization, approval-time weights, immutable events, concurrent/idempotent decisions, rejection audit, baseline validation and atomic rollback.
- Frontend tests cover username selection, one-card rendering, counts, approve/reject advancement, empty queue, failed decisions, double-click locking and assigned submission while logged in.
- Opt-in Playwright workflow: `APPROVALS_E2E=true PLAYWRIGHT_BASE_URL=http://localhost:3124 npm run test:e2e -- feedback-approvals.spec.ts --project=width-320 --project=width-375 --project=width-1440 --workers=1`. Use only isolated migrated/seeded test servers; it creates test users and drafts. Queue screenshots are saved to `/tmp/vbapp-feedback-approvals-width-*.png`.

Validation completed: 95 backend unit tests, 28 PostgreSQL integration tests and 96 frontend tests passed. Backend and frontend TypeScript checks and production builds passed. Frontend lint has zero errors and six pre-existing warnings. Real-browser assignment/approval/rejection workflows passed at 320, 375 and 1440 pixels. The integration command used `--testTimeout=30000` for the existing CLI backfill test, which can exceed Jest’s default five-second timeout under concurrent build load.

Additional browser checks passed for the existing current-rating Analytics view and Account layout at 375 and 1440 pixels, and for published reviewer username attribution. Temporary backend/frontend processes and test databases were removed after validation.

## Choosing an approver in the feedback form

The feedback sidebar also offers the registered-player search on unassigned links and ordinary signed-in feedback forms. A selection sends `assignedReviewerId` as a request for that player to take responsibility, not as proof of the preparer's identity. The backend validates the user, excludes the recipient, stores the designated reviewer on the new feedback and always creates a Pending draft. Existing link-level assignments cannot be changed. Other submissions through the same unassigned reusable link can choose independently. Leaving the field blank preserves normal unassigned publication.

`feedbackReviewers(search: String!, token: String, recipientId: ID)` returns at most ten usernames/IDs. Guests must supply a valid invitation; signed-in forms use the authenticated session. Invite scope is checked, recipient accounts are excluded and private emails are never returned. Search is debounced in the shared `ReviewerPicker`.

Both `SubmitFeedbackInput` and `SubmitGuestFeedbackInput` accept optional `assignedReviewerId`. Account approvals, identity/audit fields, recipient privacy, duplicate protection, reviewer weights and immutable rating events reuse the existing implementation. Same-device Next Reviewer clears the per-draft selection; a link's fixed assignment remains.

Authenticated assignments without a link retain the verified preparer in `submittedById`. The additive migration `20261112010000_feedback_form_assignment` broadens the existing identity check to allow this authenticated origin, while retaining a non-null designated reviewer and all old identity rules. No tables or records are removed. Apply it with `pnpm prisma:deploy` before deploying the backend/frontend update. No migration was applied to the existing application database during implementation.

Legacy signed invitations are materialized as hashed link records when needed for an assigned draft, preserving their original scope/expiration and permitting revocation checks thereafter. They remain reusable; the selected reviewer is stored per feedback rather than being written onto the unassigned link.

Additional validation: 95 backend unit tests, 107 frontend tests, 34 PostgreSQL integration tests, both production builds and four real-browser checks at mobile/desktop widths passed. Tests cover guest-scoped search, authenticated search, recipient exclusion, per-draft assignment, fixed-link tampering, legacy tokens, direct authenticated assignments, pending isolation, approval/rejection and duplicate rating protection. Lint has zero errors and six existing warnings.
