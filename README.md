# Multi-Sport Feedback Backend

Production-oriented modular monolith for self-assessments, flexible match tracking, peer/guest feedback, and immutable historical reviewer snapshots. It uses NestJS, code-first GraphQL/Apollo, Prisma, PostgreSQL, JWT, Argon2id, and Jest.

## Frontend

The responsive Next.js app is in [`frontend/`](frontend/README.md). With this backend running, use `cd frontend && npm ci && npm run dev` and open http://localhost:3001.

## Start locally

```bash
cp .env.example .env
docker compose up -d postgres
corepack enable
pnpm install
pnpm prisma:generate
pnpm prisma:deploy
pnpm prisma:seed
pnpm start:dev
```

GraphQL is served at `http://localhost:3000/graphql`. The development explorer and introspection are disabled in production. Set `SEED_DEMO_DATA=true` before seeding to add two demonstration users, current volleyball assessments, feedback, and a historical snapshot. The demo password is `DemoPassword!2026`; never enable demo data in production.

Run `pnpm build`, `pnpm test:unit`, and—against a disposable migrated PostgreSQL database—`TEST_DATABASE_URL=postgresql://... pnpm test:integration`. A typical integration setup is:

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm prisma:deploy
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm test:integration
```

## Data model

The schema contains 13 domain models:

- `User` owns current self-assessments, creates/participates in matches, and sends/receives feedback. Username and email use PostgreSQL `citext` uniqueness. Age and height have no public GraphQL fields. Because age is stored as an integer rather than date of birth, an application process must refresh it as users get older.
- `Sport` configures independent sports without migrations; `Skill` belongs to one sport and marks mandatory signup ratings.
- `Match` has an organizer and optional sport, date, description, teams, participants, scores, and feedback. `MatchTeam` allows any team count and distinguishes `NULL` from score zero. `MatchParticipant` has exactly one registered/guest identity; its composite foreign key guarantees an assigned team belongs to the same match.
- `Feedback` belongs to a recipient and sport, with optional reviewer/match and immutable copied reviewer metadata. `FeedbackRating` stores the reviewer's assessment of the recipient.
- `SelfAssessment` and `SelfAssessmentRating` hold one mutable current self-report per user/sport.
- `FeedbackReviewerSkillSnapshot` stores the registered reviewer's own individual ratings at submission. It is deliberately separate from `FeedbackRating`.
- `PlayerSkillRating` and `PlayerSportRating` hold the platform's nullable current calculated ratings per user/skill and user/sport. They include confidence, evidence counts, algorithm version, and calculation time, but are never initialized from or updated by self-assessments.

The initial migration enables `citext`, creates enums/tables/indexes/checks, enforces cross-sport rating integrity with triggers, touches the parent assessment when a rating changes, and rejects updates to historical snapshot columns/rows. Match deletion sets independent feedback's `matchId` to null. Feedback deletion is a soft-delete by default; physical retention deletion cascades ratings and snapshots.

## GraphQL operations

- Authentication: `register`, `login`, `me`
- Catalog: `sports`, `sport`, `skills`
- Matches: `createMatch`, `updateMatch`, `deleteMatch`, `match`, `userMatches`, `createMatchTeam`, `updateMatchTeam`, `removeMatchTeam`, `addMatchParticipant`, `addGuestMatchParticipant`, `assignParticipantToTeam`, `moveParticipantToTeam`, `removeMatchParticipant`, `updateTeamScore`
- Feedback: `submitFeedback`, `submitGuestFeedback`, `createGuestFeedbackInvite`, `updateFeedback`, `deleteFeedback`, `feedback`, `receivedFeedback`, `submittedFeedback`
- Self-assessments: `mySelfAssessments`, `userSelfAssessment`, `createSelfAssessment`, `updateSelfAssessment`, `updateSelfAssessmentRatings`
- Analytics: `myAnalytics`, `averageSkillRating`, `userSkillRatings`, `feedbackCount`, `skillRatingTrends`, `selfVsPeerRatings`, `userSportFeedbackSummary`, `userMatchHistory`, `matchResults`
- System ratings: `playerSkillRatings`, `playerSportRating`, `playerRatingProfile`

`createMatch(input: null)` and `createMatch` both create a draft with server-generated metadata. List operations use stable `(createdAt, id)` ordering and accept an opaque ID cursor; production clients should request at most 50 records and treat the 51st as a next-page sentinel.

## Snapshot consistency and privacy

Registered feedback submission is one PostgreSQL `SERIALIZABLE` transaction. It validates recipient/sport/skills/match participation, takes a shared lock on the relevant current `SelfAssessment`, reads its ratings, and atomically inserts feedback, recipient ratings, copied overall metadata, and individual reviewer snapshots. Assessment writers take an exclusive lock on the same row. This prevents an overall level from one assessment version being combined with ratings from another. Serialization failures can occur under contention and callers should retry the whole mutation with bounded backoff.

No-assessment and guest submissions create no snapshot. A guest invite is a signed, expiring JWT containing a random nonce and fixed recipient/sport/match scope; the nonce is retained on each submission for auditing, and multiple submissions may reuse the invite until its 24-hour expiration. Snapshot fields never appear in inputs. Database triggers reject later edits, and ordinary feedback editing never refreshes them. A later submission takes a new snapshot.

Raw snapshots are private: only the registered reviewer sees their snapshot on authorized feedback reads. Recipients receive feedback with snapshot fields redacted. Public analytics only use rows explicitly marked `analyticsAllowed`; user-specific analytics require the subject's token. This is intentionally conservative and can later be replaced by an explicit sharing policy or administrator role.

## System-calculated ratings

System ratings are distinct from both current self-assessments and historical reviewer snapshots. New users have no `PlayerSkillRating` or `PlayerSportRating` rows and remain unrated. Nullable calculated values also support a pre-created but not-yet-rated record. PostgreSQL checks enforce ratings from 1–5, confidence from 0–1, and nonnegative evidence counts.

The three system-rating queries are owner-only under the current conservative privacy policy. `playerRatingProfile` returns the sport, current self-reported values, nullable system overall values, system skill values, confidence, and feedback count in one response. No public GraphQL mutation can create or edit system ratings. A future internal calculation worker can write these records without modifying self-assessments or historical snapshots.

## Security and operations

Passwords use Argon2id and never enter GraphQL output types. JWTs default to 15 minutes. Inputs are transformed, validated, allow-listed, and rejected for unknown fields. The API applies request throttling, a maximum GraphQL depth of 10, maximum query complexity of 1,000, Helmet, configured CORS origins, and resource-level ownership checks. Rotate `JWT_SECRET`, terminate TLS at the edge, redact authorization headers in infrastructure logs, and apply per-account/IP rate limits at the gateway in production.

## Current limitations

- No calculated ranking algorithm, embeddings, RAG, set-by-set scoring, guest account claiming, moderator/admin workflow, refresh tokens, or object storage is implemented.
- There is intentionally no public or user-facing write API for system ratings; an authenticated internal worker/service boundary still needs to be designed with the future algorithm.
- The simple in-process rate limiter is per application instance; a shared gateway policy is needed when horizontally scaled.
- Guest invite TTL is currently 24 hours in the service. Make it configuration-driven if products need multiple invite policies.
- Analytics are baseline SQL queries. Benchmark them on production-like volume before adding targeted indexes, materialized views, or partitions.
- `deleteFeedback` performs privacy-preserving soft deletion; a separate audited retention job must perform physical deletion where policy requires it.
- PostgreSQL integration tests are intentionally opt-in through `TEST_DATABASE_URL` so they never fall back to an in-memory database. CI should always provide that database and run migrations first.

## Account visibility and player histories

Accounts default to private (`User.isPublic = false`). Apply migrations with `pnpm prisma:deploy` and regenerate the client with `pnpm prisma:generate` before starting the updated backend.

Authenticated users can change their own visibility with `updateAccountVisibility(isPublic: Boolean!)`. Public directory queries `searchPlayers(search: String!, cursor: String)` and `playerProfile(id: ID!)` expose only ID, username, and visibility. Private players remain searchable. `playerMatches(userId: ID!, cursor: String)` returns public players' organized/participated matches, teams, scores, and rosters in pages of 10 plus a lookahead row. It rejects private accounts on every request. Existing `userMatches` and organizer-only mutations retain their permissions; public profiles do not expose feedback or personal account information.

The frontend provides a visibility switch on Account and **Search players** from the landing/matches pages. Public histories are read-only and available without signing in.

Match/feedback arrays now return at most 11 rows (10 results plus lookahead). `userMatches` and `playerMatches` accept optional `playedFrom` (inclusive) and `playedBefore` (exclusive) DateTime filters on `playedAt`, applied before cursor pagination. `receivedFeedback` accepts `matchOnly: Boolean` to filter match/general feedback before pagination. The frontend loads subsequent 10-result pages on scroll and converts its inclusive local date range into these timestamp bounds. No additional database migration is needed for pagination or date filters.

`myAnalytics(from: DateTime, before: DateTime, timeZone: String)` is an authenticated, current-user-only daily analytics endpoint. It returns active backend skill categories, daily win/loss percentages, per-category rating averages/counts, and period totals. Only feedback received by the authenticated user is summarized. Category names and IDs come from Skill records; they are not fixed in the chart. Results use full history and published feedback, with local-calendar daily buckets. The frontend Analytics tab supports 1W, 1M, 3M, YTD, 1Y, and ALL with one selected metric at a time.

## Railway QA build and access

Backend `pnpm build` explicitly generates Prisma Client before Nest compilation. Prisma and `@prisma/client` remain on the existing compatible 6.19.x versions, with the `prisma-client-js` generator and imports from `@prisma/client`. Build dependencies, including Prisma CLI and Nest CLI, must be installed during the build stage. Run `pnpm install --frozen-lockfile`, then `pnpm build`, from the backend directory. The build does not execute migrations or seed data; `pnpm start:prod` runs `dist/src/main.js`. The seed remains separately available through `pnpm prisma:seed` and optional demo data still requires `SEED_DEMO_DATA=true`.

The current app permits public registration and has deliberately public player-profile and guest-feedback endpoints. `APP_ENV=qa`, CORS, and hidden signup links do not restrict access to approved testers. Protect the entire QA frontend with an identity-aware access gateway (such as Cloudflare Access restricted to tester email addresses), covering `/api/graphql` and `/f/*` as well as pages. Ensure the Railway origin domain cannot bypass this gate. Keep the backend and PostgreSQL private inside Railway; the Next.js server can call the backend over its internal hostname. A QA-only HTTP Basic Auth gateway is an alternative for a small tester group, provided every route and alternate origin is covered.

Use a separate QA database and JWT secret, keep `NODE_ENV=production`, and provision `DATABASE_URL` from the PostgreSQL service. Migrations are a separate deployment operation (`pnpm prisma:deploy`) against the intended environment, and are never run by the build command. QA access protection also applies to guest QR/feedback links; recipients must be approved QA testers unless a deliberate exception is configured.


### Initialize the Railway QA database

The backend-only configuration is checked in as `railway.backend.json`. In the backend Railway service, set **Railway Config File** to `/railway.backend.json` (relative to the repository root), then deploy that commit. This applies the build, pre-deploy, and start commands below. Use this configuration only for the backend service. Deployment details should show `pnpm db:deploy` as the pre-deploy command; the pre-deploy logs should show migrations being applied or no pending migrations. A failed pre-deploy prevents the new release from starting, while an older release may continue serving requests.

`The table public.Sport does not exist` means the target database is missing schema tables; seeds cannot create them. Keep `DATABASE_URL` pointed at the QA PostgreSQL service. After `pnpm build`, set the backend Railway **Pre-Deploy Command** to `pnpm db:deploy` and **Start Command** to `pnpm start:prod`. The pre-deploy command applies the existing migrations, then runs the compiled seed using Railway environment variables (no `.env` file is required). Ensure Prisma CLI is installed in the deployment image so migrations can run. Build alone does not connect to or initialize the database.

`pnpm db:deploy` preserves the Sport table and upserts all existing sport/skill catalog entries, including Beach Volleyball. Keep `SEED_DEMO_DATA=false` to avoid creating demonstration accounts. The standalone `pnpm prisma:seed:deploy` command only seeds an already migrated database. These commands run against whichever database `DATABASE_URL` selects; they do not reset or drop the database. Signup automatically uses Beach Volleyball without a sport selector, retaining the backend sport association and required skill self-assessment.

If the missing-table error persists, inspect the latest backend pre-deploy logs rather than rebuilding the frontend. A successful migration against a different database will not fix the running backend: verify that `DATABASE_URL` references the intended QA PostgreSQL service and that the frontend's `GRAPHQL_API_URL` points at this same QA backend. Share pre-deploy error output for diagnosis, but never share the database connection string.
