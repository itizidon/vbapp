# Five-axis skill radar

The private account/profile page now includes a fixed Self-Assessment radar and an Internal Rating radar in their respective existing cards. The internal overall score and both existing rating tables/edit controls remain. Its Compare checkbox overlays the self-assessment on the internal profile.

The Performance Profile now always shows current ratings; its date picker, snapshot shortcuts and Current Ratings button have been removed. The backend historical snapshot API remains available. Analytics has a larger Performance Profile radar above the existing daily/individual/history chart. A two-position switch selects Internal Rating or Self-Assessment. Internal Rating is always the default, including when its scores are unavailable; Average Feedback is no longer a selectable profile source. Analytics has no compare checkbox: its switch displays one rating source at a time. The account card retains its existing internal/self comparison. Skill buttons support tap and keyboard activation and select the corresponding metric in the existing detail chart. The current profile cards use only their respective source; no averages are mislabelled as internal scores.

## Data and authorization

The owner-authenticated `skillRadarProfile(userId: ID!, sportId: ID!, asOf: DateTime)` GraphQL query supplies all active backend skill definitions and three independent values in one request. It uses a fixed set of batched Prisma reads in one repeatable-read transaction, not one network/database query per skill. The response shape is:

```graphql
query Profile($userId: ID!, $sportId: ID!, $asOf: DateTime) {
  skillRadarProfile(userId: $userId, sportId: $sportId, asOf: $asOf) {
    asOf
    skills { skillId skillName skillSlug selfRating internalRating averageFeedbackRating feedbackCount }
  }
}
```

Current self-ratings come from `SelfAssessmentRating`, current internal ratings from `PlayerInternalRating`, and average feedback from published recipient `FeedbackRating` rows. Hidden/deleted/pending feedback is excluded. The private average follows the existing owner-only analytics convention, independently of public analytics consent and internal-rating duplicate/influence rules. Reviewer weights and confidence are not exposed. There is no public access to another player's internal profile and no change to privacy permissions.

The chart axes use backend IDs and display names. `frontend/src/lib/skill-radar.ts` centrally orders Passing, Setting, Attack/Attacking, Serving and Defense, with aliases for older bump/set/spike/serve/defence slugs. It contains no player scores or hardcoded skill IDs. Unrelated extra skills do not add axes to this five-skill chart.

## Historical behavior

Current ratings are the latest known values. A snapshot date is interpreted as UTC end-of-day; today is clamped once to the actual selection time, preventing moving query keys or fabricated future values. Internal snapshots select the latest event effective on or before that time in the skill's **latest corrected revision**. They are corrected historical profiles, not reconstructions of what someone saw before a later correction. Self snapshots use the latest immutable `SelfAssessmentRatingEvent` recorded by that time. A missing event stays null; today's self/current rating is never substituted for missing history.

The profile UI requests the current values by omitting `asOf`. The separate performance-over-time chart still has its existing time filters. Average Feedback uses currently published feedback submitted on or before the date, with the current version of its score; the app does not have immutable feedback-score-edit history to reconstruct an original pre-edit average.

## Rendering and missing values

Recharts RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar and Tooltip are reused; no new dependency was installed. The scale is fixed at 1–5 and the polygon grid has five equally spaced axes. Smooth 350ms transitions honor `prefers-reduced-motion`. Each chart includes keyboard/touch skill buttons and a persistent accessible value readout, in addition to desktop hover tooltips. The existing rating tables remain available on the profile cards.

Missing/invalid/out-of-range scores are null, not zero. Recharts normally maps a null radar point to the center, so the implementation uses the library's own Polygon and Dot primitives to omit missing points and leave gaps. Incomplete profiles have no fill; missing skills are named explicitly. No-record states show a message and an empty labelled grid. The chart keeps labels inside a responsive container, wraps its controls on phones and avoids horizontal page scrolling.

## Main files

- `frontend/src/components/player-skill-radar-chart.tsx`: reusable rendering and interactions; no fetching or rating calculations.
- `frontend/src/lib/skill-radar.ts`: centralized axes, input bounds and UTC snapshot helpers.
- `frontend/src/components/skill-radar-profile.tsx`: Analytics fetching and snapshot controls.
- `frontend/src/components/profile-skill-ratings.tsx`: fixed-source radars in the self/internal profile cards.
- `src/internal-ratings/internal-ratings.service.ts`, `.resolver.ts`, `.models.ts`: private batched GraphQL data source.

## Verification and previews

Open `/account` (or `/profile`) for the two cards, and `/analytics` for current source selection and comparison. The implementation needs the already-existing internal-rating/history schema; no new database model, migration or backfill is introduced. Existing uninitialized internal ratings still need the explicitly authorized backfill described in `internal-ratings.md`.

Validation includes axis ordering/aliases, real source separation, switching/compare, nulls/bounds, loading/empty views, owner authorization, dated history and missing baselines, production compilation, and real browser checks against a disposable seeded PostgreSQL database. To run only the opt-in browser test with isolated servers, set `RADAR_E2E=true`, set `PLAYWRIGHT_BASE_URL`, then run `npm run test:e2e -- skill-radar.spec.ts --project=width-375 --project=width-1440 --workers=1`. It creates temporary test accounts; use a disposable database. Browser previews are saved under `/tmp/vbapp-radar-width-*.png`.

Validation completed: 84 backend unit tests, 12 PostgreSQL integration tests, 86 frontend tests and three real-browser runs (320px, 375px, 1440px) passed. Backend/frontend TypeScript checks and the webpack production build passed. Full frontend lint completed with zero errors and six existing warnings in other feedback/history helpers and test fixtures. No new dependencies, database migrations or production data changes were required.

The subsequent beach dashboard redesign adds career summaries, colorful gauges and a scoped immersive chart variant. Its five rings are drawn at ratings 1–5 around a zero-coordinate origin; zero remains invalid as a rating. See [performance-dashboard.md](performance-dashboard.md) for the current component list, image provenance, summary semantics and expanded validation results.
