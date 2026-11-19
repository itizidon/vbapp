# Training library and private video backend

This is backend infrastructure. No frontend changes, CV model, video analysis inference, real video assets, or fake completed analyses were added.

## Working now

- Curated skill-tree CRUD with FOUNDATION/CONTROL/APPLICATION/MASTERY tiers. Category foreign keys reuse the existing active beach-volleyball `Skill` records (`attack`, `defense`, `passing`, `setting`, `serving`); there is no duplicate category table.
- Multiple required/optional and cross-category prerequisites. Self-edges and cycles are rejected. Database triggers and a shared transaction lock serialize graph changes, including opposite concurrent edges. Prerequisites explain learning order, not hard-lock content. Full graph queries support the bounded 1,000-node catalog.
- Separate drill CRUD, ordered steps, PRIMARY/SECONDARY skill joins, publication validation and archived-content exclusion. Publishing requires meaningful instructions and exactly one primary skill. Updates are transactional; database deferred constraints protect publication even outside the service.
- Coaching situations and versioned, bounded recommendation rules with deterministic MATCH/NO_MATCH/UNKNOWN evaluation and explanatory evidence. Rules do not execute code or ask an LLM to decide eligibility.
- Several immutable coach reference revisions per drill/variant/camera/handedness group; one published primary reference per group. Reference replacement creates a new object and revision. Archiving excludes new selection while old analyses retain their exact selected IDs/versions/storage snapshots.
- Private S3/R2 upload authorization, server-generated keys, signed create-only PUTs, HEAD finalization, owner-only player playback/deletion, metadata limits, retention/abandoned-upload cleanup and durable retries.
- Analysis/job persistence with idempotency, source-bound artifact registration, leases, sanitized failure/unavailable codes, frozen checkpoint/reference provenance and validated future worker result persistence. No provider is registered by default.
- Reusable AI integration services. The existing Coach's two-tool protocol and its prohibition on invented drill IDs are deliberately unchanged. A separate small compatibility fix allows its existing optional trust classification when reading saved answers.

## Future implementation — not provided

Media decoding/sniffing/probing, frame preprocessing, MediaPipe/other pose estimation, movement phases, time alignment/DTW, biomechanical comparison/scoring and generated technique assessments need real implementations. No FFmpeg, OpenCV, MediaPipe, Python worker or independent microservice was installed. Semantic/video embeddings are not treated as movement correctness measurements.

A successful object HEAD does **not** establish that bytes are a valid/safe video. With the default empty provider registry, finalize returns `VALIDATION_PENDING`; the corresponding validation job is `UNAVAILABLE / MEDIA_VALIDATOR_NOT_CONFIGURED`. A reference cannot be published and no video can be played through the API until trusted media validation succeeds. Analysis requests return `ANALYSIS_UNAVAILABLE`, with null result/confidence, instead of pretending to analyze or leaving an analysis queued without a provider. Inspect `drillVideoJobs` or editor-only `referenceVideoJobs` for the exact processing state.

No live bucket was accessed in automated tests. Storage integration tests use a fake object adapter; the real AWS presigner is also tested offline. Validate the target bucket configuration and an actual upload before rollout.

## Models and module boundaries

Added Prisma models:

`SkillTreeNode`, `SkillPrerequisite`, `Drill`, `DrillStep`, `DrillSkill`, `CoachingSituation`, `DrillRecommendationRule`, `DrillTechniqueVariant`, `DrillReferenceVideo`, `TechniqueCheckpoint`, `DrillVideoSubmission`, `VideoAnalysis`, `VideoAnalysisReference`, `VideoProcessingJob`, `PlayerTrainingProfile`, `PlayerSkillProgress`, `DrillCompletion`.

`User` and existing `Skill` gain reverse relations only. Existing feedback/ratings, categories, matches, consent and internal rating data/calculations are unchanged. No training completion or video result changes a player rating.

`TrainingModule` is imported by `AppModule` and exports:

