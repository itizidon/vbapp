# Write-time feedback analysis

This backend-only pipeline extracts observations from written feedback. Original feedback, 1–5 ratings, reviewer identities, match links, approval, and internal numerical rating calculations remain authoritative. It adds no frontend or public analysis endpoint.

## Enable it

1. Use a PostgreSQL server with **pgvector installed**. The migration creates the `vector` extension and requires a database role allowed to do so. The local Compose image builds pgvector on the pinned PostgreSQL 17 Alpine base. Run `docker compose up -d --build postgres` to use it. Hosted databases must provide pgvector before deploying this migration. Do not replace an existing database volume. Check availability using `SELECT name FROM pg_available_extensions WHERE name = 'vector';`.
2. Build with `pnpm build`, then explicitly apply migrations to the intended database using `pnpm prisma:deploy`. Nothing applies migrations, backfills history, or calls providers automatically at app startup. The migration is transactional.
3. Set the server/worker variables below, with provider credentials kept exclusively in backend secrets. Choose an extraction model available to your OpenAI account that supports structured outputs. Use a pinned model ID where available; model IDs are recorded as supplied. Change embedding version whenever provider weights or document semantics change.
4. Run `pnpm feedback:process work 100 --env-file .env --execute` periodically in a separate scheduled worker using the same database. Each invocation processes at most 100 extraction jobs and 100 embeddings, rebuilds up to 100 stale profiles, then exits. Run frequently enough for your desired delay. Multiple invocations are safe; `SKIP LOCKED` claims and five-minute leases prevent duplicate commits. There is no in-memory fire-and-forget queue in HTTP handlers.

```dotenv
FEEDBACK_ANALYSIS_ENABLED=true
OPENAI_API_KEY=<backend secret>
FEEDBACK_EXTRACTION_MODEL=gpt-4.1-mini
FEEDBACK_EMBEDDING_MODEL=text-embedding-3-small
FEEDBACK_EMBEDDING_VERSION=text-embedding-3-small-v1
FEEDBACK_EMBEDDING_DIMENSIONS=1536
```

Extraction and embeddings use the official OpenAI SDK. Extraction uses the Responses API with Structured Outputs and `store: false`. The provider interfaces support alternatives in code. HTTP timeouts are 60 seconds, SDK automatic retries are disabled, and durable retries use exponential backoff with five attempts. An invalid extraction gets one immediate correction attempt before becoming failed. Failures retain raw reviews and sanitized error codes; no raw provider response, credentials, or full comments are logged. Provider calls incur costs. Live model quality needs evaluation against representative consented examples before broad rollout; automated tests use deterministic providers.

## Eligibility and privacy

Processing requires `PUBLISHED`, both `analyticsAllowed` and `evidenceAllowed`, and, when approval is required, an actual approval by the designated reviewer. Only `volleyball` and `beach-volleyball` sports qualify. Both consent flags are deliberately required because observations retain literal evidence. Private accounts can have their own private analysis; this does not make any analysis public.

The existing approval process is preserved. Moderation is a separate extraction result (`ALLOW`, `ABUSE`, `INJECTION`, `PII`, `UNCERTAIN`), not an approval decision. Normal negative volleyball criticism is allowed. Non-ALLOW results produce no observations or embeddings and do not change the original review status or internal rating. Moderation is model-assisted and is not a guarantee that all personal information or malicious text will be identified.

Only comments, source keys, allowed skills, and a canonical technique taxonomy are sent for extraction. No account usernames, emails, credentials, reviewer skill snapshots, star ratings, or match records are included in the request. A comment can yield multiple observations or none. Evidence must match a literal substring of its source. Unknown themes are omitted and safe identifier strings are retained for taxonomy review. Existing star categories are unchanged.

Database triggers queue/invalidate within the original write transaction. Relevant source edits increment generation, delete derived observations and vectors, revoke leases, and invalidate cached profiles immediately. Physical deletes cascade derived records. Numeric-only rating edits invalidate the profile without re-extracting text. A live eligibility view additionally prevents reads of unpublished, unapproved, withdrawn, superseded, moderated, or inactive-theme observations.

