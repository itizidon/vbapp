# Clerk identity cutover

Clerk owns identity, credentials, Google/Facebook connections, verified email, sessions, username, name, avatar and current player settings. PostgreSQL stores application activity with scalar Clerk IDs. There is no `User` model, local directory, password table, provider table, session table, verification challenge or current-profile mirror.

## Configure development

Create a Clerk development application. In its Dashboard, enable email/password, require verified email, enable usernames, and enable Google and Facebook connections. Development instances can use Clerk's shared social credentials. Production instances require the provider credentials and redirect URIs shown by Clerk; do not reuse the retired BVBTips OAuth callback routes. Configure the application's allowed frontend origins and redirects for each environment.

Copy the example environment files without overwriting existing secrets. Backend `.env` needs:

```dotenv
DATABASE_URL=postgresql://...
FRONTEND_URL=http://localhost:3001
CORS_ORIGINS=http://localhost:3001
CLERK_SECRET_KEY=sk_test_...
CLERK_ISSUER=https://YOUR-INSTANCE.clerk.accounts.dev
CLERK_AUTHORIZED_PARTIES=http://localhost:3001
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
CLERK_DELETION_WORKER_ENABLED=true
GUEST_CAPABILITY_SECRET=YOUR-INDEPENDENT-RANDOM-SECRET-AT-LEAST-32-CHARACTERS
CLERK_ALLOW_CUTOVER_MEDIA_CLEANUP=false
```

`CLERK_ISSUER` must exactly match the instance's session token issuer. `CLERK_AUTHORIZED_PARTIES` is a comma-separated list of exact frontend origins; configure local, QA and production separately. Optional `CLERK_JWT_KEY` accepts the instance PEM public key, and `CLERK_AUDIENCE` is only needed when a matching audience is configured. The optional static key avoids a network signature-key lookup; live account/session checks still run.

Frontend `.env.local` needs:

```dotenv
GRAPHQL_API_URL=http://localhost:3000/graphql
FRONTEND_URL=http://localhost:3001
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/signup
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/matches
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding
PRIVACY_CONTACT_EMAIL=support@bvbtips.com
```

Both services must use the same Clerk instance. Only the publishable key belongs in browser code. Keep secret keys, webhook secrets and guest capability secrets server-side. Remove retired `JWT_SECRET`, OAuth state/client secrets, SMTP/Resend account-authentication settings and editor UUID allowlists. Existing guest invitations and account sessions are intentionally invalid after the fresh start.

Build using Node 22+ (`pnpm install --frozen-lockfile && pnpm build`), prepare PostgreSQL with pgvector, perform the explicit cutover below, then run `pnpm prisma:seed`, `pnpm start:dev`, and `cd frontend && npm ci && npm run dev`. Builds do not migrate, delete or backfill data. The seed creates catalog content only; there are no demo accounts/passwords.

## Authentication and onboarding

Next.js uses `ClerkProvider`, Clerk sign-in/sign-up widgets and `clerkMiddleware` in `proxy.ts`. Protected pages require a session; missing configuration shows a setup message. The server-side GraphQL proxy calls `auth().getToken()` and forwards the bearer token in the HTTP header. It does not issue account cookies or put credentials in URLs. Clerk handles account editing, password recovery and deletion through `UserProfile` on Account.

NestJS verifies the signed Clerk token using the official backend SDK, the exact issuer and authorized parties, optional audience, expiration and session claims. It checks the live Clerk session/account and requires a verified primary email. Revoked/deleted/banned accounts fail closed; provider outages return an availability error. Legacy BVBTips account JWTs and cookies confer no access. Anonymous feedback invitations retain only their own explicitly scoped authority.

New verified users complete `/onboarding` before protected domain operations: age, height, volleyball level and active required backend skill ratings. All current values are saved through the backend to Clerk metadata. No webhook or first login creates a PostgreSQL identity record.

Private metadata contract:

```json
{"bvbtips":{"version":1,"role":"PLAYER","age":25,"heightCm":180,"aiCoachingEnabled":false,"assessment":{"id":"ASSESSMENT-UUID","sportId":"SPORT-UUID","overallLevel":"B","ratings":[{"skillId":"SKILL-UUID","rating":3}],"revision":"REVISION-UUID","updatedAt":"2026-11-20T12:00:00.000Z"}}}
```

