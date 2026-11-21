# Production fresh-start Clerk runbook

Production frontend: `https://bvbtips.com`.
Production backend: `https://vbapp-production-d5d7d619.up.railway.app`.

The preview is read-only and is not the migration. Complete QA signup, verification, onboarding, matches and feedback before releasing production. The production fresh start removes old database accounts and their application activity, preserving independent curriculum and reusable reference media. Users register again in Clerk; there is no new PostgreSQL User table.

## 1. Prepare Clerk production

Use the separate production Clerk application's activated Production instance. Configure `bvbtips.com`, add the DNS records Clerk provides and wait for verification. Enable email/password, verified email and username. Configure production Google/Facebook OAuth credentials and Clerk's exact redirect URIs if those providers are enabled. Do not use QA/development keys for the production domain.

Copy that instance's publishable key (`pk_live_...`), secret key (`sk_live_...`) and exact issuer/Frontend API URL directly into Railway. Never commit completed secret templates.

## 2. Set production Railway variables

Use [production backend JSON](production-backend.example.json) and [production frontend JSON](production-frontend.example.json). Replace every `__REPLACE_...__` marker. The frontend and backend must use keys from the same production Clerk instance.

Backend: preserve its production PostgreSQL `DATABASE_URL`; use `NODE_ENV=production`, `APP_ENV=production`, and `https://bvbtips.com` for `FRONTEND_URL`, `CORS_ORIGINS` and `CLERK_AUTHORIZED_PARTIES`. Leave `CLERK_JWT_KEY` and `CLERK_AUDIENCE` blank unless deliberately configured. Use an independent `GUEST_CAPABILITY_SECRET`, generated with `openssl rand -hex 32`. Keep `CLERK_ALLOW_CUTOVER_MEDIA_CLEANUP=false` pending separate review.

Frontend: set `FRONTEND_URL=https://bvbtips.com` and `GRAPHQL_API_URL=https://vbapp-production-d5d7d619.up.railway.app/graphql`, plus the production Clerk keys and the supplied route variables. Keep unrelated OpenAI and storage variables configured separately. Variable changes alone do not migrate or initialize the database.

## 3. Configure the production webhook

In the production Clerk instance, create this endpoint:

```text
https://vbapp-production-d5d7d619.up.railway.app/auth/clerk/webhooks
```

Subscribe to `user.deleted` and `user.updated`. Put that endpoint's own `whsec_...` signing secret into the production backend's `CLERK_WEBHOOK_SIGNING_SECRET`. Keep `CLERK_DELETION_WORKER_ENABLED=true`. No ngrok URL is used.

## 4. Pause production writes and preview

Schedule the cutover and prevent live writes from the frontend, old backend and workers. A temporary preview deployment replaces the API process; it is not an online server. Use the exact code revision intended for release.

Commit/push `railway.production-clerk-preview.json`. In only the production backend service, select `/railway.production-clerk-preview.json` as its Railway Config File. It specifies:

```text
Build: pnpm build
Pre-deploy: empty
Start: pnpm clerk:cutover --dry-run --allow-remote --allow-production
```

Deploy once and review the inventory in deployment logs. Verify the selected Railway service/environment and production database reference; database names such as `railway` and internal hosts such as `postgres.railway.internal` can be identical in QA and production. The inventory lists identity/activity removal and independent content preservation. `emptyDatabase` means the bootstrap path is needed; `alreadyCutOver` means the identity reset has already completed and must not be repeated. Any error or unexpected state requires investigation before continuing. A preview can fail if prerequisite historical migrations/tables are missing; do not run ordinary `db:deploy` as a workaround that blindly retries the final cutover.

## 5. Prepare a real administration terminal

Do database operations from a one-off administration terminal or your workstation with the release code and compatible PostgreSQL client tools. They do not belong in Build, Start or automatic Pre-deploy commands. Use a production connection reachable from that terminal. A workstation cannot directly resolve `postgres.railway.internal`; obtain the intended production database's external TCP-proxy connection or an authenticated tunnel. Railway SSH operates inside a deployment; `railway run`/`railway shell` run locally with variables and do not by themselves provide private-network connectivity.

For a workstation, build the backend first. Then set the actual production database URL privately in that terminal, without putting it in shell history or the local development `.env`:

```bash
read -rsp 'Production database URL: ' DATABASE_URL
printf '\n'
export DATABASE_URL
export NODE_ENV=production APP_ENV=production
pg_dump --version
pg_restore --version
```

Do not continue if compatible PostgreSQL backup tools are unavailable. The standard Railway Node application image may not include them. Keep backups on durable restricted storage, not only an ephemeral deployment filesystem. The commands below use the workstation's ignored `.backups/production-clerk` directory.

Repeat the read-only preview from that same administration terminal to verify its selected connection:

```bash
pnpm clerk:cutover --dry-run --allow-remote --allow-production
pnpm exec prisma migrate status
```

## 6. Take and restore-test an independent backup

Before migration-history recovery or destructive execution, take a production backup and restore it into a separate empty recovery database. Use the public connection details for the intended production database and compatible PostgreSQL tools. These example host/port/user names must be replaced; passwords are entered through the client's prompt, not saved in scripts:

```bash
umask 077
mkdir -p .backups/production-clerk
pg_dump --host=PRODUCTION_PROXY_HOST --port=PRODUCTION_PROXY_PORT --username=PRODUCTION_DB_USER --dbname=railway --password --format=custom --file=.backups/production-clerk/before-clerk.dump
pg_restore --list .backups/production-clerk/before-clerk.dump
pg_restore --host=RECOVERY_HOST --port=RECOVERY_PORT --username=RECOVERY_USER --dbname=EMPTY_RECOVERY_DATABASE --password --no-owner --no-acl --exit-on-error .backups/production-clerk/before-clerk.dump
```

Use the database name verified in the preview if it is not `railway`, and preserve any required SSL settings from the connection configuration. Validate restored table counts and curriculum/reference content against the production inventory. The recovery database is separate from production; do not restore over production. Retain the backup and the previous matching application release for recovery. The cutover CLI will additionally create and validate its own current dump/manifest immediately before its reset.

## 7. Recover a failed migration only when applicable

If migration status reports no failed migration, skip this step. A QA failure does not imply a production failure. If production has a failed `20261126000000_clerk_identity_cutover`, inspect its original error and schema using the queries in [the recovery instructions](../clerk-migration.md#recovering-an-ordinary-deploy-that-attempted-the-cutover). Confirm that the transaction rolled back entirely. Only after that confirmation, mark that failed attempt rolled back:

```bash
pnpm exec prisma migrate resolve --rolled-back 20261126000000_clerk_identity_cutover
```

This updates migration history; it does not undo SQL. Never mark the cutover applied when its schema has not been installed. A mixed or unexpected schema requires diagnosis/recovery first. Do not remove the migration's backup permit guard.

## 8. Perform the reviewed fresh start once

Only after reviewing the actual production inventory, preserving the backup, confirming recoverability and keeping writers stopped, run this from the same selected administration terminal:

```bash
pnpm clerk:cutover --execute --allow-remote --allow-production --confirm-database railway --backup-dir .backups/production-clerk
```

Use the exact database name from the preview if different. Do not add `--env-file=.env`; that could select the local development connection. The tool creates a new restricted dump and manifest, validates the archive, checks unchanged source fingerprints and applies the transactional reset. It retains independent content and queues old private-media cleanup without deleting external objects during this command.

Require successful completion with `complete: true` and `userTableGone: true` (or a previously verified `alreadyCutOver: true`). If it fails, stop and inspect the original error, migration state and saved backup; do not automatically reset or retry.

After successful cutover:

```bash
pnpm exec prisma migrate status
pnpm prisma:seed:deploy
```

The compiled seed creates/updates catalog content, not demo accounts. It is not a replacement for schema migrations. Preserve copies of the new dump and manifest outside the ephemeral release environment.

## 9. Restore normal backend deployment and rebuild frontend

Change only the production backend's Railway Config File back to `/railway.backend.json`, then deploy the matching release. Its normal settings are:

```text
Build: pnpm build
Pre-deploy: empty
Start: pnpm start:prod
```

Do not leave the preview config selected: the preview exits rather than serving the API. Rebuild/redeploy the production frontend after its Clerk publishable key is configured. Make sure frontend and backend traffic point to the same production environment before reopening access.

## 10. Validate the release

At `https://bvbtips.com`, create a fresh account, verify email and complete onboarding. Test email/password and each enabled social provider, sign out and sign in again, create/edit a match, submit guest feedback, approve assigned feedback and verify privacy restrictions. Confirm that independent skills/drills/reference demonstrations survived. AI and video testing still require their own existing feature settings and consent.

Bootstrap the first ADMIN through Clerk's trusted private metadata, preserving existing onboarding fields; do not put a role in unsafe metadata. See the [role instructions](../clerk-migration.md#coach-and-admin-roles).

Test a signed `user.updated` webhook for HTTP 200. For a specifically designated disposable account, test deletion and verify actual application cleanup, not only webhook receipt. Resume workers and writes, monitor errors and deletion jobs, and keep backups under the applicable retention policy. Old private-object cleanup remains disabled until separately reviewed.

This guide performs no production action itself. Production credentials, original migration logs, backup availability and external Dashboard configuration must be verified in the actual target environment.

References: [Clerk production deployment](https://clerk.com/docs/guides/development/deployment/production), [Railway SSH](https://docs.railway.com/cli/ssh), [Prisma failed migration recovery](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/patching-and-hotfixing).
