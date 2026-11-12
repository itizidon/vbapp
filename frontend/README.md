# bvbtips — Matches, Feedback, Account

Beach Volleyball frontend for the existing NestJS GraphQL backend. This refactors the existing Next.js App Router app, retaining its authentication, typed GraphQL proxy, TanStack Query state, React Hook Form/Zod forms, Tailwind tokens, and reusable shadcn/Radix controls.

```bash
# Backend terminal
cd /home/don/dsk/vbapp
pnpm start:dev

# Frontend terminal
cd /home/don/dsk/vbapp/frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3001. The backend needs PostgreSQL, migrations, and the Beach Volleyball catalog (`pnpm prisma:seed` in the backend directory). `GRAPHQL_API_URL` is a server-only setting defaulting to `http://localhost:3000/graphql`; no browser API secrets are needed. Development uses Next.js's supported webpack mode. Production: `npm run build` then `npm start`, with HTTPS on the deployment host.

For Railway or another reverse proxy, set `FRONTEND_URL=https://your-frontend-domain` in the frontend service and redeploy. The `/api/graphql` origin check uses that public URL instead of the internal request URL, preventing false `403 Request origin rejected` responses while continuing to reject other browser origins. Use the frontend URL you open in the browser, not the backend GraphQL URL. Without this variable, the check uses the request URL for local development. This setting does not restrict QA to invited users; a separate access gate is still needed for that.

## Navigation and pages

There are four primary tabs: **Matches**, **Feedback**, **Analytics**, **Account**. Desktop/tablet use a compact top navigation; mobile uses safe-area-aware bottom navigation. Content is centered at a maximum width of 1152px.

- `/matches`: paginated matches the user organizes or participates in. Cards show available date, status, participants, teams, and scores, preserving score zero and absent scores. Creation defaults to the current local date/time and includes the organizer automatically. Members can be searched by username and guests added by name. The form has separate Team 1 and Team 2 sections, each with its score, player list, member search, and guest input. Players are added directly to that team and can be moved to the other team. Optional score inputs record each team’s result. The match, teams, and roster are saved atomically, with up to 50 participants.
- `/matches/[matchId]`: permission-checked match information, participants, available teams/scores, actions to review registered participants, and the current user's received/submitted feedback for the match. Other players' private feedback is not exposed. Match feedback uses loaded pages and provides load-more actions.
- `/feedback`: chronological received feedback, prominent Request Feedback action, and All / Match / General filters over loaded pages. Cards link to details and expand category ratings.
- `/feedback/[feedbackId]`: authorized reviewer/recipient identity references, match association or General Feedback, written comments, categories, and submission time.
- `/account`: private player profile, editable self-assessment, feedback link creation, theme preferences, privacy information, and sign out.
- `/f/[token]`: public feedback flow. Guests enter a name, rate at least one dynamic category using the backend's integer 1–5 scale, optionally add comments, and submit without signing up. Duplicate clicks are guarded. Confirmation never requires registration.
- `/give-feedback/[userId]?match=...`: registered reviewer flow from a match participant. Offers matches visible to the reviewer in which the recipient participates, plus **No match — General Feedback**.
- `/login`, `/signup`: existing JWT mechanism, entering `/matches` on success. Authenticated visits to `/` are verified server-side and redirected to `/matches`.

Old dashboard/insights URLs redirect to Matches or Feedback; profile/settings redirect to Account. Previously generated `/feedback/[userId]?token=...` links redirect to `/f/[token]` before authentication. The Analytics tab is available at `/analytics`.

## Request feedback workflow

In Feedback, choose **Request feedback**, then choose general feedback or a match in which you participate. The app calls `createGuestFeedbackInvite` with that scope and displays the actual returned token as `/f/[token]`, a QR code, Copy Link action, native Share when available, and the returned expiration. Guest reviewers can reuse the link until its signed 24-hour expiration. Signed-in feedback uses `submitFeedback` and does not consume the guest invitation nonce.

A guest can submit the scope selected by the requester. A general invitation displays **No match — General Feedback**; a match invitation displays its fixed match association. A signed-in reviewer can choose a shared, authorized match on a general invitation and submit through `submitFeedback`. A match-specific invitation stays fixed to that match.

## Actual backend contracts and gaps

Supported operations include authenticated `members(search:)` (ID and username only), plus `userMatches`, `match`, `createMatch`, `addMatchParticipant`, `receivedFeedback`, `submittedFeedback`, `feedback`, `createGuestFeedbackInvite`, `submitFeedback`, `submitGuestFeedback`, `sports`, `me`, and existing authentication/self-assessment mutations. `CreateMatchInput` now accepts optional `memberIds`, `guestNames`, and `teams` (each with an optional name, score, and its own member/guest roster); existing callers that omit them retain their prior behavior. Authorized match participants now include member usernames. No database schema migration is needed.

