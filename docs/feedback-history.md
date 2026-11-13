# Feedback history

`/feedback` reuses the Analytics beach court asset and the Matches page's scoped dark palette, header, filter surfaces and responsive padding. History cards use CSS skill bars and the same skill colors as the radar. Submission illustrations are not used here. Existing feedback details remain the source for full comments, consent information, match association and submission timestamps.

## Data

- Cards retain the existing `receivedFeedback` query, date/type filters, ten-record pages, lookahead cursor and infinite-scroll spinner/retry behavior.
- Card scores average only that review's valid submitted numerical skill scores. Missing skills are omitted. Written-only reviews have no invented numerical score. The comment preview uses the overall comment, then the first nonblank skill comment. Full comments remain available in details.
- The summary queries `userSkillRatings(userId, sportId)` and `feedbackCount(userId, sportId)` once, independent of loaded history pages. Both queries retain their authentication guard and owner checks; optional sport arguments preserve existing callers.
- Average feedback rating is the weighted mean of published active skill ratings, using the backend's per-skill averages and counts. It is not an unweighted mean of skill averages or an internal rating.
- Total reviews counts published feedback submissions for the selected beach volleyball sport, including written-only reviews, independently of the number of numerical ratings.
- Top-rated skill uses active skills' published averages. Samples below three ratings are explicitly marked as limited data. Equal averages prefer the larger sample, then a stable skill ID order.
- Summary statistics are all-time; the page labels this explicitly. Date/type filters change the history, not the summary. Empty and failed summaries show unavailable values rather than invented statistics.

Existing recipient visibility rules remain unchanged. Assigned pending/rejected drafts remain excluded by the backend. Any other authorized nonpublished record retains an explicit status badge and is excluded from summary statistics. Reviewer cards use usernames or guest names, never email addresses. Feedback approval and internal rating calculations are unchanged.

Match and feedback links are siblings, with keyboard focus indicators and no nested links. Layout uses one column below 768px and two above it. Hover motion and skeleton animation respect reduced-motion preferences.

The optional skill filter was not added; filtering a loaded page alone would be incomplete. No database migration or new asset/dependency is required. Deploy the updated backend with the frontend to support the aggregate queries' new optional `sportId` arguments.

## Validation

Unit coverage checks count-weighted aggregates, owner/sport/published query scopes, reviewer identity, missing ratings, comment fallback, written-only feedback and separate navigation links. Browser tests use API fixtures across 320, 375, 768, 1024, 1440 and 1920px to check the grid, totals beyond the first page, filters, infinite scrolling, request dialog and detail navigation. Browser screenshots are previews of fixture data.

## Implementation files

- `frontend/src/components/feedback-pages.tsx`: journal layout, existing filters/pagination, matching loading and empty states.
- `frontend/src/components/feedback-card.tsx`: compact reports; the existing full category detail component is retained.
- `frontend/src/components/feedback-summary-stats.tsx`: aggregate query and summary strip.
- `frontend/src/lib/feedback-history.ts`: card scores, comment fallback, weighted summary and skill color mapping.
- `frontend/src/lib/skill-radar.ts` and `frontend/src/components/skill-rating-card.tsx`: shared skill palette, retaining the existing component export.
- `frontend/src/app/globals.css`: glass reports, responsive summary/grid, skill bars and reduced-motion treatment.
- `src/analytics/analytics.resolver.ts` and `src/schema.gql`: backward-compatible optional sport scopes on two existing aggregate queries.
- `frontend/tests/feedback-history.test.tsx`, `frontend/tests/e2e/platform.spec.ts`, `test/feedback-history-summary.spec.ts`: presentation, aggregate/privacy and responsive browser coverage.