| Service | Responsibility |
| --- | --- |
| `TrainingLibraryService` | Editor CRUD, publication, DAG and relational updates |
| `TrainingAccess` | Existing account authority plus a small editor allowlist; not a new RBAC framework |
| `TrainingRecommendations` | Validated rule CRUD, owner-only preferences/progress/completion and ranking |
| `S3VideoStorage` / `VideoStorage` | Private object upload, HEAD, playback and deletion interface |
| `TrainingVideoService` | Upload records, ownership, immutable references and analysis requests |
| `TrainingVideoJobs` | Durable claim/retry, validation/result completion, provenance and cleanup |
| `TrainingReferenceSelection` | Conservative matching of drill, explicit variant, known camera and handedness |
| `TrainingCoachContext` | Published educational context and authorized private player context |

Storage keys, credentials, lease tokens, pose artifact keys and original coach filenames are not GraphQL fields. Public context strips internal object keys/uploader IDs. Private player endpoints are owner-only; being a content editor does not grant access to another player's attempt.

## Authorization and configuration

All writes use the existing account JWT guard. Library writes and reference uploads additionally check `TRAINING_EDITOR_IDS` in the service. This environment contains comma-separated existing account UUIDs, assigned only by deployment operators. Empty means nobody can edit official content. Do not let users set this value or infer authority from usernames/emails/guest names.

Node 20+ is required by the added official AWS SDK; the existing local runtime is Node 24. Storage is disabled unless explicitly enabled. Example backend variables (secrets are placeholders):

```dotenv
TRAINING_EDITOR_IDS=<editor-account-uuid>,<another-editor-uuid>
TRAINING_STORAGE_ENABLED=true
TRAINING_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
TRAINING_S3_REGION=auto
TRAINING_S3_BUCKET=<private-bucket>
TRAINING_S3_ACCESS_KEY_ID=<secret>
TRAINING_S3_SECRET_ACCESS_KEY=<secret>
TRAINING_S3_FORCE_PATH_STYLE=false
TRAINING_UPLOAD_URL_SECONDS=180
TRAINING_PLAYBACK_URL_SECONDS=120
TRAINING_MAX_VIDEO_BYTES=104857600
TRAINING_MAX_VIDEO_DURATION_MS=180000
TRAINING_MAX_PLAYER_VIDEOS=30
TRAINING_MAX_REFERENCES_PER_DRILL=100
TRAINING_VIDEO_RETENTION_DAYS=30
```

For AWS use its HTTPS regional S3 endpoint and actual region. R2 uses `auto`. Keep buckets private; disable public bucket access/public R2 domains. For versioned AWS buckets grant the scoped DeleteObjectVersion permission too; cleanup HEADs the create-only key and deletes its actual current version. Do not overwrite original or artifact keys outside this system, and review noncurrent-version lifecycle rules/Object Lock settings as part of retention testing. Limit the credentials to GET/HEAD/PUT/DELETE for this private bucket's `training/` prefix. Do not grant public ACL or unrelated account access. Keys are unique and never reused; uploads sign `If-None-Match: *`, exact Content-Type and Content-Length. Require conditional writes in the bucket policy where supported. See [AWS conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), [R2 conditional operations](https://developers.cloudflare.com/r2/api/s3/conditional-operations/) and [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Allow only intended frontend origins in **bucket** CORS, with PUT/GET/HEAD and required content-type/if-none-match/content-length headers. This is separate from backend CORS. Upload URLs are bearer capabilities: redact them from logs and share only with the authenticated caller. The browser sets Content-Length from the actual Blob; send exactly the authorized file size and the other returned headers. Curl/server clients can supply all returned headers.

Accepted declared types are MP4 (`video/mp4`), WebM (`video/webm`) and QuickTime (`video/quicktime`). Filename extensions are not trusted. Declared byte limits are checked before signing, bound into the signature and checked again by HEAD. Actual media probing remains necessary. Configure bucket lifecycle rules for abandoned objects as a second layer; API quotas/retention rely on running maintenance.

Signed playback is short-lived (15–300 seconds), upload authorization is 30–900 seconds. A previously issued playback URL remains usable until its TTL/object deletion; authorization cannot instantly revoke an already issued bearer URL. Deleted attempts are immediately hidden and their result content cleared. Physical cleanup waits until the outstanding PUT authorization expires, preventing replay from resurrecting a deleted object during its upload window.