An optional `trainingPreferences` object holds training settings. Public metadata contains only `{"bvbtips":{"version":1,"isPublic":false,"onboardingComplete":true}}`. Unsafe metadata never grants roles, onboarding, ownership or privacy consent. Missing/malformed trusted metadata defaults to PLAYER, private and AI disabled. Payloads are bounded to 6 KB. Profile writes serialize per player using a database advisory lock; current values remain in Clerk, while changed skill values reconcile idempotently into immutable domain events. Interrupted reconciliation retries on the next protected request. Edits do not reset established internal ratings.

The app never trusts a caller-supplied creator/actor ID. Resource ownership, registered-player validation, approval authority, video access and coach permissions still run in the backend. Current metadata is read fresh for permission/privacy decisions. Display names use request batching, chunks of 100 and a bounded 15-second in-memory cache; email is returned only in the account owner's private profile. Searches can match email without exposing it in results. Missing records show an unavailable/deleted label, and rate-limit failures are sanitized.

## Coach and admin roles

Bootstrap the first ADMIN manually in the Clerk Dashboard's **private metadata**, preserving the user's existing `bvbtips` fields and setting `version: 1, role: "ADMIN"`. Never put privileged roles in unsafe metadata or an editable form. A trusted ADMIN may subsequently use `setPlayerRole(userId: ID!, role: String!)` to assign PLAYER, COACH or ADMIN. Ordinary metadata/profile mutations preserve the existing trusted role. COACH/ADMIN can manage drills/reference demonstrations; player uploads remain restricted to their verified owner. Old environment UUID allowlists grant no privileges.

## User deletion and webhooks

Configure a signed Clerk webhook to the backend `POST /auth/clerk/webhooks`, subscribing to `user.deleted` and `user.updated`. Use the endpoint signing secret as `CLERK_WEBHOOK_SIGNING_SECRET`. Local testing requires a secure tunnel to the backend, configured in Clerk. The route verifies the raw request body using the official SDK; unsigned payloads cannot enqueue deletion. Updated events only invalidate display caches. No creation webhook mirrors users.

Deletion events create idempotent operational `ClerkDeletionJob` receipts, keyed by signed event ID. The leased worker retries failures and clears the stored subject ID when complete. It deletes the subject's private AI conversations/profiles, private media submissions/analyses, training progress and rating data. It anonymizes the subject in shared matches and reviews while preserving other players' shared scores/numerical history and frozen reviewer influence. Written feedback and identifying labels are redacted. Shared curriculum stays intact, with deleted creator/uploader attribution set null. Private object keys are queued for the existing storage cleanup worker and scrubbed after deletion. Reference media is retained. Operational receipts are not a user directory.

Preview/retry queued deletions against the explicitly selected environment:

```bash
node --env-file=.env dist/src/auth/clerk/deletions-cli.js --dry-run
node --env-file=.env dist/src/auth/clerk/deletions-cli.js --execute --batch-size 100
```

Monitor pending/failed receipts and cleanup jobs. If Clerk or storage is unavailable, work remains queued; never claim immediate object erasure solely because the webhook returned 200.

## Destructive fresh-start cutover

**This operation removes ALL old accounts and their application activity. It is not an account migration. Stop all old API/worker writers and review the inventory and backup before execution. Never run it automatically in production.**

The identity tables removed are `User`, `UserAuthProvider`, `OAuthTransaction`, `AuthEmailChallenge`, and `AuthProviderDeletion`. Current `SelfAssessment`, `SelfAssessmentRating` and `PlayerTrainingProfile` tables are also removed; their replacement current fields live in Clerk. Old unused `LegacyPlayerSkillRating`/`LegacyPlayerSportRating` archives are dropped.

Activity cleared: matches/teams/participants; feedback/ratings/reviewer snapshots; internal ratings/contributions/events and self-rating events; feedback links/request-match/feedback-match/submission records; extraction runs, jobs, observations and embeddings; analytical profiles; AI conversations/turns/usage; feedback privacy events; private drill submissions/video analyses/reference associations; skill progress and drill completions. The exact table inventory and row counts are printed by `--dry-run`; see also [dependency map](clerk-dependency-map.md).

Preserved: `Sport`, `Skill`, `FeedbackTheme`, `SkillTreeNode`, `SkillPrerequisite`, `Drill`, `DrillStep`, `DrillSkill`, `CoachingSituation`, `DrillRecommendationRule`, `DrillTechniqueVariant`, `DrillReferenceVideo`, `TechniqueCheckpoint`, `VideoWorkerHeartbeat`, and reference-only `VideoPoseArtifact`/`VideoProcessingJob` records. Old drill creator/reference uploader attribution becomes null; every other independent content field is fingerprint-checked. Reference object storage is untouched. Old private player object deletion is queued, disabled until explicitly enabled with `CLERK_ALLOW_CUTOVER_MEDIA_CLEANUP=true` after reviewing the manifest/jobs.

