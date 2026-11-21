# BVBTips Railway Clerk variables

These service mappings were supplied by the user. Files are JSON templates for the corresponding Railway service's Variables editor; they have not been applied to Railway.

| Environment | Frontend | Backend |
| --- | --- | --- |
| QA | https://scintillating-wonder-production-92bc.up.railway.app | https://vbapp-production.up.railway.app |
| Production | https://bvbtips.com | https://vbapp-production-d5d7d619.up.railway.app |

## Apply variables

1. Create/select separate Clerk applications for QA and production. For production, activate its production instance and finish domain/DNS and social-provider configuration for `bvbtips.com`. Use that instance's live keys. The production issuer is the exact URL shown by Clerk, not the Railway backend URL or a guessed frontend domain.
2. In each JSON template, replace every value starting with `__REPLACE_` using actual values. These markers are instructions, not working credentials. Do not commit completed templates or paste secrets into chat. Use a private temporary copy or edit directly in Railway.
3. In Railway, explicitly select the intended environment and service. Merge the corresponding JSON into its Variables editor, preserving existing unrelated settings. Backend `DATABASE_URL` is deliberately omitted: retain the environment's existing Railway PostgreSQL reference and confirm QA and production do not share a database. Keep feature/storage/OpenAI variables separately configured.
4. Both services in one environment must use keys from that same Clerk instance. The frontend publishable key and backend issuer must also match it. QA and production must use separate instances. The empty `CLERK_JWT_KEY` and `CLERK_AUDIENCE` fields clear stale optional overrides; configure them only when deliberately using matching settings from that instance.
5. Generate a different guest capability secret for each environment with `openssl rand -hex 32`, then substitute it into the matching backend template.
6. Configure the webhook endpoints below and substitute their individual signing secrets in the corresponding backend variables.
7. Complete the reviewed database cutover before the matching release serves traffic. Rebuild the frontend after its publishable key changes and redeploy both matching services. Variables alone do not remove legacy users or initialize the new schema.

## Webhook endpoints

QA Clerk application's endpoint:

```text
https://vbapp-production.up.railway.app/auth/clerk/webhooks
```

Production Clerk application's endpoint:

```text
https://vbapp-production-d5d7d619.up.railway.app/auth/clerk/webhooks
```

Subscribe both to `user.deleted` and `user.updated`. Each endpoint has its own signing secret. No deployed endpoint uses ngrok. Keep QA access restrictions in place; any access gateway must permit verified Clerk webhook delivery to this backend route.

## Cutover and validation

The existing [backup-gated cutover](../clerk-migration.md#destructive-fresh-start-cutover) removes the old account tables and old user activity, preserving independent catalog/reference content. Local execution did not alter these Railway databases. Stop writers, preview the exact target, review its inventory, back up and restore-test, then execute the approved cutover explicitly. Do QA first. Never put this destructive reset in automatic build/start commands.

After deployment, verify signup, verified email, onboarding, login/logout, private/public history, match creation, guest feedback and approvals. Create the first administrator using trusted private metadata after onboarding. Test `user.updated` webhook delivery for a 200 response and test account deletion with an expendable QA account. Verify actual cleanup, not only webhook receipt. Production deletion testing must use an explicitly designated disposable account.

[Complete QA/production guide](../clerk-qa-production.md) · [Clerk architecture and setup](../clerk-migration.md)

## Read-only production inventory deployment

After the QA preview succeeds, the production backend can use the separate `railway.production-clerk-preview.json` config for the same read-only inventory. Commit/push the file, select the production backend whose public domain is `vbapp-production-d5d7d619.up.railway.app`, and set its Railway Config File to `/railway.production-clerk-preview.json`. Confirm the matching production database variables before deploying. The build remains `pnpm build`; the start command runs `clerk:cutover` with `--dry-run`, `--allow-remote` and `--allow-production`. There are no pre-deploy commands and automatic restarts are disabled.

This prints the target and reset/preservation inventory, then exits. It does not resolve failed migration records, reset accounts, run migrations, create a backup or serve the API. A working preview does not mean the database cutover is complete. Review the inventory before the separate backed-up cutover. Restore `/railway.backend.json` for normal API deployment after recovery/cutover. Neither preview config is a normal server start configuration.

Full ordered production procedure: [production runbook](production-runbook.md).