## GraphQL API

Published library reads permit anonymous access. An authenticated allowlisted editor can also read draft/archived content. Existing ID arguments are UUID-validated; lists are bounded. Drills paginate by ascending ID with `after` and `limit` (default 30, maximum 100). Player video lists use the same pattern (default 20).

Queries:

- `skillTree(categoryId?)`, `skillTreeNode(id)`, `skillPrerequisites(id)`, `skillDependents(id)`
- `drills(skillId?, after?, limit?)`, `drill(id)`, `drillsForSkill(id)`, `drillSteps(id)`, `drillSkills(id)`
- `coachingSituations`, `drillRecommendationRules(drillId)`, `techniqueVariants(drillId)`, `techniqueCheckpoints(drillId)`
- `referenceVideosForDrill(drillId, variantId?)`, `referenceVideoPlayback(id)`, `drillTrainingContext(id)`
- Owner-only: `evaluateDrillRecommendations(skillId?)`, `mySkillLearningPath(id)`, `myDrillVideoSubmissions(after?, limit?)`, `drillVideoSubmission(id)`, `myDrillVideoPlayback(id)`, `videoAnalysis(id)`, `videoAnalysisReferences(id)`, `analysisReferencePlayback(analysisId,referenceVideoId)`, `drillVideoJobs(id)`
- Editor-only: `referenceVideoJobs(id)`

Mutations:

- `createSkillTreeNode`, `updateSkillTreeNode`, `archiveSkillTreeNode`, `setSkillPrerequisites`
- `createDrill`, `updateDrill`, `archiveDrill`, `setDrillSteps`, `setDrillSkills`
- `createCoachingSituation`, `updateCoachingSituation`
- `createDrillRecommendationRule`, `updateDrillRecommendationRule`, `deleteDrillRecommendationRule`
- `createTechniqueVariant`, `updateTechniqueVariant`, `createTechniqueCheckpoint`, `updateTechniqueCheckpoint`
- `createReferenceVideoUpload`, `finalizeReferenceVideoUpload`, `updateReferenceVideo`, `archiveReferenceVideo`
- `requestDrillVideoUpload`, `finalizeDrillVideoUpload`, `requestDrillVideoAnalysis`, `deleteMyDrillVideoSubmission`
- Owner-only: `updateMyTrainingProfile`, `updateMySkillProgress`, `recordDrillCompletion`

### Create a skill

Send mutations with the existing authenticated `Authorization: Bearer ...` account token in headers, never in the URL. Look up the existing category ID using the existing `sports` API first.

```graphql
mutation CreateSkill($input: CreateSkillTreeNodeInput!) {
  createSkillTreeNode(input: $input) { id slug status }
}
```

```json
{
  "input": {
    "slug": "off-net-attacking",
    "categoryId": "EXISTING_ATTACK_CATEGORY_UUID",
    "name": "Off-Net Attacking",
    "description": "Develop controlled attacking options away from a tight set.",
    "tier": "APPLICATION",
    "difficulty": 4,
    "learningObjective": "Select a controlled legal contact with useful net spacing.",
    "whyItMatters": "Set location and technique affect the options available.",
    "status": "DRAFT"
  }
}
```

Set prerequisites using `setSkillPrerequisites(id, prerequisites:[{prerequisiteId, required}])`. Publish prerequisite nodes before publishing a node that references them. Archive through status changes; referenced content is not physically deleted. Active published dependents/drills must be updated before archiving a needed skill.

### Create and publish a drill

```graphql
mutation CreateDrill($input: CreateDrillInput!) {
  createDrill(input: $input) { id status }
}
```

Variables include a unique slug, name, description, objective and setup. Optional fields include durationMinutes, minPlayers/maxPlayers, equipment, coachingCues, difficulty, safetyNotes, successCriteria and measurement configuration. Create as DRAFT; reference videos are **not** required.

