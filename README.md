# BVBTips backend

NestJS, GraphQL, Prisma and PostgreSQL application-domain storage, with Clerk as the only account, session and current player-profile authority. PostgreSQL has no User table or copied player directory.

## Run locally

Configure a Clerk development application and both environment files as described in [Clerk setup and migration](docs/clerk-migration.md). Existing installations require an explicitly reviewed, backed-up fresh-start cutover before this release can run. See the [completed local verification report](docs/clerk-verification.md) for this workspace.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
docker compose up -d postgres
# Preview first; see the guide for backup-gated execution.
pnpm clerk:cutover --env-file=.env --dry-run
# After cutover:
pnpm prisma:seed
pnpm start:dev
```

In another terminal, run `cd frontend && npm ci && npm run dev`. Open http://localhost:3001; GraphQL listens at http://localhost:3000/graphql.

Clerk handles email/password, Google, Facebook, verification, password recovery and account deletion. The frontend forwards verified Clerk session tokens to NestJS over the server-side GraphQL proxy; the API checks signature, issuer, authorized party, verified email and live session/account status. No legacy login mutations, account JWTs, password hashes or auth cookies remain. Independent signed capabilities remain solely for narrowly scoped guest feedback followups.

## Data and identity

Matches, feedback, rating ledgers, AI analyses and training activity reference Clerk `user_...` IDs as text. Current self-assessment, age, height, privacy preferences and trusted roles live in Clerk metadata. Immutable self-rating events, reviewer snapshots and calculated internal ratings remain application-domain history. Public labels are batched from Clerk with bounded memory caching; public responses exclude email and private metadata.

`me`, `completePlayerOnboarding`, `updateAccountVisibility` and the existing assessment operations use the verified actor. `setPlayerRole` requires a trusted ADMIN. Guests continue to use opaque, expiring feedback links. Existing ownership and approval restrictions apply to domain operations.

Run `pnpm test:unit`. For database regression checks, explicitly set `TEST_DATABASE_URL` to an isolated database prepared through the cutover CLI, then run `pnpm test:integration`. Tests use a fake Clerk transport with real signed token fixtures and do not create a local identity table. Never point integration tests at application or production data.

## Account visibility and player histories

Accounts default to private (Clerk public metadata `bvbtips.isPublic = false`). Apply migrations with `pnpm prisma:deploy` and regenerate the client with `pnpm prisma:generate` before starting the updated backend.

Authenticated users can change their own visibility with `updateAccountVisibility(isPublic: Boolean!)`. Public directory queries `searchPlayers(search: String!, cursor: String)` and `playerProfile(id: ID!)` expose only ID, username, and visibility. Private players remain searchable. `playerMatches(userId: ID!, cursor: String)` returns public players' organized/participated matches, teams, scores, and rosters in pages of 10 plus a lookahead row. It rejects private accounts on every request. Existing `userMatches` and organizer-only mutations retain their permissions; public profiles do not expose feedback or personal account information.

The frontend provides a visibility switch on Account and **Search players** from the landing/matches pages. Public histories are read-only and available without signing in.

Match/feedback arrays now return at most 11 rows (10 results plus lookahead). `userMatches` and `playerMatches` accept optional `playedFrom` (inclusive) and `playedBefore` (exclusive) DateTime filters on `playedAt`, applied before cursor pagination. `receivedFeedback` accepts `matchOnly: Boolean` to filter match/general feedback before pagination. The frontend loads subsequent 10-result pages on scroll and converts its inclusive local date range into these timestamp bounds. No additional database migration is needed for pagination or date filters.

`myAnalytics(from: DateTime, before: DateTime, timeZone: String)` is an authenticated, current-user-only daily analytics endpoint. It returns active backend skill categories, daily win/loss percentages, per-category rating averages/counts, and period totals. Only feedback received by the authenticated user is summarized. Category names and IDs come from Skill records; they are not fixed in the chart. Results use full history and published feedback, with local-calendar daily buckets. The frontend Analytics tab supports 1W, 1M, 3M, YTD, 1Y, and ALL with one selected metric at a time.

## Railway QA build and access

Backend `pnpm build` explicitly generates Prisma Client before Nest compilation. Prisma and `@prisma/client` remain on the existing compatible 6.19.x versions, with the `prisma-client-js` generator and imports from `@prisma/client`. Build dependencies, including Prisma CLI and Nest CLI, must be installed during the build stage. Run `pnpm install --frozen-lockfile`, then `pnpm build`, from the backend directory. The build does not execute migrations or seed data; `pnpm start:prod` runs `dist/src/main.js`. The seed remains separately available through `pnpm prisma:seed` and creates catalog content only.

The current app permits public registration and has deliberately public player-profile and guest-feedback endpoints. `APP_ENV=qa`, CORS, and hidden signup links do not restrict access to approved testers. Protect the entire QA frontend with an identity-aware access gateway (such as Cloudflare Access restricted to tester email addresses), covering `/api/graphql` and `/f/*` as well as pages. Ensure the Railway origin domain cannot bypass this gate. Keep the backend and PostgreSQL private inside Railway; the Next.js server can call the backend over its internal hostname. A QA-only HTTP Basic Auth gateway is an alternative for a small tester group, provided every route and alternate origin is covered.

Use a separate QA database, Clerk instance and guest capability secret, keep `NODE_ENV=production`, and provision `DATABASE_URL` from the PostgreSQL service. Migrations are a separate deployment operation (`pnpm prisma:deploy`) against the intended environment, and are never run by the build command. QA access protection also applies to guest QR/feedback links; recipients must be approved QA testers unless a deliberate exception is configured.


### Initialize a database

The Clerk fresh-start migration intentionally refuses ordinary unreviewed migration deployment. Use the backup-gated cutover procedure in [Clerk migration and operations](docs/clerk-migration.md) for both existing and empty databases. Builds never migrate or reset data. After cutover, `pnpm prisma:seed` upserts the five volleyball categories without creating accounts.

## Internal player ratings V1

The complete internal skill rating system and self-assessment history are implemented separately from feedback averages. See [architecture, formulas, API, migration and backfill instructions](docs/internal-ratings.md). Analytics offers Internal Rating and Self-Assessment history modes alongside Daily Average and Each Feedback. The Railway config now explicitly clears automatic pre-deploy migration commands: migrations and the optional backfill must be run by an authorized release operator before the new API serves traffic.

## Assigned feedback approvals

Feedback invitations can optionally designate a registered reviewer. Assigned drafts remain private and Pending until that reviewer approves or rejects them from Account. Approval atomically publishes feedback and integrates with existing internal ratings. See [workflow, GraphQL operations, migration and Railway deployment instructions](docs/feedback-approvals.md).

## Multi-match feedback requests

Feedback links can review selected matches individually or as one combined review. Same-device individual submissions queue every selected match for the assigned giver’s independent approval. See [behavior, compatibility, API, deployment and validation](docs/multi-match-feedback.md). Apply the additive `20261113000000_multi_match_feedback` migration explicitly before deploying the matching backend/frontend; no automatic migration or backfill is added.

## Optional feedback observation processing

Private asynchronous extraction, pgvector observation embeddings, retryable jobs, and profile invalidation are available through a separate worker. See [setup, eligibility, and maintenance](docs/feedback-processing.md). The new migration requires a pgvector-capable PostgreSQL server; provider processing remains disabled unless explicitly configured.

## Deterministic feedback analytical profiles

Step 2 extends the existing cache with consent-gated SQL statistics, trends, reviewer diversity, weakness scoring, and authenticated GraphQL queries. See [rules, rebuild commands, and API examples](docs/player-feedback-analysis.md). Profile rebuilding makes no LLM calls.

Historical AI feedback processing: [preview, backfill and readiness commands](docs/feedback-backfill.md).

Feedback privacy purposes, policy routes, migration and rollout: [privacy operations](docs/feedback-privacy.md).

Approval bell, responsive review cards, history API and deployment: [approval notifications](docs/approval-notifications.md).

Decimal peer feedback (1.0–5.0 in tenths): see [implementation, migration and Railway rollout notes](docs/decimal-feedback-ratings.md). Self assessments remain whole-number ratings.

AI evidence eligibility is separate from verified internal ratings. See [trust classifications, pending-review privacy, backfill and Railway rollout](docs/feedback-ai-eligibility.md).

Backend training library, deterministic drill targeting, and private video infrastructure: see [setup, GraphQL examples, worker contracts and deployment notes](docs/training-backend.md). Video analysis providers are intentionally unconfigured; no CV results are fabricated.

See [coach video uploads and real movement comparison](docs/video-technique-comparison.md) for the CPU worker, private storage, training UI, tests and deployment instructions.

Google/Facebook sign-in, account linking, verified-email onboarding and password recovery setup: [Social authentication](docs/social-auth.md). Provider credentials and rollout steps are required before enabling either provider.

Email verification for new accounts: [flow, local testing, Resend/Cloudflare/Railway setup](docs/email-verification.md).