All surviving identity references become TEXT scalar Clerk IDs, without a User foreign key. Entity UUIDs and entity foreign keys remain. Changed identity-bearing models are listed in the dependency map; `SelfAssessmentRatingEvent` additionally tracks the metadata revision for idempotence. `ClerkDeletionJob` is the sole new operational model.

Preview the exact target (no writes):

```bash
pnpm clerk:cutover --env-file=.env --dry-run
```

Execute locally only after reviewing it, substituting your actual database/container names:

```bash
pnpm clerk:cutover --env-file=.env --execute --confirm-database sports --backup-dir .backups/clerk --docker-container vbapp-postgres-1
```

Use native compatible `pg_dump`/`pg_restore` when no Docker option is supplied. Docker mode checks the container's published PostgreSQL port against the selected local target. The command writes a permission-restricted custom-format dump and JSON manifest containing database identity, SHA-256, exact table counts and state fingerprints before granting a short-lived migration permit. The migration locks/rechecks the backed-up state and aborts if writers changed it. Keep backups outside the deployment image/repository, encrypted under your backup policy, and test restoring them.

An empty database uses the same command: historical schema migrations initialize it, then a backup/permit gates the final identity cutover. A previously completed cutover reports already complete. A failed migration never triggers an automatic reset/retry; inspect `_prisma_migrations`, restore/test the backup and use Prisma's documented migration recovery procedure before retrying. Do not edit a deployed migration.

Example restore into a **separate empty recovery database**, never over the running target:

```bash
pg_restore --dbname="$RECOVERY_DATABASE_URL" --no-owner --no-acl .backups/clerk/REVIEWED-BACKUP.dump
```

Verify manifest SHA-256, counts and curriculum fingerprints, and restore the matching old application release when recovering pre-Clerk data. Switch application traffic only after verifying the recovery database. A backup contains personal data and legacy credential hashes; restrict access and retention.

## Recovering an ordinary deploy that attempted the cutover

If `pnpm db:deploy` or `prisma migrate deploy` reaches `20261126000000_clerk_identity_cutover` without the cutover tool, the migration intentionally rejects the missing/expired backup permit. Prisma can display only `current transaction is aborted`; that message alone does not prove which earlier statement failed. Do not remove the guard, edit the applied migration, mark it applied, or repeatedly retry ordinary deploys.

The updated `db:deploy` command now performs a read-only preflight before migrations or seeds. It stops clearly for an empty/legacy schema or a recorded failed migration. Build this release before using that compiled command.

Identify the exact Railway environment and service first: both QA and production databases may be named `railway` on hosts named `postgres.railway.internal`. These names alone cannot distinguish the targets. Pause automatic migration retries and source writers while diagnosing the intended target.

Inspect migration status in the selected backend's environment:

```bash
pnpm exec prisma migrate status
```

If you need the cutover inventory from a temporary Railway deployment rather than a shell, use the QA-only `railway.qa-clerk-preview.json` file. Push the file with the release, then select **only the QA backend** and set its Railway Config File path to `/railway.qa-clerk-preview.json`. Its build command is `pnpm build`; its start command is the read-only `pnpm clerk:cutover --dry-run --allow-remote --allow-production`; pre-deploy commands are empty and automatic restarts are disabled. Configuration-file values override dashboard settings. The preview exits after printing its inventory and does not serve HTTP, so do not interpret it as a healthy API deployment. Review the logs and restore the normal `/railway.backend.json` config before serving the API after recovery. Never select this preview file for the production service. Do not put the diagnostic command in both build and start fields.

Using a PostgreSQL client connected to that same selected database, inspect the original migration record and schema state:

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name = '20261126000000_clerk_identity_cutover'
ORDER BY started_at DESC;

SELECT current_database(),
       to_regclass('public."User"') IS NOT NULL AS legacy_user_table,
       to_regclass('public."ClerkDeletionJob"') IS NOT NULL AS clerk_job_table,
       to_regclass('public."_ClerkCutoverPermit"') IS NOT NULL AS backup_permit_table;
