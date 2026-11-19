# Coach demonstrations and private movement comparison

This extends TrainingModule, TrainingLibraryService, TrainingAccess, TrainingVideoService, TrainingVideoJobs and S3VideoStorage. The existing PostgreSQL queue, JWT account sessions, signed immutable uploads, curated skills/drills/variants/checkpoints, retention/deletion and AI Coach Responses provider are reused. It does not update internal ratings or feedback analytics.

## Supported MVP

An actual CPU pipeline uses FFprobe, FFmpeg and MediaPipe Tasks Pose Landmarker. It handles one trimmed repetition from one athlete in a 1–30 second MP4/MOV/WebM recording, up to 100 MB, 3840×2160 and 120 input FPS. Configuration can change the caps. FFmpeg autorotates, letterboxes to square pixels and samples at 10 FPS; timestamps are relative to the decoded clip start, with 100 ms sampling resolution by default. HTTP/network decoding protocols and playlist formats are blocked. Node kills the process group at 150 seconds; Python additionally limits CPU/file output, model threads and sampled frames. Run one CPU worker initially, allow at least 2 GB RAM, and tune limits after measuring actual hardware.

The first supported measurements are projected left/right elbow angle, left/right knee angle, trunk inclination, and wrist height relative to the shoulder center in torso lengths. Features normalize translation and torso scale. Angles reduce effects of body size; they do not make different camera perspectives or body proportions equivalent. Reliable consecutive angular velocities are stored in artifacts for future use, but are not scored. MediaPipe world-coordinate estimates are retained as model output, never presented as calibrated 3D biomechanics. No facial identification occurs.

Start with **Passing Platform Control**: projected elbow angles and wrist height, recorded from a coach-approved angle. Approach-footwork drills can compare knee projection and trunk inclination, but this system does **not** detect exact step sequence, ball contact, takeoff, landing, ball speed or jump height. A coach must review checkpoint definitions, tolerances and demonstrations before enabling a drill. No demonstration is shipped or published as a universal correct volleyball technique.

The automatic segmentation baseline identifies a feature-activity envelope. Named phases must be configured as fractional windows of that envelope. A missing phase definition is unscorable, rather than an invented event timestamp. Multiple repetitions are not segmented automatically: the uploader must trim to one intended repetition. This is an experimental engineering MVP, not a validated biomechanics assessment.

## Local setup

Use Python **3.12** (tested 3.12.3), Node 22+, PostgreSQL with the existing pgvector migrations, FFmpeg/FFprobe (tested 6.1.1), and private S3-compatible storage.

```bash
cd /home/don/dsk/vbapp
python3.12 -m venv .venv-video
.venv-video/bin/pip install -r video-worker/requirements.lock
.venv-video/bin/python video-worker/install-model.py
# Install ffmpeg/ffprobe using your OS package manager if absent.
# Build the existing backend, then inspect the explicitly selected environment:
npm run build
node dist/src/training/motion-worker.js health --env-file=.env --dry-run
```

The checksum-verified model is Pose Landmarker **full float16 v1**, SHA-256 `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`. Python packages are pinned in `video-worker/requirements.lock`, including mediapipe 0.10.35 and numpy 2.2.6. Model binaries, venvs and local media are ignored. The worker performs an actual model initialization before advertising availability.

Review your database target and apply pending migrations only to that intended database:

```bash
node --env-file=.env node_modules/prisma/build/index.js migrate status
# After reviewing the target and pending migrations:
node --env-file=.env node_modules/prisma/build/index.js migrate deploy
```

This implementation did **not** migrate the application database or change production. The new additive migration is `20261123000000_motion_comparison`; it follows `20261122000000_training_library`. It adds VideoPoseArtifact and VideoWorkerHeartbeat, drill motion configuration, reference coverage/quality acknowledgement, player handedness/permissions and immutable pose-reference snapshots. Existing analyses remain readable. Previously metadata-only reference videos must be reprocessed and acknowledged before being newly published for motion comparison.

Configure backend and worker with the same database/storage settings (see `.env.example`):

