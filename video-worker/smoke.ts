import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
// Explicit isolated local smoke. Never uses the application .env or a remote database.
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { CpuVideoWorker } from "../src/training/motion-worker";
import { MotionRuntime, pythonMotion } from "../src/training/motion-runtime";
import { TrainingAccess } from "../src/training/access";
import { TrainingLibraryService } from "../src/training/library.service";
import { seedTraining } from "../src/training/seed";

async function main() {
  const url = process.env.VIDEO_SMOKE_DATABASE_URL;
  if (!url)
    throw new Error(
      "Set VIDEO_SMOKE_DATABASE_URL to a disposable local database named motion_test",
    );
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/motion_test"
  )
    throw new Error("Smoke test only permits a local motion_test database");
  Object.assign(process.env, {
    DATABASE_URL: url,
    NODE_ENV: "test",
    APP_ENV: "test",
    JWT_SECRET: "motion-smoke-isolated-local-secret-32-characters",
    TRAINING_STORAGE_ENABLED: "true",
    TRAINING_S3_ENDPOINT: "http://127.0.0.1:55438",
    TRAINING_S3_BUCKET: "motion-test",
    TRAINING_S3_ACCESS_KEY_ID: "S3RVER",
    TRAINING_S3_SECRET_ACCESS_KEY: "S3RVER",
    TRAINING_S3_REGION: "us-east-1",
    TRAINING_S3_FORCE_PATH_STYLE: "true",
    TRAINING_S3_ALLOW_LOCAL_HTTP: "true",
    TRAINING_AI_EXPLANATIONS_ENABLED: "false",
    FEEDBACK_PROCESSING_ENABLED: "false",
  });
  const S3rver = require(
    process.env.VIDEO_TEST_S3_MODULE ??
      "/tmp/bvbtips-video-s3/node_modules/s3rver",
  );
  const dir = await mkdtemp(join(tmpdir(), "bvbtips-s3-smoke-"));
  const cors =
    "<CORSConfiguration><CORSRule><AllowedOrigin>http://localhost:3001</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader></CORSRule></CORSConfiguration>";
  const server = new S3rver({
    address: "127.0.0.1",
    port: 55438,
    directory: dir,
    silent: true,
    configureBuckets: [{ name: "motion-test", configs: [cors] }],
  });
  const db = new PrismaClient();
  let app: any;
  try {
    await server.run();
    const actor = randomUUID(),
      other = randomUUID();
    process.env.TRAINING_EDITOR_IDS = actor;
    for (const id of [actor, other])
      await db.user.create({
        data: {
          id,
          username: id,
          email: `${id}@example.test`,
          passwordHash: "smoke-only",
          age: 25,
          heightCm: 180,
        },
      });
    const sport = await db.sport.upsert({
      where: { slug: "beach-volleyball" },
      create: { slug: "beach-volleyball", name: "Beach Volleyball" },
      update: {},
    });
    for (const slug of ["attack", "defense", "passing", "setting", "serving"])
      await db.skill.upsert({
        where: { sportId_slug: { sportId: sport.id, slug } },
        create: { sportId: sport.id, slug, name: slug },
        update: { active: true },
      });
    await seedTraining(db as any, actor);
    const lib = new TrainingLibraryService(
      db as any,
      new TrainingAccess(db as any),
    );
    const skill = await db.skillTreeNode.findFirstOrThrow({
      where: { status: "PUBLISHED" },
    });
    let drill = await lib.createDrill(actor, {
      slug: `motion-smoke-${randomUUID()}`,
      name: "Local motion pipeline test",
      description: "Licensed fitness fixture, not a volleyball reference",
      objective: "Verify actual video comparison infrastructure",
      setup: "Test only",
      coachingCues: ["Review aligned projected movements with a coach."],
    });
    await lib.setSteps(actor, drill.id, [
      { instruction: "Use the licensed test clip only." },
    ]);
    await lib.setSkills(actor, drill.id, [
      { skillTreeNodeId: skill.id, role: "PRIMARY" },
    ]);
    drill = await lib.updateDrill(actor, drill.id, { status: "PUBLISHED" });
    const variant = await lib.variant(actor, {
      drillId: drill.id,
      slug: "fixture",
      name: "Fixture",
      description: "Actual video infrastructure test",
      status: "PUBLISHED",
    });
    const { AppModule } = await import("../src/app.module");
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    const endpoint = `http://127.0.0.1:${address.port}/graphql`;
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = jwt.sign({ sub: actor, id: actor });
    async function query(
      query: string,
      variables: any = {},
      auth = token,
      expectError = false,
    ): Promise<any> {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${auth}`,
        },
        body: JSON.stringify({ query, variables }),
      });
      const body: any = await r.json();
      if (expectError) {
        assert.ok(body.errors?.length);
        return body;
      }
      if (body.errors) throw new Error(JSON.stringify(body.errors));
      return body.data;
    }
    const worker = new CpuVideoWorker(db as any);
    const health = await pythonMotion({ command: "health" });
    await new MotionRuntime(db as any).heartbeat(health);
    const heartbeat = setInterval(
      () => new MotionRuntime(db as any).heartbeat(health).catch(() => {}),
      10000,
    );
    try {
      await query(
        `mutation($id:ID!,$c:TrainingJSON!){configureDrillMotion(drillId:$id,config:$c)}`,
        {
          id: drill.id,
          c: {
            version: 1,
            enabled: true,
            allowMirroring: false,
            phaseWindows: [],
          },
        },
      );
      const checkpoints = [];
      for (const [feature, name, tolerance] of [
        ["left_knee_angle", "Projected left knee", 20],
        ["trunk_inclination", "Projected trunk", 15],
      ] as const) {
        const cp = await query(
          `mutation($i:CreateTechniqueCheckpointInput!){createTechniqueCheckpoint(input:$i){id}}`,
          {
            i: {
              drillId: drill.id,
              name,
              description:
                "Real-video infrastructure smoke measurement. Fitness fixture is not a volleyball reference.",
              phaseKey: "whole",
              sortOrder: 0,
              coachingExplanation:
                "Review aligned projected measurements; differences do not establish a technique error.",
              status: "PUBLISHED",
              measurementConfig: {
                version: 2,
                feature,
                tolerance,
                cameras: ["SIDE"],
                minConfidence: 0.6,
              },
            },
          },
        );
        checkpoints.push(cp.createTechniqueCheckpoint.id);
      }
      const bytes = await readFile("video-worker/fixtures/squat-ccby3.webm");
      // A small known image-plane rotation gives a second real recording with nonzero projected differences.
      // It is not a simulated technique error and is never shipped as coaching content.
      const rotatedPath = join(dir, "rotated-player.mp4");
      const ffmpeg =
        process.env.VIDEO_FFMPEG ??
        (existsSync(".video-tools/usr/bin/ffmpeg")
          ? ".video-tools/usr/bin/ffmpeg"
          : "ffmpeg");
      execFileSync(
        ffmpeg,
        [
          "-v",
          "error",
          "-i",
          "video-worker/fixtures/squat-ccby3.webm",
          "-vf",
          "rotate=0.0872664626:fillcolor=black",
          "-an",
          "-c:v",
          "libx264",
          "-threads",
          "1",
          rotatedPath,
        ],
        { timeout: 30000 },
      );
      const playerBytes = await readFile(rotatedPath);
      async function upload(reference: boolean) {
        const media = reference ? bytes : playerBytes;
        const op = reference
          ? "createReferenceVideoUpload"
          : "requestDrillVideoUpload";
        const type = reference
          ? "ReferenceVideoUploadInput"
          : "TrainingVideoUploadInput";
        const r = await query(
          `mutation($i:${type}!){${op}(input:$i){id url headers}}`,
          {
            i: {
              drillId: drill.id,
              techniqueVariantId: variant.id,
              cameraAngle: "SIDE",
              handedness: "RIGHT",
              mimeType: reference ? "video/webm" : "video/mp4",
              fileSizeBytes: media.length,
              ...(reference
                ? {
                    title: "Licensed real-pose test fixture",
                    originalFilename: "squat-ccby3.webm",
                  }
                : {}),
            },
          },
        );
        const upload = r[op];
        const put = await fetch(upload.url, {
          method: "PUT",
          headers: upload.headers,
          body: media,
        });
        assert.ok(put.ok, await put.text());
        const finalize = reference
          ? "finalizeReferenceVideoUpload"
          : "finalizeDrillVideoUpload";
        await query(`mutation($id:ID!){${finalize}(id:$id){id}}`, {
          id: upload.id,
        });
        return upload.id;
      }
      const ref = await upload(true);
      for (let i = 0; i < 3; i++) await worker.tick();
      const refRow = await db.drillReferenceVideo.findUniqueOrThrow({
        where: { id: ref },
      });
      assert.equal(refRow.uploadStatus, "READY_FOR_ANALYSIS");
      assert.ok(refRow.poseArtifactKey);
      await query(
        `mutation($id:ID!,$c:TrainingJSON!){configureReferenceCoverage(id:$id,config:$c)}`,
        { id: ref, c: { checkpointIds: checkpoints, acknowledge: true } },
      );
      await query(
        `mutation($id:ID!,$i:UpdateReferenceVideoInput!){updateReferenceVideo(id:$id,input:$i){id}}`,
        { id: ref, i: { status: "PUBLISHED" } },
      );
      const submission = await upload(false);
      for (let i = 0; i < 40; i++) {
        await worker.tick();
        if (
          (
            await db.drillVideoSubmission.findUniqueOrThrow({
              where: { id: submission },
            })
          ).status === "COMPLETED"
        )
          break;
      }
      const ws = (
        await query(`query($id:ID!){trainingVideoWorkspace(drillId:$id)}`, {
          id: drill.id,
        })
      ).trainingVideoWorkspace;
      const attempt = ws.submissions.find((s: any) => s.id === submission);
      assert.equal(attempt.status, "COMPLETED");
      const summary = attempt.analyses.find(
        (a: any) => a.status === "COMPLETED",
      );
      assert.ok(summary);
      const analysis = (
        await query(`query($id:ID!){videoAnalysis(id:$id){id status result}}`, {
          id: summary.id,
        })
      ).videoAnalysis;
      assert.ok(
        analysis.result.comparison.checkpoints.some(
          (c: any) => c.status === "EVALUATED",
        ),
      );
      assert.ok(
        analysis.result.comparison.checkpoints.some((c: any) =>
          c.evidence.some((e: any) => Math.abs(e.difference) > 0.1),
        ),
        "Rotated real clip should contain actual measured projected differences",
      );
      const actual = await query(
        `query($id:ID!){videoAnalysis(id:$id){id status result}}`,
        { id: analysis.id },
      );
      assert.equal(actual.videoAnalysis.status, "COMPLETED");
      await query(
        `query($id:ID!){videoAnalysis(id:$id){id}}`,
        { id: analysis.id },
        jwt.sign({ sub: other, id: other }),
        true,
      );
      await query(
        `mutation($id:ID!,$c:TrainingJSON!){configureDrillMotion(drillId:$id,config:$c)}`,
        {
          id: drill.id,
          c: {
            version: 1,
            enabled: true,
            allowMirroring: false,
            phaseWindows: [],
          },
        },
        jwt.sign({ sub: other, id: other }),
        true,
      );
      const playback = await query(
        `query($id:ID!){myDrillVideoPlayback(id:$id){url}}`,
        { id: submission },
      );
      assert.ok((await fetch(playback.myDrillVideoPlayback.url)).ok);
      const artifacts = await db.videoPoseArtifact.findMany({
        where: {
          OR: [{ referenceVideoId: ref }, { submissionId: submission }],
        },
      });
      assert.equal(artifacts.length, 2);
      console.log(
        JSON.stringify({
          PASS: true,
          referenceVideoId: ref,
          submissionId: submission,
          analysisId: analysis.id,
          drillId: drill.id,
          artifactCount: artifacts.length,
          quality: artifacts.map((a) => a.quality),
          comparison: analysis.result.comparison,
          apiReturnedActualResults: true,
          privateAccessDenied: true,
          coachAuthorizationDenied: true,
          fixture:
            "CC BY 3.0 fitness video; tests pipeline, not volleyball coaching validity",
        }),
      );
      if (process.env.VIDEO_SMOKE_EXPORT_PATH) {
        await import("node:fs/promises").then((fs) =>
          fs.writeFile(
            process.env.VIDEO_SMOKE_EXPORT_PATH!,
            JSON.stringify({ workspace: ws, analysis }),
          ),
        );
      }
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    if (app) await app.close();
    await db.$disconnect();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
