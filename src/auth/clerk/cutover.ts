/** Backup-gated, explicit fresh-start cutover. Never called at application startup. */
import { PrismaClient } from "@prisma/client";
import { createVerifiedBackup, fingerprints } from "./cutover-backup";
export { fingerprints } from "./cutover-backup";
import {
  prepareHistoricalSchema,
  deployHistoricalMigrations,
} from "./cutover-prerequisites";
import {
  CutoverCheckError,
  cutoverDiagnostic,
  inspectCutoverSchema,
  type CutoverPhase,
} from "./cutover-diagnostics";
let phase: CutoverPhase = "configuration";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
export const identityTables = [
  "User",
  "UserAuthProvider",
  "OAuthTransaction",
  "AuthEmailChallenge",
  "AuthProviderDeletion",
];
export const contentTables = [
  "Sport",
  "Skill",
  "FeedbackTheme",
  "SkillTreeNode",
  "SkillPrerequisite",
  "Drill",
  "DrillStep",
  "DrillSkill",
  "CoachingSituation",
  "DrillRecommendationRule",
  "DrillTechniqueVariant",
  "DrillReferenceVideo",
  "TechniqueCheckpoint",
  "VideoWorkerHeartbeat",
];
export const activityTables = [
  "Match",
  "MatchTeam",
  "MatchParticipant",
  "Feedback",
  "FeedbackRating",
  "SelfAssessment",
  "SelfAssessmentRating",
  "FeedbackReviewerSkillSnapshot",
  "PlayerInternalRating",
  "PlayerInternalRatingEvent",
  "SelfAssessmentRatingEvent",
  "InternalRatingContribution",
  "FeedbackLink",
  "FeedbackRequestMatch",
  "FeedbackMatch",
  "FeedbackSubmission",
  "FeedbackAnalysisJob",
  "FeedbackExtractionRun",
  "FeedbackObservation",
  "FeedbackEmbeddingJob",
  "FeedbackObservationEmbedding",
  "PlayerFeedbackAnalysisProfile",
  "AiCoachConversation",
  "AiCoachTurn",
  "AiCoachUsage",
  "FeedbackPrivacyEvent",
  "DrillVideoSubmission",
  "VideoAnalysis",
  "VideoAnalysisReference",
  "PlayerTrainingProfile",
  "PlayerSkillProgress",
  "DrillCompletion",
  "LegacyPlayerSkillRating",
  "LegacyPlayerSportRating",
];
export const mixedTables = ["VideoPoseArtifact", "VideoProcessingJob"];
export async function main(args = process.argv.slice(2)) {
  phase = "configuration";
  const envFile = args.find((a) => a.startsWith("--env-file="));
  if (envFile) process.loadEnvFile(envFile.slice(11));
  const known = new Set([
    "--execute",
    "--dry-run",
    "--allow-remote",
    "--allow-production",
    "--confirm-database",
    "--backup-dir",
    "--docker-container",
    "--prepare-schema",
  ]);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--env-file=")) continue;
    if (!known.has(args[i]))
      throw new CutoverCheckError("Unknown cutover option");
    const name = args[i];
    flags.set(
      name,
      ["--confirm-database", "--backup-dir", "--docker-container"].includes(
        name,
      )
        ? args[++i]
        : "true",
    );
  }
  let url: URL;
  try {
    url = new URL(process.env.DATABASE_URL ?? "");
  } catch {
    throw new CutoverCheckError(
      "DATABASE_URL is missing or invalid. Set the selected backend service PostgreSQL connection, not a placeholder.",
      "INVALID_DATABASE_URL",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  )
    throw new CutoverCheckError(
      "DATABASE_URL must identify a PostgreSQL database.",
      "INVALID_DATABASE_URL",
    );
  const host = url.hostname,
    port = url.port || "5432",
    database = decodeURIComponent(url.pathname.slice(1));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host),
    production =
      process.env.NODE_ENV === "production" ||
      process.env.APP_ENV === "production";
  if (!local && !flags.has("--allow-remote"))
    throw new CutoverCheckError("Remote database requires --allow-remote");
  if (production && !flags.has("--allow-production"))
    throw new CutoverCheckError(
      "Production requires separate explicit authorization and --allow-production",
    );
  const execute = flags.has("--execute") && !flags.has("--dry-run");
  const prepareSchema = flags.has("--prepare-schema");
  if (execute && flags.get("--confirm-database") !== database)
    throw new CutoverCheckError(
      "Use --confirm-database with the exact reviewed database name",
    );
  console.log(
    JSON.stringify({
      tool: "clerk-cutover",
      diagnosticsVersion: 1,
      operation: prepareSchema ? "prepare-schema" : "identity-cutover",
      target: { host, port, database },
      mode: execute ? "execute" : "dry-run",
      execute,
    }),
  );
  const db = new PrismaClient();
  try {
    phase = "connection";
    await db.$connect();
    phase = "schema";
    let exists = await db.$queryRaw<
      { present: boolean; catalog: boolean }[]
    >`SELECT to_regclass('public."User"') IS NOT NULL present,to_regclass('public."Sport"') IS NOT NULL catalog`;
    if (!exists[0].present && !exists[0].catalog) {
      console.log(
        JSON.stringify({
          target: { host, port, database },
          emptyDatabase: true,
          bootstrapRequired: true,
          execute,
        }),
      );
      if (!execute) return;
      if (!flags.get("--backup-dir"))
        throw new CutoverCheckError("--backup-dir is required");
      phase = "bootstrap";
      deployHistoricalMigrations();
      exists =
        await db.$queryRaw`SELECT to_regclass('public."User"') IS NOT NULL present,to_regclass('public."Sport"') IS NOT NULL catalog`;
    }
    if (!exists[0].present) {
      const [state] = await db.$queryRaw<
        { complete: boolean }[]
      >`SELECT to_regclass('public."ClerkDeletionJob"') IS NOT NULL complete`;
      if (!state.complete)
        throw new CutoverCheckError(
          "Partial identity cutover; inspect the schema and restore procedure",
        );
      console.log(
        JSON.stringify({
          target: { host, port, database },
          alreadyCutOver: true,
        }),
      );
      return;
    }
    const tables = [
      ...new Set([
        ...identityTables,
        ...contentTables,
        ...activityTables,
        ...mixedTables,
      ]),
    ];
    const schema = await inspectCutoverSchema(db, tables);
    console.log(JSON.stringify({ phase: "schema", ...schema }));
    if (prepareSchema) {
      await prepareHistoricalSchema(db, url, tables, schema, {
        execute,
        backupDir: flags.get("--backup-dir"),
        dockerContainer: flags.get("--docker-container"),
        onPhase: (next) => {
          phase = next;
        },
      });
      return;
    }
    if (schema.missingTables.length)
      throw new CutoverCheckError(
        `Historical schema is missing required cutover tables: ${schema.missingTables.join(", ")}. ${schema.failedMigrations.length ? `Failed migrations: ${schema.failedMigrations.join(", ")}. ` : ""}Inspect migration status before continuing; no reset was attempted.`,
        "MISSING_PREREQUISITE_TABLES",
        schema,
      );
    if (execute && schema.failedMigrations.length)
      throw new CutoverCheckError(
        "Failed migrations are recorded. Inspect the original errors and confirm rollback before resolving migration history; no reset was attempted.",
        "FAILED_MIGRATIONS",
        schema,
      );
    phase = "inventory";
    const snapshot = await fingerprints(db, tables);
    console.log(
      JSON.stringify(
        {
          target: { host, port, database },
          execute,
          removeIdentity: identityTables.map((name) => ({
            name,
            ...snapshot[name],
          })),
          clearActivity: activityTables.map((name) => ({
            name,
            ...snapshot[name],
          })),
          preserveContent: contentTables.map((name) => ({
            name,
            ...snapshot[name],
          })),
          mixedMedia: mixedTables.map((name) => ({ name, ...snapshot[name] })),
          preservationPolicy:
            "Keep reference-only pose artifacts/jobs; remove old creator attribution; queue private player media cleanup. No object storage is deleted by this command.",
        },
        null,
        2,
      ),
    );
    if (!execute) return;
    const directory = flags.get("--backup-dir");
    if (!directory)
      throw new CutoverCheckError(
        "--backup-dir is required before any destructive cutover",
      );
    phase = "backup";
    const { backup, manifest } = await createVerifiedBackup(
      db,
      url,
      directory,
      tables,
      {
        dockerContainer: flags.get("--docker-container"),
        authorizeCutover: true,
        onPhase: (next) => {
          phase = next;
        },
      },
    );
    console.log(JSON.stringify({ backup, manifest, backupComplete: true }));
    phase = "migration";
    // Prisma applies a single transactional reset; its SQL checks the permit and unchanged snapshot again.
    execFileSync(
      process.execPath,
      [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { env: process.env, stdio: "inherit" },
    );
    phase = "verification";
    const [check] = await db.$queryRaw<
      { userTableGone: boolean }[]
    >`SELECT to_regclass('public."User"') IS NULL "userTableGone"`;
    if (!check.userTableGone)
      throw new CutoverCheckError(
        "Clerk cutover did not remove the User table",
      );
    console.log(
      JSON.stringify({
        complete: true,
        backup,
        manifest,
        userTableGone: true,
        productionDeployed: false,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(
      JSON.stringify({
        tool: "clerk-cutover",
        status: "FAILED",
        ...cutoverDiagnostic(error, phase),
        automaticRetry: false,
      }),
    );
    process.exitCode = 1;
  });