The following requested capabilities need additional backend contracts:

1. **Public invitation lookup:** no endpoint validates an invitation and returns a safe recipient name/photo or available scope. The frontend decodes JWT claims only as routing hints; decoding grants no read access. The backend verifies signature, expiry, nonce, recipient, sport, and match at submission. Public UI identifies the recipient by ID and asks the reviewer to confirm the sender. It does not invent a name or trust a client-supplied display name.
2. **Public optional match selection:** all match queries require authentication and authorization. There is no invitation-scoped public match list. Guest tokens also bind `matchId` exactly, so an existing general token cannot be reused with a selected match. Supporting the full public chooser needs a validated invitation lookup, permission-filtered/paginated public match choices, and an explicit selectable-match token/submission policy. Private match endpoints are never called for guests.
3. **Player lookup/profile editing:** public photos, username/email edits, password recovery, and account-wide privacy settings are unavailable. Match participants display their member usernames; reviewer names without a lookup still use neutral labels. Self-assessments remain editable.
4. **Link management:** the API creates links but has no list/revoke operation. The app provides creation, copy/share, scope, and expiration without pretending to list or revoke old links.
5. **Match-wide feedback totals:** no authorized match-wide feedback feed/count exists. The detail page shows only loaded feedback visible through the user's received/submitted endpoints, without claiming a total for the match.

The UI keeps Beach Volleyball filtering across catalog, feedback, matches, and account data. Sport-unspecified matches remain available because the backend supports draft matches without a sport.

## Implementation

Small route entries use focused components: `app-shell`, `match-pages`, `feedback-pages`, `feedback-card`, `feedback-request-dialog`, `match-selector`, `feedback-form`, `account-page`, `participant-picker`, `create-match-dialog`, and the existing extracted `assessment-editor`. Shared query hooks and real GraphQL fields live in `src/lib`. Cursor pagination retains the backend's 51st-row sentinel while showing 50 rows per page. Filters do not alter the raw pagination cursor.

The same-origin `/api/graphql` route forwards the HttpOnly session token, removes auth tokens from browser JSON, uses Secure cookies in production, validates origins, and disables response caching. Tokens are not stored in local storage. The public invitation page disables indexing and referrer sharing.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright covers the four-tab navigation, match list/details/creation, request-to-guest-to-recipient workflow, general versus match feedback, registered match selection, private match isolation for guests, legacy redirects, and responsive overflow at 320, 375, 768, 1024, 1440, and 1920px. Fixtures are test-only; runtime pages call the real API.

With both servers running, `npm run test:live` uses real API/PostgreSQL/browser interactions for general and match-specific requests, submissions, recipient feedback, account sign out, and login. It creates one temporary account and match, removes its own records in a `finally` block, and writes preview screenshots under `/tmp/bvbtips-*`. Run this only against a local development database; root backend dependencies and `.env` are required for cleanup.

## Verification

Verified November 8, 2026: TypeScript, ESLint, 37 frontend unit/integration tests and 24 backend tests, and the production build passed. All 60 browser tests passed across the six viewport widths. The live API/PostgreSQL/browser check passed for both general and match-bound guest submissions, match creation, recipient feedback/details, authenticated-home redirection, and account sign-out/login; its temporary account and records were removed.

For an isolated preview while another frontend is running, set `NEXT_DIST_DIR=.next-qa` for the build and server, start Next on a separate port, and set `PLAYWRIGHT_BASE_URL` or `FRONTEND_URL` to that address. The default dev/build directory remains `.next`.

## Category explanations and reviewer sign-in

The feedback form displays each active skill's `description` from the API and associates it with the rating controls for screen readers. `pnpm prisma:seed` supplies descriptions for Beach Volleyball skills only when their description is null or empty, preserving existing explanations.

Guest reviewers see Log in and Sign up choices beside their name. Both routes preserve the feedback return path. Signed-in reviewers see their account username filled in automatically. Session detection refreshes on focus/reconnect and uses a token-free BroadcastChannel notification when another tab signs in, signs up, or signs out. Cookies are shared within the same browser profile; separate profiles/devices require their own login.

Team rosters are validated across the whole match: a member cannot appear on more than one team, and all team/player writes succeed together or roll back. Flat member/guest arrays represent unassigned players. Existing match details show each team's players and each participant's team. The live check also verifies that a failed team roster leaves no partial match behind.

Each skill in the feedback form has an optional comment text area. Its text is submitted through `RatingInput.comment` and displayed in category details. A comment requires a rating for that skill; empty comments are omitted. The overall written-feedback field is also available.

