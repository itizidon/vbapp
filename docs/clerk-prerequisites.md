# Prepare historical schema before the Clerk reset

The reported production preview found 23 missing tables and no failed migration records. These tables correspond to the five migrations after `20261121000000_separate_ai_rating_eligibility` and before the Clerk reset:

1. `20261122000000_training_library`
2. `20261123000000_motion_comparison`
3. `20261124000000_social_auth`
4. `20261124010000_oauth_deletion_replay`
5. `20261125000000_email_verification`

The original cutover assumed these were already applied. `clerk:prepare` now supports this older schema as a separate operation. It checks actual migration history and refuses older unsupported baselines, recorded failures or drift. It never selects `20261126000000_clerk_identity_cutover` or later migrations for its deployment tree.

## Read-only preview on Railway

Commit/push the new code, package script and `railway.production-clerk-prerequisites-preview.json`. Select only the production backend with public domain `vbapp-production-d5d7d619.up.railway.app` and set Railway Config File to:

```text
/railway.production-clerk-prerequisites-preview.json
```

The build is `pnpm build`, pre-deploy commands are empty, and the start command is:

```bash
pnpm clerk:prepare --dry-run --allow-remote --allow-production
```

This prints pending migration names and existing table counts, then exits without writing. It does not create a backup, resolve migration failures, install schema or reset users. Review that plan and the selected database before proceeding.

## Apply prerequisites with a verified backup

Stop application writers and use a real administration terminal connected to the intended production database. Follow the [production runbook](railway-clerk/production-runbook.md) for secure environment selection, compatible PostgreSQL tools, an independent restore-tested backup and durable restricted backup storage. A standard Railway Node image may not contain `pg_dump` or `pg_restore`. Do not place the execute command in Build/Start or an automatic Pre-deploy command.

Once the plan, selected database and backup arrangements are reviewed, use the database name from the preview:

```bash
pnpm clerk:prepare --execute --allow-remote --allow-production --confirm-database railway --backup-dir .backups/production-clerk-prerequisites
```

This takes and validates its own full database dump and manifest before migrating. It fingerprints existing records and checks the source has not changed since backup. It applies only the permitted historical prerequisites through a temporary migration tree with the final Clerk reset excluded. It verifies that required tables exist and existing row counts remain unchanged. It does not create a Clerk reset permit. Successful output contains:

```json
{
  "prepared": true,
  "cutoverExecuted": false,
  "existingRecordCountsPreserved": true
}
```

If backup creation/validation fails, no prerequisite migration starts. If schema preparation fails, inspect the resulting migration history and backup; do not automatically reset/retry. Previously completed prerequisite migrations may remain applied. Repeating the read-only plan shows the new state. When already prepared, the command reports that state without repeating migrations.

The intermediate old-auth tables are part of the existing historical migration chain, not a replacement for Clerk or an enabled legacy login system. The final Clerk migration removes them and the old User table. Until the separate final cutover, old account and activity records remain intact.

## Continue with the Clerk cutover

After preparation, restore the production backend's preview config path to:

```text
/railway.production-clerk-preview.json
```

Review that separate read-only reset inventory, then follow the [backed-up Clerk cutover](clerk-migration.md#destructive-fresh-start-cutover). That operation takes a new backup and clears old accounts/activity while preserving independent curriculum/reference content. After successful cutover, restore `/railway.backend.json` for the normal API server and rebuild/deploy the frontend.

The supplied production log has `failedMigrations: []`: do not run `migrate resolve` based on the earlier QA failure. Each database has its own migration state.

## Verification performed locally

A disposable pgvector PostgreSQL database was initialized through migration 17, reproducing the exact 23 missing table names from the production report. Preparation created a validated backup, applied precisely the five missing migrations, preserved a synthetic User, credential value and Match, and created neither a ClerkDeletionJob table nor a reset permit. The separate final Clerk cutover then removed the fixture account/match while retaining a drill and its instruction step, with creator attribution cleared as designed. Restoring the prerequisite backup into another disposable database matched all 32 recorded table fingerprints. All 234 unit tests, TypeScript and backend build checks passed. Production was not connected to or modified by these tests.