`readOwnAnalysisProfile` is an internal server function; pass the authenticated actor ID, never a client-selected recipient ID. Stale profiles return no cached data. Rebuilds aggregate eligible reviews and themes and use a revision comparison before committing. A combined multi-match review is counted once by feedback ID. `PARTIAL` distinguishes unfinished/failed processing from a complete profile with zero observations. Step 2 extends these cached aggregates with deterministic trends and heuristic weakness rankings; see the linked player-profile guide. Internal numerical skill ratings remain separate.

## Local worker

The local `.env` must contain real `OPENAI_API_KEY` credentials, `FEEDBACK_ANALYSIS_ENABLED=true`, and the model settings above. Then run:

```bash
pnpm build
pnpm feedback:watch
```

Keep this command running alongside `pnpm start:dev`. It loads the backend `.env`, checks for jobs every five seconds, processes bounded batches, and stops gracefully with Ctrl+C. New eligible reviews are queued automatically. Existing reviews are only backfilled with an explicit `enqueue` command. Restart the worker after changing `.env`.

The local database image follows the [pgvector source build instructions](https://github.com/pgvector/pgvector#installation); the exact base image and existing data volume are preserved. Extraction follows the [official OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs); embeddings follow the [OpenAI embeddings guide](https://developers.openai.com/api/docs/guides/embeddings).

## Maintenance

See [historical backfill, dry run, player scope and database safeguards](feedback-backfill.md) for the complete operational workflow. Paid work now requires explicit `--execute`.

All commands accept a bounded batch size from 1–1000 (default 100). They use `DATABASE_URL`; use the correct deployment environment. They do not load local `.env` implicitly: for local execution after building use `node --env-file=.env dist/src/feedback-processing/cli.js status`.

| Command after `pnpm feedback:process` | Purpose                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `status`                              | Counts by processing and moderation status; no comment text                                   |
| `work 100 --execute`                            | Process due extraction/embedding jobs and rebuild stale profiles                              |
| `profiles 100`                        | Rebuild stale profiles without provider calls                                                 |
| `enqueue 100`                         | Explicitly queue eligible historical reviews with no job                                      |
| `retry-failed 100`                    | Explicitly reset failed extraction jobs                                                       |
| `retry-embeddings 100`                | Explicitly reset failed embedding jobs                                                        |
| `reprocess 100`                       | Queue completed/skipped/failed eligible rows whose configured extraction model/prompt differs |
| `reembed 100`                         | Queue the configured embedding version for eligible observations missing that version         |

When switching an existing installation, run `reprocess` to queue completed observations from another extraction provider and `reembed` to queue OpenAI vectors for existing eligible observations. Provider/model/version keys keep old embeddings separate. Both commands are explicit; changing environment variables does not run a historical backfill.

Reprocessing replaces observations and their vectors, while preserving metadata-only extraction run history. Bump `PROMPT_VERSION` when extraction rules or taxonomy semantics change. For a moderation policy change, bump that version and explicitly reprocess. Merely retrying a failed embedding never reruns extraction. Reembedding retains earlier embedding versions; consumers must select a single provider/model/version/dimension/template combination. No approximate vector index or semantic search endpoint is added in this write-time phase. Full comments need no separate embeddings.

A five-minute lease bounds each work item. Expired leases can be reclaimed; results require the current generation, lease token, unexpired lease, and live eligibility before committing. Exhausted jobs stay failed for operator inspection. Oversized combined comment input (>24,000 characters) is failed explicitly rather than silently truncating evidence. Taxonomy updates invalidate affected cached profiles; update embedding version when theme labels change.

## Verification

Use a disposable PostgreSQL/pgvector database, migrate it, and run:

```bash
TEST_DATABASE_URL=postgresql://... pnpm test --testTimeout=60000
pnpm build
```

The longer test timeout accommodates the existing full rating-backfill integration test. The dedicated integration tests cover transactional queue rollback, eligibility/approval, withdrawn consent, source edits, reclaimed leases, extraction validation, retries, independent embedding versions, deletion, and private profile invalidation. No test calls a paid provider.

## Step 2 analytical profiles

The existing profile cache now supports deterministic skill statistics, theme frequencies, evidence-aware weakness rankings, and private GraphQL queries. See [player profile rules and operations](player-feedback-analysis.md). Apply the Step 2 migration before using the updated profile commands.