```graphql
mutation Instructions($id: ID!, $steps: [TrainingStepInput!]!) {
  setDrillSteps(id: $id, steps: $steps) { sortOrder instruction }
}
mutation Links($id: ID!, $skills: [TrainingSkillLinkInput!]!) {
  setDrillSkills(id: $id, skills: $skills) { skillTreeNodeId role }
}
mutation Publish($id: ID!) {
  updateDrill(id: $id, input: { status: PUBLISHED }) { id status }
}
```

Steps are ordered by their input array and assigned deterministic sortOrder. Link one `{skillTreeNodeId:...,role:PRIMARY}` and any secondary skills. All linked skills must be published before publishing the drill. Updates use patch inputs; clear nullable structured fields with null where permitted.

### Structured recommendation criteria

```graphql
mutation Rule($input: CreateDrillRecommendationRuleInput!) {
  createDrillRecommendationRule(input: $input) { id version conditions }
}
```

```json
{
  "input": {
    "drillId": "DRILL_UUID",
    "name": "Tight-set difficulty",
    "rationale": "The player reports this situation; height alone does not imply limited clearance.",
    "effect": "BOOST",
    "priority": 8,
    "conditions": {
      "version": 1,
      "root": {
        "any": [
          { "fact": "reportedDifficulty", "op": "contains", "value": "tight_set_attacking" },
          { "fact": "feedbackThemeCount", "key": "approach_timing", "trust": "VERIFIED_APPROVED", "op": "gte", "value": 3 }
        ]
      }
    }
  }
}
```

The theme key must match an existing backend `FeedbackTheme.id`; an unknown taxonomy key produces UNKNOWN, not an invented zero. `feedbackThemeCount` currently means **negative theme-mentioning feedback submissions** in the authorized current SQL profile. Stale/incomplete profiles are UNKNOWN. Classification is explicit; it defaults to VERIFIED_APPROVED. Guest/pending boosts have weight 0.35 and cannot be used in EXCLUDE rules. Feedback-based exclusion additionally needs at least two distinct verified negative reviewers.

Allowlisted facts: `overallLevel`, `selfAssessment` (key=category UUID), `skillProgress` (key=node UUID), `feedbackThemeCount` (key=theme ID), `reportedDifficulty`, `attackReachCm`, `standingReachCm`, `jumpReachCm`, `handedness`, `availablePartners`, `equipment`, `completedDrill` (key=drill UUID). Height is deliberately not a targeting fact. Numerical facts support eq/neq/gt/gte/lt/lte; categorical facts eq/neq/in; list facts contains. Conditions use all/any groups, maximum 40 nodes and four grouping levels, also subject to the shared bounded JSON scalar. Arbitrary properties/operators are rejected.

`updateMyTrainingProfile(data)` replaces the player's private self-reported preference/capability document. Supported optional keys: handedness (LEFT/RIGHT/BOTH), attackReachCm, standingReachCm, jumpReachCm, availablePartners, equipment[], reportedDifficulties[]. Missing values stay unknown; measured and self-reported data are not conflated. The current API stores self reports only. Progress states are NOT_STARTED/PRACTICING/CONFIDENT and are explicitly self-reported. Completion facts mean recorded completion history, not proof that a movement was correct.

`evaluateDrillRecommendations` uses only the authenticated player's authorized data. It returns candidates with score, excluded, and per-rule MATCH/NO_MATCH/UNKNOWN state, rationale, reasons and supporting facts. Excluded candidates remain in the explanation response but sort last; a consumer must omit `excluded=true` when presenting suitable drills. No private reviewer identity is returned or inferred.

### Several coach reference videos

Create named variants using `createTechniqueVariant(input:{drillId,slug,name,description,isDefault,status})`. More than one variant can be published; only one nonarchived default is permitted. Unpublish a variant’s references/checkpoints before taking that variant offline. Create checkpoints separately with phaseKey, coachingExplanation, importance and optional validated measurementConfig. Version-1 measurements allow joint_angle/timing/accuracy/movement_feature, units degrees/ms/ratio/normalized, bounded landmark names/phase/ranges.