```dotenv
TRAINING_EDITOR_IDS=<existing-coach-account-uuid>
TRAINING_STORAGE_ENABLED=true
TRAINING_S3_ENDPOINT=https://your-s3-endpoint
TRAINING_S3_BUCKET=<private-bucket>
TRAINING_S3_REGION=<region>
TRAINING_S3_ACCESS_KEY_ID=<secret>
TRAINING_S3_SECRET_ACCESS_KEY=<secret>
TRAINING_S3_FORCE_PATH_STYLE=true
VIDEO_PYTHON=.venv-video/bin/python
VIDEO_SAMPLE_FPS=10
VIDEO_MIN_VISIBILITY=0.6
VIDEO_MIN_VALID_RATIO=0.65
VIDEO_MAX_DURATION_MS=30000
TRAINING_MAX_VIDEO_BYTES=104857600
TRAINING_MAX_VIDEO_DURATION_MS=30000
TRAINING_AI_EXPLANATIONS_ENABLED=false
```

Set VIDEO_FFMPEG / VIDEO_FFPROBE for non-PATH installations and VIDEO_POSE_MODEL for an alternative location of the checksum-identical model. The worker reads these values at startup; restart after changing them. CORS on the private bucket must allow the exact frontend origin, PUT/GET/HEAD, Content-Type, Content-Length, If-None-Match, and expose ETag. Keep public access disabled, encryption enabled and storage credentials restricted to the training prefix. Lifecycle policy must complement the application's retention sweep; versioned buckets also need noncurrent-version expiration. Deletion removes the current actual object version, not only a delete marker.

Start services in separate terminals:

```bash
# Existing HTTP backend:
npm run start:dev
# Actual processing worker (explicit write authorization, local target checked):
node dist/src/training/motion-worker.js health --env-file=.env --execute
node dist/src/training/motion-worker.js watch --env-file=.env --execute
# Frontend:
cd frontend && npm run dev
```

For an explicitly selected finite batch use `once --env-file=.env --execute`. Without `--execute`, the command prints only a sanitized target and does no work. Conflicting inherited DATABASE_URL and `--env-file` are rejected. Remote targets require `--allow-remote --confirm-database <exact-name>`; production also requires `--allow-production`. Never add those flags without authorization for that target.

For synthetic development recordings only, a loopback S3 emulator is provided:

```bash
npm --prefix video-worker/local-storage ci
npm --prefix video-worker/local-storage start
```

Use endpoint `http://127.0.0.1:4569`, region `us-east-1`, bucket `bvbtips-video-local`, credentials `S3RVER` / `S3RVER`, path style true, `TRAINING_S3_ALLOW_LOCAL_HTTP=true`, and NODE_ENV=development. The emulator is a test utility, not a production security boundary; use a real private bucket for sensitive player recordings. HTTP exceptions are allowed only for loopback outside production. Official MinIO downloads were unavailable during implementation, so the automated local smoke uses pinned s3rver 3.7.1 instead. Provider-specific CORS, IAM, conditional PUT and object-version behavior still require validation against your deployed storage service.

## Coach and player workflow

- Open `/training` from Account settings; `/admin/drills` lists existing drills.
- On `/admin/drills`, authorized coaches can click **Create drill**. Enter its name/slug, description, learning objective, setup, difficulty, duration, player counts and ordered instructions. Choose a published primary skill or create one under an existing volleyball category; no starter seed is required. Equipment, cues and safety notes are optional.
- **Create and publish** saves the drill, instructions and skill link in one transaction, publishes it to `/training`, then opens `/admin/drills/<drillId>/videos` for demonstrations. Failed validation leaves no partial drill/skill behind and preserves form entries for correction. The new `createDrillWithContent` mutation enforces the existing coach allowlist; `canManageTraining` controls frontend visibility. No database migration is needed for this form.
- An authorized account can also open `/admin/drills/<drillId>/videos` for an existing drill.
- In Measurement configuration, add implemented version-2 checkpoints with the feature, approved camera and tolerance. The JSON drill config must explicitly enable comparison. Optional phase windows use `{key,startRatio,endRatio}` within [0,1]. The generic existing version-1 checkpoint definitions remain manual/unavailable.
- Upload one or several demonstrations, selecting variant, camera, handedness, title, explanation and demonstrated checkpoints.
- Polling shows actual durable validation and extraction jobs. Review the video, usable-frame counts and limitations. A reference cannot publish until pose extraction passed, coverage is declared, and the coach acknowledged the quality limitations.
- Players open `/drills/<drillId>`, watch a matching demonstration and upload a private attempt. Validation → extraction → automatic comparison use actual jobs. Offline worker state is explicit, rather than a simulated progress animation.
- Open the attempt's results to view per-checkpoint and per-reference scores, measurements, quality, limitations and paired timestamp buttons. Both videos can be sought to the actual aligned moments. Playback links are short lived and can be refreshed.
- Previous attempts retain immutable reference video revisions, pose artifact IDs, checkpoint coverage, mirror decisions and analysis versions. Changed motion configuration or reference artifacts creates a different analysis version; retries reuse an existing pending/failed version. Archive references to preserve history. Deletion of a reference used by an analysis is rejected.

