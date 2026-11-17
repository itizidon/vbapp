> Privacy-purpose update: see [feedback privacy model and rollout](feedback-privacy.md). New private analytics/coaching permissions replace the legacy combined flags for eligibility; historical flags are not migrated into consent.

# Private AI Coach

AI Coach appears in Analytics. It uses the authenticated player's Step 2 SQL profile and, when useful, bounded Step 1 observation search. It does not calculate averages, trends or weakness scores in the LLM. The model selects validated server-generated facts and optional general practice suggestions. The server verifies fact IDs, supporting counts and authorized feedback citations, then renders the answer. General suggestions appear separately; no drill library or drill IDs are fabricated.

The two strict tools are `get_player_profile` and `search_feedback`. Neither accepts a player ID. Semantic retrieval uses the configured Step 1 embedding model, version, dimensions and template, and filters live eligibility before exact pgvector similarity search. Keyword/exact filtering is available when no compatible results exist. Full comments are not separately embedded. Source snippets are untrusted input. Personal data, withdrawn feedback and other users' records are not exposed by tools.

## Configuration

Backend secrets/settings (never NEXT_PUBLIC variables):

```dotenv
OPENAI_API_KEY=<backend secret>
OPENAI_CHAT_MODEL=gpt-6.1-sol
OPENAI_CHAT_FALLBACK_MODEL=gpt-6-luna
AI_CHAT_TIMEOUT_MS=60000
AI_CHAT_MAX_TOTAL_TOKENS=64000
AI_CHAT_DAILY_TOKENS=200000
AI_CHAT_DAILY_REQUESTS=30
AI_CHAT_RETENTION_DAYS=90
```

Embedding settings come from the existing feedback worker. Apply the `20261118000000_ai_coach` migration explicitly to the intended database before enabling this UI. Keep frontend `GRAPHQL_API_URL` directed to that backend. Chat goes through the existing POST GraphQL proxy and authentication cookies. The proxy allows 75 seconds for chat; backend provider work is bounded to 60 seconds. The OpenAI Responses API uses `store:false`, a maximum of four tool rounds, six executions, bounded tool output/history and an overall token budget. Model fallback is restricted to appropriate availability errors; authentication/configuration failures are not retried with another model.

Default limits are five requests/minute and thirty/day per account, with one in-flight request, an up-front daily token reservation and idempotent client request UUIDs. Known actual usage releases unused reservation; unknown timeout/provider outcomes conservatively consume the reservation. Query embedding token usage is included. Limits are enforced in PostgreSQL across replicas.

Conversations belong to one user and sport. Stored turns contain the user's question, validated displayed answer, source revision/as-of timestamp and bounded operational metadata. They do not store whole retrieved comments, raw tool transcripts or provider responses. Evidence quotes in displayed answers remain sensitive private data. Historical answers show their analysis timestamp; withdrawn/changed sources cause outdated answers to be withheld. Conversation expiry is measured from creation (90 days by default). Run retention cleanup explicitly/scheduled:

```bash
pnpm coach:prune --dry-run
pnpm coach:prune --apply
```

Supply the intended DATABASE_URL through the command environment (or Node's `--env-file` flag). Pruning deletes expired conversations/turns and usage rows older than one year. Do not run against production without authorization.

## Data and rollout checks

Follow [historical backfill operations](feedback-backfill.md) to preview, enqueue, process and rebuild. No feedback is automatically backfilled, and no paid test calls were made. A ratings-only profile is valid; absent comments mean no technique evidence, not a failed profile. Small sample sizes are labeled cautiously. Cached profiles must be current before answering.

For Railway, migrate the intended environment, set backend secrets, build/deploy backend and frontend, then inspect readiness using that environment explicitly. Remote and production backfill commands are blocked without explicit target flags. Chat model availability/credit is account-specific; automated tests mock paid responses. The optional `RUN_OPENAI_COACH_LIVE=true` integration test only checks model metadata access, not answer quality. Validate representative consented questions before broad rollout.

Reference: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [embeddings](https://developers.openai.com/api/docs/guides/embeddings).

The backend rebuilds queued/expired analytical profiles every five seconds with a SQL-only worker (20 profiles per batch). This worker does not require an OpenAI key, process historical comments or change consent. The first request can briefly report preparation; subsequent polls receive the rebuilt cache. Apply chat migrations as well as profile migrations before starting the backend.
