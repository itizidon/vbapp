# Fresh Clerk accounts in QA and production

Both environments use Clerk as the sole account authority. There is no PostgreSQL User table. Matches, feedback, ratings and training activity store scalar Clerk IDs; current account details and player settings live in Clerk.

## Isolate the environments

Create separate Clerk applications named `BVBTips QA` and `BVBTips Production`, and use a separate Railway PostgreSQL database for each. Do not reuse the local Clerk application or production accounts in QA.

For initial private QA, the QA application's development instance can be used. For production-like staging, configure the QA application's production instance on a dedicated QA custom domain. The actual production website must use the production application's activated production instance, its own domain configuration and live keys. Enable the intended identifiers, email verification and social connections independently in each application. Production social connections need their own configured credentials in Clerk.

## Railway variables

Set these separately in each environment, using its actual public HTTPS domains:

| Variable | Frontend service | Backend service |
| --- | --- | --- |
| `NODE_ENV` | `production` | `production` |
| `APP_ENV` | Optional `qa` or `production` | `qa` or `production` |
| `FRONTEND_URL` | Public frontend origin | Same public frontend origin |
| `GRAPHQL_API_URL` | Backend URL followed by `/graphql` | Not needed |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | That environment's Clerk publishable key | Not needed |
| `CLERK_SECRET_KEY` | That environment's Clerk secret key | Secret key from the same Clerk instance |
| `CLERK_ISSUER` | Not needed | Exact issuer from that Clerk instance |
| `CLERK_AUTHORIZED_PARTIES` | Not needed | Public frontend origin |
| `CORS_ORIGINS` | Not needed | Public frontend origin |
| `DATABASE_URL` | Not needed | Its own Railway PostgreSQL URL |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Not needed | Its own webhook endpoint's secret |
| `CLERK_DELETION_WORKER_ENABLED` | Not needed | `true` |
| `GUEST_CAPABILITY_SECRET` | Not needed | Independent random secret, at least 32 characters |
| `CLERK_ALLOW_CUTOVER_MEDIA_CLEANUP` | Not needed | `false` until old private-media cleanup is reviewed |

Frontend route settings remain `/login`, `/signup`, `/matches` for sign-in fallback and `/onboarding` for sign-up fallback. Rebuild the frontend after setting its publishable key. Keep other existing feature, storage and AI settings separate per environment.

## Webhooks

In each corresponding Clerk application, create a webhook to the public backend URL followed by `/auth/clerk/webhooks`, subscribing to `user.deleted` and `user.updated`. Put the signing secret in that backend's variables. The endpoint must be reachable from Clerk even if normal backend access uses Railway private networking. No ngrok URL is used for deployed QA or production.

## Database fresh start

The local reset did not change QA or production. Each target needs the [explicit backup-gated cutover](clerk-migration.md#destructive-fresh-start-cutover) before this release serves traffic. Builds and normal startup do not perform that reset.

Preview the exact selected database and review its inventory first. An existing-database cutover removes old accounts and their dependent matches, reviews, ratings, AI history and player training activity; independent curriculum and reusable reference media are preserved. Create and restore-test the backup, stop writers, then perform the approved cutover. Store backups durably outside an ephemeral deployment filesystem. The cutover tool requires compatible `pg_dump` and `pg_restore`; do not assume the Railway application image includes them. Because Railway QA also uses `NODE_ENV=production`, the CLI's production guard applies there as well; its acknowledgement flag does not select or verify the environment for you.

## Validate and release

Complete QA first: signup, verification, onboarding, email/password and social sign-in, match creation, guest feedback/approval, public/private history, and signed webhook delivery. Create the first administrator in Clerk's trusted private metadata after onboarding. Keep QA tester access restrictions in place; `APP_ENV=qa` and CORS are not access controls.

For production, repeat the reviewed cutover and validation against the separately identified production services and Clerk instance. New users register through Clerk; old account passwords and IDs are not imported or reconnected. No QA or production changes are performed by writing this guide.

Official reference: [Clerk environment and staging guidance](https://clerk.com/docs/guides/development/managing-environments).

Service-specific JSON templates with the supplied Railway domains: [Railway Clerk variables](railway-clerk/README.md). These templates contain placeholders for secrets and have not been deployed.