## Editing matches

On match details, the organizer can choose **Edit match** to update the description, local date/time, status, team scores, and players. Each section saves independently through the existing backend mutations. Team scores support zero; a blank score clears it to unknown. Members and guests can be added, players removed, and team assignments changed or cleared. Teams can also be added for older matches without teams.

The edit action is organizer-only, matching the API's ownership checks. Match-detail and list caches refresh after each save. Removing a participant leaves existing feedback intact.

Team names are generated automatically (Team 1, Team 2, …); the create and edit forms do not ask for a team name. Existing names remain visible.

New matches always use Team 1 and Team 2. Enter each team’s score when recording a match; blank scores remain unknown, and zero is saved as a score. Members and guests are added directly within their team’s section.

The edit-match dialog uses the same wide desktop layout, with team scores, players, and member/guest additions grouped into side-by-side team sections. On mobile they stack. Players can move directly between teams. Match cards use the signed-in player’s team result to color the whole card green for a win or red for a loss. Ties, missing scores, unassigned players, and organizers who did not play remain neutral.

## Player search and account visibility

The account Privacy section has a **Public account** switch. Accounts start private, including existing accounts after migration. Everyone can search usernames from **Search players** on the landing page or the inline search in the authenticated top bar. `/players` includes private accounts with a **Private account** label, supports username filtering, and loads more results as needed.

`/players/[playerId]` shows public match histories without requiring sign-in. It includes match dates, status, teams, scores, and player names, with no edit, join, or feedback controls. Card results refer to the profile player. Private profiles show a privacy notice instead of fetching history. A profile's owner can go back to their own matches to manage them.

Visibility is checked by the backend on every history request, including subsequent pages. Public queries return only directory and match fields; email, account details, and feedback are excluded. Public sharing does not change organizer-only match mutations or recipient-only feedback invitations. Public matches include their lineups, including other members and guests.

The backend requires the `20261108000000_account_visibility` migration. From `vbapp`, run `pnpm prisma:deploy` and `pnpm prisma:generate`, then restart the backend. This migration was applied to the local development database during implementation.

Verification: `FRONTEND_URL=http://localhost:3002 node --env-file=../.env scripts/privacy-smoke.mjs` uses temporary local accounts and a match, tests public/private access and read-only restrictions, then removes its records. The frontend and backend must be running on the corresponding test ports.

## History pagination and match dates

Your match history, public player histories, and feedback load 10 results at a time. Near the bottom of the list, the next page loads automatically and appends to the current results. A **Load more results** button remains available as a fallback; failed requests offer a retry. Your match and feedback lists keep loaded results visible if the next page fails. Private-profile access is rechecked for each public-history page.

Match histories have **From date** and **To date** filters. Both selected days are included in the browser's local timezone, and filtering happens in the database before pagination. Either date may be omitted; **Clear dates** restores the full history. Matches without a played date appear only when no date range is applied. Feedback category filters also apply before pagination.

The array APIs return up to 11 rows: 10 visible rows plus a lookahead row, with the tenth visible ID used as the next cursor. Player-directory search still uses its existing 50-result pages. `userMatches` and `playerMatches` accept optional `playedFrom` and `playedBefore` DateTime arguments; the latter is exclusive. `receivedFeedback` accepts optional `matchOnly` (`true` for match feedback, `false` for general feedback, omitted/null for all).

Live verification: `FRONTEND_URL=http://localhost:3002 node --env-file=../.env scripts/history-smoke.mjs` creates and removes its own account, 25 matches, and 25 feedback records to check pagination, filters, and public-history access.

Feedback also has From/To date filters based on when it was submitted. These combine with category filters before pagination and use inclusive local calendar dates. The API accepts `receivedFeedback(createdFrom: DateTime, createdBefore: DateTime)` with an exclusive upper timestamp bound. Clearing dates restores the full feedback list.

## Analytics

`/analytics` has an interactive daily line chart, a single-metric dropdown, and a horizontally scrollable **1W / 1M / 3M / YTD / 1Y / ALL** time menu. Choose win rate or one backend feedback category at a time; changing the metric preserves the selected time frame. Win rate has a percentage axis; feedback category averages have a 1–5 axis. Hover/keyboard tooltips and an expandable daily data table provide exact values.

Feedback metric names, descriptions, and IDs come from active Beach Volleyball skills in the backend catalog, returned by `myAnalytics`. There is no hard-coded list of passing/setting/spiking categories. Adding or renaming an active backend skill makes it available after the chart refreshes. Only feedback received about your game is summarized. Category summary averages are weighted by rating count.

