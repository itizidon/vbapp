# Approval notifications and review page

Feedback approvals now live in `/approvals`, an authenticated workspace route. The header bell is visible on desktop and mobile. Account retains a pending count and Manage approvals link; the old embedded queue/component has been removed. The four existing main navigation tabs remain available.

## Data and compatibility

No tables, migrations, environment settings or new notification records are introduced. The bell derives its count from Feedback rows where reviewerId is the authenticated user, approvalRequired is true, and status is PENDING. It does not count ordinary received reviews, matches or rating rows. Combined feedback counts once; individual review records count independently.

New guarded GraphQL operations:

```graphql
query ApprovalNotifications {
  myPendingApprovalCount
  myRecentPendingApprovals {
    id recipientUsername createdAt status ratedSkillCount matchCount
    match { id playedAt description }
  }
  myFeedbackApprovals(status: PENDING) {
    totalCount nextCursor
    items { id recipientUsername status createdAt overallComment ratings { skillId skillName rating comment } }
  }
}
```

Recent previews are newest-first, limited to three rows with counted ratings/matches and at most one associated match fetched for date context. They load no feedback comments, rating comments or reviewer snapshots. Full history loads ten records plus a lookahead, newest-first by createdAt/id; cursor scope is checked against the authenticated reviewer and selected status. One repeatable-read transaction keeps page totals and rows consistent. No query accepts a reviewer/user ID from the client.

History statuses are PENDING, PUBLISHED (Approved), and REJECTED. Approved history includes currently published assigned records with that user's actual approval; rejected history requires that user's rejection metadata. Hidden/deleted reviews are not resurfaced. Completed cards are read-only here. Existing `myPendingFeedbackApprovals` remains compatible for older consumers. Existing approveFeedback/rejectFeedback and rating algorithms are unchanged.

## Review safety

`FeedbackApprovalCard` is reusable and collapsed by default. Expanding displays every submitted rating/comment, overall comment, match list and assignment context; skipped skills are not rendered as zero. A card opened through a notification expands directly. Approval additionally requires the explicit “I’ve reviewed every rating and comment…” checkbox. Rejection has an inline confirmation and an optional reason (existing 1000-character backend limit).

Client mutation locks and disabled controls prevent repeat taps on a card. There are no bulk decisions or client-only publication changes. Records/counts are refreshed only after authoritative mutation responses. Stale or opposing decisions show an informative refresh message; matching repeated backend decisions remain idempotent. Existing global rating transaction locking, status/actor checks and per-rating event uniqueness preserve concurrency safety and at-most-once rating application. Independent cards still produce independent decisions, including individual multi-match records. A combined record uses one shared decision and set of ratings.

Privacy permissions remain separate from publication. Pending reviewers can change their own private processing choices inside the expanded card; approving without analytics/AI permission is still valid. Previously prepared consent is not automatically granted by this UI.

## Responsive and accessible behavior

The existing Radix Dialog provides focus trapping, Escape/outside-click dismissal, a close button and focus restoration to the bell. On desktop its content is positioned beside the bell as a compact popover; on mobile the same component/data becomes a full-width bottom sheet, with scroll containment and safe-area padding. Both layouts use one set of query hooks and previews. The bell's accessible name includes the actual pending count; badges show 99+ above 99. View all approvals is always available in the panel.

Cards use navy translucent panels, gold labels, explicit green Approve/red Reject text buttons and wrapping comments. Actions are at least 44px high. Status tabs support keyboard arrows/Home/End. Reduced-motion settings disable the sheet animation. The existing library has no reliable swipe-dismiss primitive, so the sheet uses the visible close button, Escape and outside tap.

Count refreshes initially, on focus and every 60 seconds while foregrounded. Opening notifications forces a count refresh and requests recent previews. Previews fetch only while open. Decisions invalidate shared reviewer-scoped counts, previews, lists, and affected feedback/rating/Coach caches. No websocket or additional state library is used.

## Implementation map

- Backend: `src/feedback/feedback.service.ts`, `feedback.resolver.ts`, `approval.models.ts`; generated `src/schema.gql`.
- Shared UI queries/types/mutations: `frontend/src/lib/approvals.ts`.
- Components: `notification-bell.tsx`, `feedback-approval-card.tsx`, `approvals-page.tsx`; existing app shell, Account, dialog primitive and privacy invalidation updated.
- Route: `frontend/src/app/(workspace)/approvals/page.tsx`; return-navigation helper recognizes approvals.
- Styles: scoped notification/approval styles in `globals.css`.
- Verification: backend query/auth tests plus existing concurrency/ratings integration tests; frontend notification/card/tab/error tests and browser responsive coverage.

## Rollout

Deploy the backend containing the new GraphQL operations before the matching frontend. No migration or new environment variable is required. Keep the existing database and rating history. This implementation does not deploy to Railway or mutate production approval records. Test notifications and one authorized review in QA before rollout. Unit/browser tests use mocked mutations; database tests use disposable PostgreSQL only.

## Verification results

- Backend: 282 tests passed; one opt-in OpenAI metadata test skipped. The suite includes existing authorization, concurrent decisions, approval rollback, per-skill rating events, and individual/combined review tests, plus new query scoping/count/pagination tests.
- Frontend: 177 tests passed. A final focused card/notification run passed 14 tests after the status-announcement and dialog-placement changes.
- Production browser flow: six viewport projects passed (320, 375, 768, 1024, 1440, 1920), with an additional 430px resize check. Tests cover bell/counts, sheet/popover bounds, focus trap/return, Escape/outside/close dismissal, full review and acknowledgement, independent decisions, count refresh, history and Account navigation, overflow and browser-console errors.
- Backend and frontend typechecks passed. Backend build and frontend `next build --webpack` passed. Frontend lint: zero errors and six existing warnings. Backend lint remains unavailable because the existing package has no eslint executable/dependency.
- Existing opt-in backend-driven Playwright scenarios were updated for the new page/acknowledgement/rejection confirmation, but were not run against a live application database. Browser mutations in the responsive suite are mocked; real database behavior is covered by the isolated PostgreSQL backend suite.

Production checks caught a centering-class conflict that development mode did not expose. `DialogContent` now has an explicit custom-placement option for notifications, preserving ordinary centered dialogs. All final production viewport checks pass with that option. Temporary preview files and the disposable database were removed. No production data, migrations, rating formulas, or deployment settings were changed.