For **each** reference request `createReferenceVideoUpload(input)` with drillId, optional techniqueVariantId, title, originalFilename, mimeType, exact fileSizeBytes, cameraAngle and optional handedness. Camera values are FRONT/SIDE/REAR/OBLIQUE/UNKNOWN. Upload using the returned URL/headers and then call `finalizeReferenceVideoUpload(id)`.

After a real trusted media validator has succeeded, an editor can publish with `updateReferenceVideo(id,input:{status:PUBLISHED,isPrimary:true})`. Uploading does not make a file a correct reference; both validation and explicit curated publication are required. Multiple accepted demonstrations are supported. Replace using `replacesReferenceId` on a new upload request; this creates the next revision in the same series with a new key. Archive the old primary before publishing a new primary for that exact grouping. Owners of an existing analysis can still request temporary playback of its exact archived reference through analysisReferencePlayback; it is not publicly rediscovered and supplying a raw reference ID is insufficient. Do not overwrite old keys/revisions.

### Player attempt flow

```graphql
mutation Upload($input: TrainingVideoUploadInput!) {
  requestDrillVideoUpload(input: $input) { id url expiresAt headers }
}
mutation Finalize($id: ID!) {
  finalizeDrillVideoUpload(id: $id) { id status fileSizeBytes }
}
query State($id: ID!) {
  drillVideoJobs(id: $id) { type status errorCode attempts }
}
mutation Analyze($id: ID!, $requestId: ID!) {
  requestDrillVideoAnalysis(id: $id, requestId: $requestId) {
    id status errorCode result confidence analysisVersion
  }
}
mutation Delete($id: ID!) { deleteMyDrillVideoSubmission(id: $id) }
```

Upload variables: `{drillId, techniqueVariantId?, referenceVideoId?, mimeType, fileSizeBytes, cameraAngle}`. The optional preferred reference must belong to the same published drill/variant and be validated/published. There is no client-controlled userId, bucket or storageKey. Use a fresh requestId UUID and reuse it on retry. Analysis attempts are unique per submission and analysisVersion as well, preventing duplicate requests with different retry IDs. A replacement video is a new submission; its source object/owner/drill identity cannot be mutated.

## Future worker integration

`analysis.contracts.ts` defines VideoPreprocessor, PoseExtractionProvider, MovementPhaseDetector, MotionAlignmentProvider, TechniqueComparisonProvider, ReferenceSelectionService and VideoAnalysisOrchestrator. Pose frames have timestamps, named landmarks, confidence/visibility, coordinate-space/unit/orientation metadata, optional angles/phases and warnings. Comparison results bind submission/drill IDs, exact reference IDs/versions, checkpoint differences/units/timestamps/confidence/limitations, observations and suggested curated IDs.

Replace the empty `TRAINING_VIDEO_PROVIDERS` registry with actual local implementations when deploying a worker. Do not set a flag claiming a provider exists. External implementations are explicitly blocked: existing feedback AI consent is not permission to send videos or body landmarks externally. A future external feature needs its own explicit permission/audit boundary before enabling it.

A future local worker:

1. Register a LOCAL preprocessor and run a consumer for VALIDATE_VIDEO. `activateValidationJobs(actualPreprocessor)` can resume previously unavailable validation work. `claim(type)` uses atomic SKIP LOCKED leases and retry limits. Decode/sniff/probe actual bytes, enforce content/duration/visibility/camera limits, and call `completeValidation(jobId, leaseToken, actualMetadata)`. It cannot be invoked from GraphQL.
2. Register a real LOCAL orchestrator with providerName and a new analysisVersion. Once an attempt is READY_FOR_ANALYSIS and compatible references exist, requestAnalysis creates a durable pending job. Unsupported camera/reference combinations return unavailable. Deploy/run the processor before registering it.
3. Use `TrainingReferenceSelection` (currently conservative same explicit variant/camera, optional handedness), then `attachReferences(analysisId, selected)` to freeze the demonstrations actually used. A future provider can refine selection but must preserve compatibility and provenance. Never average incompatible movements. A preferred reference is a hint, not authority to choose an incompatible demonstration.
4. Allocate private artifact keys with `allocateArtifactKey`. Register all generated artifacts this way so deletion can clean them. Internal worker storage access must remain within the job's source scope; never accept object keys from an API caller.
5. Preprocess, extract pose, detect phases, align movement, compare drill checkpoints, and produce real structured findings. These stages remain future implementations. `completeAnalysis(jobId,leaseToken,result,{poseModelVersion,comparisonAlgorithmVersion})` validates the result schema, source/reference/checkpoint provenance, timestamp bounds, lease and deletion state before persisting completion. Call `fail` with sanitized state on failure/unavailability. Retry exhaustion becomes FAILED rather than permanently pending work.