## Comparison and scoring

The worker selects at most five references in stable primary-then-ID order, matching drill, variant, camera, extracted quality and acknowledged checkpoint coverage. Different known handedness is allowed only if the player opted into mirroring **and** the drill configuration permits it. The mirror operation swaps anatomical left/right features; it does not transform camera geometry. Unknown player handedness cannot silently match a handed demonstration. Excluded references and reasons are returned; alignment failures return null scores.

Slope-constrained DTW uses normalized time, a 25% band, steps (1,1)/(1,2)/(2,1), time-weighted confidence-aware feature distance and a gap penalty. Missing measurements are never imputed. Length ratio above 2.5, insufficient tracked coverage, excessive warp or distance fails alignment. Thresholds are versioned engineering heuristics, not calibrated confidence estimates. Feature confidence is the minimum participating landmark visibility/presence.

For each supported checkpoint and compatible reference, take the **median absolute difference** across reliable aligned samples in its configured phase. At least three samples are required. Similarity = `max(0,100*(1 - medianAbsoluteDifference/(2*tolerance)))`. Aggregate checkpoint scores by the median across references that actually support that checkpoint. Overall similarity is the importance-weighted mean across at least **two** evaluated checkpoints with positive importance. Missing results remain null. Each reference's own score, coverage and full timestamp mapping are retained; the system does not select whichever coach yields the highest score.

The label is always **Experimental movement similarity**, never “percent correct.” Tolerances express configurable similarity scales, not proof that a physical difference is an error. Compare trends only under matching algorithm, camera, variant and checkpoint conditions. Scores do not change internal ratings.

## AI Coach

Deterministic measurements are stored before explanation. The existing `CoachOpenAI.respond` provider is reused only when `TRAINING_AI_EXPLANATIONS_ENABLED=true`, a backend key is configured, and that upload has its own unchecked-by-default `aiExplanationAllowed` opt-in. It receives minimized numerical differences, drill objective and curated cues; never raw videos, frames or landmarks. Its strict response selects existing checkpoint IDs and cue indexes. The renderer uses measured facts and curated text rather than allowing invented measurements or unsupported causal explanations. Disabled/unavailable/failed AI falls back to the deterministic explanation. No paid calls were made during verification. Free-form AI biomechanical diagnosis is deliberately unsupported.

## GraphQL and storage

Existing createReferenceVideoUpload, finalizeReferenceVideoUpload, updateReferenceVideo, archiveReferenceVideo, requestDrillVideoUpload, finalizeDrillVideoUpload, requestDrillVideoAnalysis, videoAnalysis, myDrillVideoPlayback and analysisReferencePlayback are reused.

New authenticated operations: `trainingVideoWorkspace(drillId)`, `configureDrillMotion(drillId,config)`, `configureReferenceCoverage(id,config)`, `retryTrainingVideo(id,reference)`, `deleteReferenceVideo(id)`. Configuration/publishing is allowlisted through TrainingAccess. Every player lookup is owner scoped; content editors cannot inspect another player's private recording or results. Workspace responses contain compact attempt summaries; full comparison results are fetched only when opened.

Prisma stores artifact hashes, model/extraction/feature versions, sampling rate, quality, timestamps and private object keys. Full pose frames and derived features live in private JSON objects under their original source prefix. Worker keys are registered before artifact upload, allowing deletion to clean partial artifacts. Processing is idempotent by source hash and configuration/model fingerprint. Durable queue leases prevent lost jobs; bounded retries/backoff report failures. A live initialized worker heartbeat expires after 45 seconds. Deleted sources cancel work and hide results immediately; maintenance removes originals and derived artifacts after outstanding PUT authorization expires. Run the existing `training:maintenance` sweep regularly with the intended environment explicitly selected.