```

If the logged failure and schema inspection confirm the cutover transaction rolled back entirely, mark only that failed attempt rolled back so the reviewed cutover can retry it:

```bash
pnpm exec prisma migrate resolve --rolled-back 20261126000000_clerk_identity_cutover
```

`migrate resolve` changes migration history; it does not undo SQL. Do not run it as an assumption or mark the cutover `--applied`. A mixed/unexpected schema requires investigation or recovery from backup first. Earlier successfully applied migrations remain applied.

Then preview the actual cutover, using Railway-provided environment variables rather than a local `.env` file:

```bash
pnpm clerk:cutover --dry-run --allow-remote --allow-production
```

QA also needs the production acknowledgement flag when `NODE_ENV=production`. This preview performs no reset. Review its target and counts before using the backup-gated execution procedure above. The execution host must have compatible PostgreSQL backup tools and durable backup storage; a standard Node deployment image may not have either. After successful cutover, ordinary `db:deploy` can apply later migrations and seed catalog content. No remote migration recovery is performed automatically by this documentation or the preflight.

## Older schemas missing prerequisite tables

For the supported six missing AI-eligibility/training/video/auth migrations, use the separate [backup-gated prerequisite preparation](clerk-prerequisites.md) before the Clerk reset. `pnpm clerk:prepare --dry-run --allow-remote --allow-production` previews that plan; only its explicit execute mode installs prerequisites after creating a verified backup. It excludes the final identity reset.

## Preview diagnostics

Updated previews start with JSON containing `tool: "clerk-cutover"`, `diagnosticsVersion: 1`, the non-secret database target and `mode: "dry-run"`. Failures now identify `phase`, `code` and a safe explanation, without serializing connection strings, raw Prisma errors, SQL record details or subprocess stderr.

- `INVALID_DATABASE_URL`: the service variable is absent, a placeholder or not a PostgreSQL URL.
- `P1000` / `P1001`: database authentication or connectivity failed; verify the selected service's database reference and network access.
- `MISSING_PREREQUISITE_TABLES`: the preview lists exact missing historical tables. A production database may not yet contain the intermediate auth/training schema required by this cutover. Inspect its historical migration state; do not remove the backup guard or blindly retry `db:deploy`.
- `FAILED_MIGRATIONS`: execute mode stops before backup/permit creation when unresolved failures exist. Dry-run mode can still inventory an otherwise complete legacy schema and list those failed migration names.
- `ENOENT` in backup phases: compatible backup executables may be missing from the runtime image.

Railway may show only the structured log `message` in its default view. Expand the error entry and inspect its `missingTables`, `failedMigrations`, `phase` and `code` attributes; copying only visible message text can omit these fields. Updated missing-table errors also list table names in the visible message.

The preview remains read-only and never resolves migrations automatically. If deployment logs contain only the previous generic failure sentence, the updated tool has not been deployed. Repeated process starts are deployment restarts or separate invocations, not an internal cutover retry loop. Preview configs specify `restartPolicyType: "NEVER"`; inspect the latest deployment's effective config if the platform keeps restarting it. Keep the actual database intact until the diagnostic output identifies the failure and the reviewed backup/recovery procedure is ready.

## Production rollout (manual only)

Provision a separate production Clerk instance, provider credentials, exact issuer/origins and verified email policy. Configure backend/frontend server secrets and webhook endpoint. Protect QA separately; CORS/APP_ENV are not tester access controls. Review the inventory with release owners, stop writes/workers, take and restore-test the backup, and only then invoke the CLI with explicit `--allow-remote --allow-production --execute --confirm-database NAME --backup-dir SECURE-PATH` in the selected environment. The flags are operator acknowledgements, not authorization to run production changes from this task. Do not put destructive migrations in automatic pre-deploy hooks.

Deploy matching backend/frontend, create a fresh Clerk account, finish onboarding, bootstrap the trusted administrator, verify curriculum/reference media, then test regular/Google/Facebook sign-in, verification, sign-out/revocation, guest review/approval, private/public history, video ownership and signed deletion. Resume workers and monitor errors, Clerk API rate limits and deletion receipts. Do not enable paid AI processing or historical media cleanup without the existing separate switches/consent.

## Verification boundary

Automated tests use the real Clerk signature verifier with locally generated RSA fixtures and an in-memory fake Clerk API. Database tests run on a disposable pgvector PostgreSQL instance with no identity table. This covers token rejection, role/ownership checks, onboarding/history reconciliation, guest reviews, approvals, deletion and content-preserving migration. Real Clerk accounts, social providers, delivery of verification email and production webhooks require the Dashboard credentials/settings above and a live manual smoke test; mocked tests do not prove those external configurations.

Completed local reset, exact model changes, backup evidence and test results: [verification report](clerk-verification.md).
