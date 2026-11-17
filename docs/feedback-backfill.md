# Historical feedback backfill

This extends the existing `feedback:process` CLI and Step 1 worker. It does not introduce another extraction pipeline. Nothing backfills at startup. Queueing and profile rebuilding are SQL-only; `work --execute` and `watch --execute` explicitly permit paid provider calls.

## Select the environment

Run from the backend directory (`vbapp`), after `pnpm build`. Use `--env-file .env` explicitly, or supply `DATABASE_URL` and model settings through the process environment. A conflicting inherited `DATABASE_URL` and file value is rejected. The CLI prints the selected file, APP_ENV/NODE_ENV, host, port, database, schema and model versions, then verifies `current_database()`. It never prints credentials, the full connection URL, comments or API keys. Stop if this target is unexpected.

Local loopback databases are allowed. Remote databases require `--allow-remote --confirm-database DATABASE_NAME`; production also requires `--allow-production`. These flags are deliberate operator authorization, not automatic environment discovery. Do not use them against production without explicit authorization. Even a preview is a database connection. Node production mode with APP_ENV `qa` is treated as QA; an unset APP_ENV with NODE_ENV production is guarded as production.

The database needs the Step 1 and Step 2 migrations and pgvector; AI Coach additionally needs its chat migration. Apply migrations separately to the intended database. No command in this guide applies migrations or changes feedback consent/approval/publication.

## Preview all history (read-only, no provider calls)

```bash
pnpm build
pnpm feedback:preview --env-file .env --batch-size 100
```

The preview scans all eligible feedback in bounded pages. `--batch-size` controls page/work batch size (1–1000), not the total with `--all`. The aliases `feedback:preview`, `feedback:backfill`, and `feedback:work` include `--all`. The original commands remain available: `pnpm feedback:process enqueue 100 --env-file .env` and `pnpm feedback:process work 100 --env-file .env --execute` process bounded batches. Repeating bounded enqueue advances past existing jobs.

Counts:

- `eligible`: unique feedback IDs passing live publication, assigned-review approval, both analytics/evidence privacy consents, sport, and moderation rules. Known non-ALLOW moderation is excluded; unknown moderation is evaluated by extraction.
- `skipped`: already current extraction **and** configured embeddings, plus ratings-only reviews that need no text processing.
- `remaining`: eligible written reviews with unfinished extraction or embeddings. `failed` is a subset, not an additional count.
- `processed`: newly completed feedback records during this invocation. At preview this is zero. Progress also reports job attempts; attempts are not successes.
- `numericOnly`: eligible reviews without meaningful overall or skill comments.

Estimated operations include one extraction request per unfinished written review, up to two for immediate validation correction, the known outstanding observation embeddings, and a range of 0–50 additional embeddings per extraction (the validated observation cap). Durable retries can add calls, up to five job attempts. This estimates operations, not dollar prices or tokens. Concurrent source changes can alter counts. Failed jobs are reported separately and require explicit retry. No full-comment embeddings are generated.

## Process only your account

Use your `User.id` UUID, not username/email, and the volleyball `Sport.id` UUID. Get these from your authenticated `me`/catalog responses or a read-only SQL lookup in your selected development database. Replace the placeholders below:

```bash
PLAYER_ID='YOUR_USER_UUID'
SPORT_ID='YOUR_VOLLEYBALL_SPORT_UUID'
pnpm feedback:preview --env-file .env --player-id "$PLAYER_ID" --batch-size 100
pnpm feedback:backfill --env-file .env --player-id "$PLAYER_ID" --batch-size 100
pnpm feedback:work --env-file .env --player-id "$PLAYER_ID" --batch-size 100 --execute
```

The second command only queues missing/outdated extraction and missing configured embedding jobs, and initializes missing stale profile rows. It calls no providers. The third prints its own current estimate, then drains due jobs for that player until idle. Future jobs created after this invocation began are deferred. Other players' jobs, embeddings and profile rebuilds are not claimed. `watch` deliberately includes future jobs.

## Rebuild your profile (no LLM or embedding calls)

```bash
pnpm feedback:process profile "$PLAYER_ID" "$SPORT_ID" --env-file .env
```

The profile builder uses eligible numerical ratings even with no comments, observations, vectors or API key. No-comment feedback does not make extraction incomplete. Unsupported technique conclusions remain unavailable when there is no written evidence. Changed eligible sources and extracted observations invalidate the existing profile transactionally. Profiles also expire at the next UTC day for date-sensitive analytics. `feedback:profiles` rebuilds all existing stale/expired rows; use `--player-id` to scope it.

## Process all eligible historical feedback

```bash
pnpm feedback:preview --env-file .env --batch-size 100
pnpm feedback:backfill --env-file .env --batch-size 100
pnpm feedback:work --env-file .env --batch-size 100 --execute
pnpm feedback:profiles --env-file .env --batch-size 100
```

Safe resumption: rerun the same enqueue/work commands. Matching source hashes, provider, model and prompt versions are skipped. Embedding keys include observation/provider/model/version/dimensions/template, and inserts use existing unique constraints. Combined multi-match feedback is visited once by `Feedback.id`, never expanded per associated match. No original feedback is cloned. Workers use database leases, generation checks and live eligibility checks before committing; overlapping workers cannot commit duplicate observations/vectors. A crash after a provider call but before commit can repeat that paid call after lease expiry; exactly-once billing cannot be guaranteed across that boundary.

`--all` drains jobs currently due, not future backoff times. Deferred jobs remain in `remaining`; run again after backoff. Failed jobs are preserved for inspection. Reset only deliberately, in bounded batches:

```bash
pnpm feedback:process retry-failed --env-file .env --player-id "$PLAYER_ID" --batch-size 100
pnpm feedback:process retry-embeddings --env-file .env --player-id "$PLAYER_ID" --batch-size 100
```

Add `--dry-run` to preview without modifying anything. Source edits automatically invalidate old observations/vectors; manual version changes can use `reprocess` (same enqueue policy) or `reembed` (embedding queue only). Known moderation exclusions are never silently reset to make them eligible. Bump prompt or embedding versions when semantics change.

## Verify AI Coach data readiness

```bash
pnpm feedback:ready --env-file .env --player-id "$PLAYER_ID"
```

Check the printed database, migrations/storage, pgvector, profileReady, extractionRemaining, failed counts, model settings and key presence. Embedding counts should reach zero for processed textual observations; zero observations can be normal. A key-present check does not verify account credit/model access. Open Analytics → AI Coach as that account for the final interactive check; sending a question can incur API cost. The CLI readiness check never calls OpenAI. See [AI Coach operations](ai-coach.md).

Tests use disposable PostgreSQL and deterministic fake providers. No backfill or paid processing was run automatically by this implementation.