## Tests and reproducible smoke

```bash
npm run test:video:python
npm test -- --runInBand test/motion-result.spec.ts
cd frontend && npm test -- tests/training-video.test.tsx
```

The Python suite includes **real MediaPipe extraction** of a CC BY 3.0 FitnessScape exercise video, a real blank video/no-person case, invalid media, frame-rate/duration/rotation handling, plus deterministic confidence/normalization/mirroring/DTW/aggregation tests. See `video-worker/fixtures/NOTICE.md`. The fitness fixture proves the processing machinery; it is not a volleyball demonstration or coaching-validation dataset.

For the full local smoke, use a **disposable** local database named `motion_test` with repository migrations already deployed, and install pinned test storage separately:

```bash
npm install --prefix /tmp/bvbtips-video-s3 --no-audit --no-fund s3rver@3.7.1
# Point only this variable to your disposable local motion_test database:
export VIDEO_SMOKE_DATABASE_URL=postgresql://<test-user>:<test-password>@127.0.0.1:55437/motion_test
npm run test:video:smoke
```

The smoke rejects remote hosts and any database name other than motion_test. It starts a temporary loopback S3 server and real Nest GraphQL API, creates synthetic accounts/catalog, uploads actual reference and player recordings through signed PUTs, runs actual MediaPipe extraction and DTW, verifies persisted/API measurements, signed playback and authorization denial. No application .env, production services or paid AI are needed. Use a fresh disposable database for reproducible runs; it deliberately does not reset databases automatically.

## Railway deployment checklist (not deployed)

Use the repository root as build context with `video-worker/Dockerfile`. Add a separate worker service, no public domain. `video-worker/railway.worker.json` is an optional service configuration; explicitly set VIDEO_WORKER_DATABASE_NAME to the actual target name and authorize target flags as described above. Production requires an explicitly approved start command containing `--allow-production`; the supplied command intentionally does not bypass that guard. Share the backend's database and private storage settings; keep keys server-side. Set APP_ENV appropriately and NODE_ENV=production. Set VIDEO_PYTHON=/app/.venv-video/bin/python and FFmpeg paths from the Dockerfile. Apply migrations through the existing reviewed deploy flow, then start one CPU worker. Configure storage CORS to the actual HTTPS frontend origin and use a real private bucket. Run media-retention maintenance on a schedule. This Dockerfile/configuration has not been deployed to Railway; validate the container in your build environment before rollout.

## Verification record — 2026-11-19

- Full backend regression: 391 passed, 1 optional paid live test skipped. Final focused training/selection suite: 31 passed; additional deletion-during-upload and selection unit suite: 10 passed.
- Frontend regression: 200 passed. New result tests: 4 passed. Frontend TypeScript and lint passed with six existing warnings outside this feature.
- Python: 18 passed, including actual MediaPipe extraction, a real blank video and FFmpeg-generated frame-rate/duration/orientation fixtures.
- Browser checks: passed at 320, 375 and 1440 pixels, rendering results from the actual CPU/API smoke; no horizontal overflow. Browser playback endpoints in that UI-only replay are mocked because the smoke's temporary bucket is shut down. Actual signed playback was verified by the API/storage smoke.
- Final signed-upload / CPU / PostgreSQL / GraphQL smoke: passed with a reference clip and a separately rotated real player clip, two actual evaluated checkpoints and nonzero measured differences. Its experimental score was 92.41/100; this tests projected movement measurement, not the correctness of a volleyball technique.
- Backend and isolated frontend production builds passed. No production database, credentials or Railway services were changed. Paid AI and a Railway container deployment were not exercised.

To replay the responsive UI checks after a fresh smoke export:

```bash
VIDEO_SMOKE_EXPORT_PATH=/tmp/bvbtips-video-ui.json npm run test:video:smoke
cd frontend
VIDEO_SMOKE_UI_FIXTURE=/tmp/bvbtips-video-ui.json npx playwright test tests/e2e/training-videos.spec.ts --project=width-320 --project=width-375 --project=width-1440
```

The training library also links to `/skills/<skillId>` pages with related drills. Playback uses the original video's browser codec support; H.264 MP4 is the most portable recording choice. There is no server-side playback-transcoding pipeline in this MVP.