TrainingCoachContext methods are exported for future existing-Coach tool wiring: `getRecommendedDrillsForUser(actor,userId,skillId?)`, `getDrillTrainingContext(drillId)`, `getSkillLearningPath(actor,userId,skillId)`, `getAvailableReferenceVideos(drillId,variantId?)`, `getVideoAnalysisContext(actor,analysisId)`, `getPlayerDrillHistory(actor,userId)`. The explicit actor prevents a model-selected user ID from granting access. Video context includes findings only for COMPLETED analyses. No automatic external model call or rating adjustment occurs.

## Migration, seed, maintenance and rollout

Required migration: `20261122000000_training_library`. It is additive, transactional, uses a five-second lock timeout, and adds indexes, foreign keys, graph/publication/identity constraints and immutable reference revision protection. It does not update existing feedback/rating data. Take a restorable backup and test on isolated QA before the intended Railway deployment. Stop old processes for migration cutover as needed, build/regenerate Prisma, apply deploy migrations to the verified target, then start the new backend. Do not use migrate reset, db push or a production demo seed. No Railway infrastructure/deployment is changed by this implementation.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm prisma:deploy
pnpm test:unit
# Set this only to an isolated migrated test database:
TEST_DATABASE_URL=postgresql://... pnpm test:integration
```

The explicit development seed reuses categories and an **existing authorized editor**; it creates no account or fake video. Set TRAINING_EDITOR_IDS and TRAINING_SEED_EDITOR_ID to that editor's UUID. It refuses remote/production execution and leaves existing slugs/content intact. It includes eight example nodes, five drills, optional prerequisite links, two variants per newly created drill, eight coaching situations and structured rules. This is a small example curriculum, not a complete catalog. The base category catalog must exist first.

```sh
pnpm training:seed --env-file .env --dry-run
pnpm training:seed --env-file .env --execute
pnpm training:maintenance --env-file .env --dry-run
pnpm training:maintenance --env-file .env --batch-size 20 --execute
```

Without `--execute`, these commands print only the sanitized selected database target; they do not mutate data. Maintenance sweeps bounded pages of expired/abandoned player uploads, expired references, and durable cleanup jobs; schedule it repeatedly (for example using a protected Railway cron worker). A single page does not imply the full backlog is drained. Cleanup retries preserve failed jobs/error codes; inspect exhausted failures and fix storage configuration before explicitly retrying through trusted operations. Keep bucket lifecycle rules as defense in depth.

Commands reuse the existing environment-file/database target verification: conflicting inherited DATABASE_URL fails; remote/production requires explicit `--allow-remote --allow-production --confirm-database ACTUAL_DATABASE`. Production seed remains forbidden even with those flags. Before invoking maintenance in an authorized Railway shell, verify its target, private credentials and deletion/retention configuration. Do not publish secrets, signed URLs, videos or landmark data in logs.

Player deletion immediately clears result/confidence and denies new reads/playback; physical original/artifact deletion is a resumable cleanup job. Coach reference archives preserve exact historical references rather than deleting source material still needed by previous analyses. Further physical deletion of accounts/audit metadata needs an explicit retention process; this implementation does not claim universal legal compliance or infer video permissions from feedback consent.

Prefer forward fixes. Do not drop these tables after collecting user progress/videos or edit applied migration history. Disable uploads/processing while resolving problems, retain backups/provenance, and use a reviewed recovery migration. Keep storage disabled until bucket access, signed upload/replay behavior, CORS, cleanup and a real media validator are tested for the deployment.
