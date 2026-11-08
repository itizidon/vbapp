# Courtside — Matches, Feedback, Account

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

## Navigation and pages

There are exactly three primary tabs: **Matches**, **Feedback**, **Account**. Desktop/tablet use a compact top navigation; mobile uses safe-area-aware bottom navigation. Content is centered at a maximum width of 1152px.

- `/matches`: paginated matches the user organizes or participates in. Cards show available date, status, participants, teams, and scores, preserving score zero and absent scores. Creation defaults to the current local date/time and includes the organizer automatically. Members can be searched by username and guests added by name. Players have team selectors, starting with two editable teams; teams can be added or removed, and unknown assignments may remain Unassigned. The match, teams, and roster are saved atomically, with up to 50 participants.
- `/matches/[matchId]`: permission-checked match information, participants, available teams/scores, actions to review registered participants, and the current user's received/submitted feedback for the match. Other players' private feedback is not exposed. Match feedback uses loaded pages and provides load-more actions.
- `/feedback`: chronological received feedback, prominent Request Feedback action, and All / Match / General filters over loaded pages. Cards link to details and expand category ratings.
- `/feedback/[feedbackId]`: authorized reviewer/recipient identity references, match association or General Feedback, written comments, categories, and submission time.
- `/account`: private player profile, editable self-assessment, feedback link creation, theme preferences, privacy information, and sign out.
- `/f/[token]`: public feedback flow. Guests enter a name, rate at least one dynamic category using the backend's integer 1–5 scale, optionally add comments, and submit without signing up. Duplicate clicks are guarded. Confirmation never requires registration.
- `/give-feedback/[userId]?match=...`: registered reviewer flow from a match participant. Offers matches visible to the reviewer in which the recipient participates, plus **No match — General Feedback**.
- `/login`, `/signup`: existing JWT mechanism, entering `/matches` on success. Authenticated visits to `/` are verified server-side and redirected to `/matches`.

Old dashboard/analytics/insights URLs redirect to Matches or Feedback; profile/settings redirect to Account. Previously generated `/feedback/[userId]?token=...` links redirect to `/f/[token]` before authentication. There is no dashboard, analytics, or AI tab.

## Request feedback workflow

In Feedback, choose **Request feedback**, then choose general feedback or a match in which you participate. The app calls `createGuestFeedbackInvite` with that scope and displays the actual returned token as `/f/[token]`, a Copy Link action, native Share when available, and the returned expiration. Guest redemption is single use under the existing backend. Signed-in feedback uses `submitFeedback` and does not consume the guest invitation nonce.

A guest can submit the scope selected by the requester. A general invitation displays **No match — General Feedback**; a match invitation displays its fixed match association. A signed-in reviewer can choose a shared, authorized match on a general invitation and submit through `submitFeedback`. A match-specific invitation stays fixed to that match.

## Actual backend contracts and gaps

Supported operations include authenticated `members(search:)` (ID and username only), plus `userMatches`, `match`, `createMatch`, `addMatchParticipant`, `receivedFeedback`, `submittedFeedback`, `feedback`, `createGuestFeedbackInvite`, `submitFeedback`, `submitGuestFeedback`, `sports`, `me`, and existing authentication/self-assessment mutations. `CreateMatchInput` now accepts optional `memberIds`, `guestNames`, and `teams` (each with a name and its own member/guest roster); existing callers that omit them retain their prior behavior. Authorized match participants now include member usernames. No database schema migration is needed.

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

Playwright covers the three-tab navigation, match list/details/creation, request-to-guest-to-recipient workflow, general versus match feedback, registered match selection, private match isolation for guests, legacy redirects, and responsive overflow at 320, 375, 768, 1024, 1440, and 1920px. Fixtures are test-only; runtime pages call the real API.

With both servers running, `npm run test:live` uses real API/PostgreSQL/browser interactions for general and match-specific requests, submissions, recipient feedback, account sign out, and login. It creates one temporary account and match, removes its own records in a `finally` block, and writes preview screenshots under `/tmp/courtside-*`. Run this only against a local development database; root backend dependencies and `.env` are required for cleanup.

## Verification

Verified November 8, 2026: TypeScript, ESLint, 37 frontend unit/integration tests and 24 backend tests, and the production build passed. All 60 browser tests passed across the six viewport widths. The live API/PostgreSQL/browser check passed for both general and match-bound guest submissions, match creation, recipient feedback/details, authenticated-home redirection, and account sign-out/login; its temporary account and records were removed.

For an isolated preview while another frontend is running, set `NEXT_DIST_DIR=.next-qa` for the build and server, start Next on a separate port, and set `PLAYWRIGHT_BASE_URL` or `FRONTEND_URL` to that address. The default dev/build directory remains `.next`.

## Category explanations and reviewer sign-in

The feedback form displays each active skill's `description` from the API and associates it with the rating controls for screen readers. `pnpm prisma:seed` supplies descriptions for Beach Volleyball skills only when their description is null or empty, preserving existing explanations.

Guest reviewers see Log in and Sign up choices beside their name. Both routes preserve the feedback return path. Signed-in reviewers see their account username filled in automatically. Session detection refreshes on focus/reconnect and uses a token-free BroadcastChannel notification when another tab signs in, signs up, or signs out. Cookies are shared within the same browser profile; separate profiles/devices require their own login.

Team rosters are validated across the whole match: a member cannot appear on more than one team, and all team/player writes succeed together or roll back. Flat member/guest arrays represent unassigned players. Existing match details show each team's players and each participant's team. The live check also verifies that a failed team roster leaves no partial match behind.

Each skill in the feedback form has an optional comment text area. Its text is submitted through `RatingInput.comment` and displayed in category details. A comment requires a rating for that skill; empty comments are omitted. The overall written-feedback field is also available.