The authenticated `myAnalytics(from, before, timeZone)` query uses the current user only. It aggregates full history, independently of 10-result list pagination. Feedback includes published ratings and excludes hidden/deleted records; an owner's own data is available regardless of aggregate-sharing consent. Daily buckets use the browser's IANA time zone.

Win rates include only games the user played on an assigned team, with a played date, at least two teams, all scores recorded, and one highest-scoring team. Zero is a valid score. Ties, cancelled games, in-progress games, unassigned players, and organizer-only records are excluded. Fully scored recorded games count even if their status was left Scheduled. Future games do not count. Missing observations remain missing; lines connect recorded daily values without inventing zeros.

Live check: `FRONTEND_URL=http://localhost:3002 node --env-file=../.env scripts/analytics-smoke.mjs` creates temporary accounts, matches, and feedback, verifies API math and chart rendering, and removes its records. Restart the backend to register the new query; no database migration is needed.

Analytics has a **Daily average / Individual feedback** switch for feedback categories. Both modes use the same category and time bounds. Individual mode plots each published received rating at its actual submission time, including multiple submissions on the same day, and provides an individual-rating table. Win rate stays daily. `myCategoryFeedback(skillId: ID!, from: DateTime, before: DateTime)` is authenticated and returns only the current recipient’s rating IDs, submission timestamps, and scores for the selected active Beach Volleyball category. Individual data is requested only when that mode is selected.

## Top-bar player search

The authenticated top bar has a **Username or email** input instead of the old match-page Search players link. It searches in place after **500ms** without typing and shows at most **five** suggestions. Exact username/email matches rank first, then prefixes, then other matches. Email addresses are matched but not returned or displayed; suggestions contain usernames and public/private labels.

Arrow keys highlight suggestions, Enter opens the selected profile, Escape/outside click closes the dropdown, and the clear button resets it. Selecting a result opens its existing public/read-only or private-profile view. The input is also available in the player-profile header for signed-in users. On smaller screens it occupies its own row in the top bar.

`playerSuggestions(search: String!)` requires authentication, accepts 2–254 trimmed characters, uses parameterized SQL with literal wildcard escaping, and returns only directory fields. The separate public `/players` directory remains available.

After match creation succeeds, the returned match seeds the details cache and navigation starts immediately. The creation dialog stays in its opening state until navigation finishes. History queries are marked stale without refetching; they refresh when the user returns to the list, avoiding a new card render before the redirect and a redundant match-details request.

Feedback invitations are reusable for 24 hours. The `20261109000000_reusable_feedback_links` migration replaces the nonce uniqueness constraint with a non-unique audit index. Multiple guest submissions can share a nonce; signature, expiration, recipient/sport/match scope, and feedback validation are still checked on every submission. QR codes encode the same URL as the copy button and are generated locally with `qrcode.react`.


Guest feedback pages load `feedbackInvitation(token)` from the backend. The backend verifies the signed invitation before returning its sport's complete active category list and a minimal, read-only match preview (date, team scores and player names). Unrelated matches, account emails and other private match fields are not exposed. An invitation without a match remains general feedback; create a new link from the match details page to associate it with a match. Links created from a match's request dialog stay locked to that match. If categories are missing, inspect the returned backend skills; the form does not invent skill IDs or placeholder categories.


The feedback request dialog offers **Create feedback link** (copy/QR sharing) and **Review on this device**. Device review opens the signed invitation with `?mode=device`, showing a guest-name field and feedback controls even when the recipient is signed in. It uses the guest submission mutation, leaves the account session intact, and hides login/signup controls. After submission, **Next reviewer** clears the name, ratings and comments while retaining the invitation and match context. The existing guest invitation expiration and influence policies still apply.


The self-assessment and internal-rating cards now include five-axis skill radars. Analytics also offers a Performance Profile radar with source selection and comparison, always showing current ratings. See [data sources, missing-value behavior, query and preview instructions](../docs/skill-radar.md).

Analytics now presents that profile over a locally hosted sunset beach court, with career statistics, a multicolor radar and interactive skill gauges. See [dashboard components, summary definitions, image provenance and verification](../docs/performance-dashboard.md). Restart the backend and frontend together to include the new authenticated `myPerformanceSummary` query; this redesign adds no migration or dependency.

Feedback links now support optional reviewer assignment and read-only reviewer identity on the form. Account includes a one-card Pending Feedback Approvals queue. See [workflow, data/privacy rules, validation and migration instructions](../docs/feedback-approvals.md).

Feedback forms now use five illustrated skill cards followed by a review-and-submit screen. See [component files, existing image mappings, state, identity/approval behavior and verification](../docs/feedback-cards.md).
