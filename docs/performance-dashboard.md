# Beach volleyball performance dashboard

Open `/analytics` while signed in. The performance section uses a local sunset court photograph, scoped dark/gold styling, four career summary cards, a glowing multicolor radar and five interactive skill cards. Desktop places the cards around the chart; mobile places them below it. Navigation and the existing performance-over-time graphs remain in place. No reference screenshot was included with the supplied text, so the composition follows its written layout requirements.

## Components and files

- `frontend/src/components/performance-profile.tsx`: section composition and heading.
- `frontend/src/components/beach-court-background.tsx`: decorative local background.
- `frontend/src/components/performance-summary-cards.tsx`: authenticated summary fetching and four cards with loading/error states.
- `frontend/src/components/skill-rating-card.tsx`: skill values, arc gauges, self comparisons and detail selection.
- `frontend/src/components/rating-mode-selector.tsx`: Internal Rating / Self-Assessment switch, defaulting to Internal Rating.
- `frontend/src/components/player-skill-radar-chart.tsx`: immersive gradient/glow variant, five colored markers, comparison, missing-value handling and exact-value readouts. Profile cards retain their existing appearance.
- `frontend/src/components/skill-radar-profile.tsx`: current-rating fetching, with an immersive presentation option.
- `frontend/src/components/analytics-page.tsx` and `frontend/src/app/globals.css`: integration and responsive styling.
- `src/analytics/dashboard.models.ts`, `dashboard.resolver.ts`, `dashboard.service.ts`, and generated `src/schema.gql`: owner-authenticated `myPerformanceSummary` query.

## Real data and time semantics

Summary cards are career statistics and the current overall internal rating. The radar always requests current ratings, without a snapshot date or reset button. The summary query derives the player from the authenticated session, without accepting another user's ID. It reads only completed Beach Volleyball matches played by that player on an assigned team, dated on or before now. Match reads and the rating aggregate share a repeatable-read transaction.

- Win rate is wins / (wins + losses). Ties and incomplete scores are excluded. No decisive games displays an unavailable value.
- Current streak counts consecutive scored wins or losses in newest-first match order. Ties break a streak; incomplete scores are skipped. The W/L suffix identifies its direction.
- Games played counts those completed matches, including ties and matches without scores.
- Average player rating is the arithmetic mean of that player's current internal ratings for active Beach Volleyball skills. Missing skills are excluded; an empty set is unavailable. The number of rated skills is displayed.

The backend returns compact summary values rather than transferring match histories to the browser. It currently reads the player's completed match scores to calculate the streak and win rate; very large histories may benefit from database aggregation or maintained summary statistics later.

Radar values continue to come from the existing private `skillRadarProfile` query: `PlayerInternalRating`, `SelfAssessmentRating`, and published `FeedbackRating` averages. Skill IDs and names come from backend records. Internal rating calculations stay on the backend. The source switch exposes only Internal Rating and Self-Assessment and always defaults to Internal Rating. Published feedback averages remain available in the backend response but are not selectable in the profile. Switching updates both chart and cards. The performance profile has no compare checkbox or dual-polygon mode. Card arrows explicitly compare against self-assessment, rather than implying a historical increase. Missing ratings remain unavailable and leave polygon gaps. The separate performance-over-time chart retains its time filters; historical snapshots remain available in the backend API, but the profile has no date controls; see [skill-radar.md](skill-radar.md).

No new package, database model, migration, production seed or backfill is required. Existing owner authorization is preserved. Animation honors reduced-motion preferences.

## Background asset provenance

Saved asset: `frontend/public/assets/beach-performance.webp`, 1672 × 941 pixels, 152,874 bytes. Generated with the built-in `image_gen` tool in generation mode, then encoded with the repository's existing Sharp dependency. There are no remote image URLs or generated UI baked into the image.

Generation prompt:

> Use case: photorealistic-natural. Asset type: locally hosted background photo for a beach volleyball performance dashboard, wide landscape 16:9. Create a realistic cinematic empty beach volleyball court on fine sand, clearly visible dark boundary lines converging in perspective across foreground, a proper volleyball net and posts in the middle distance, calm blue ocean behind it, soft coastal sky with subtle clouds, warm low golden sun near the right horizon reflecting on textured sand. Camera slightly elevated at the back corner of the court; sand most visible in lower half, ocean and sky across upper half. Natural muted teal ocean, warm beige sand and golden light, professional sports photography, realistic optical detail. Keep the center uncluttered for a statistics overlay. No people, no buildings, no text, no logos, no UI, no tropical vacation props, no cartoon illustration, no over-saturation. Do not bake a black overlay into the photo.

## Verification

`test/performance-summary.spec.ts` covers outcomes, streaks, ties, missing scores, empty histories, actor scoping and rating aggregation. `frontend/tests/performance-dashboard.test.tsx` covers actual summary values, missing gauges and mode/comparison synchronization. The opt-in `frontend/tests/e2e/skill-radar.spec.ts` creates real accounts, scored matches and feedback against a disposable PostgreSQL database, then checks source switching, comparison, missing history, labels, card separation and page overflow.

Run the browser fixture only against isolated test servers:

```sh
RADAR_E2E=true PLAYWRIGHT_BASE_URL=http://localhost:3124 npm run test:e2e -- skill-radar.spec.ts --project=width-320 --project=width-375 --project=width-1440 --workers=1
```

Screenshots are saved to `/tmp/vbapp-beach-performance-width-*.png`.

Validation: 87 backend unit tests, 12 PostgreSQL integration tests and 89 frontend tests passed. Backend and frontend TypeScript checks and the webpack production build passed. Frontend lint has zero errors and six pre-existing warnings. Real-browser runs passed at 320, 375, 768, 1024, 1440 and 1920 pixels, including label fit, non-overlapping cards, source switching, comparison and missing historical values. Tests used disposable data and separate server ports.
