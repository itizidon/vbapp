/** Backup-gated, explicit fresh-start cutover. Never called at application startup. */
import { PrismaClient } from "@prisma/client";
import {
  CutoverCheckError,
  cutoverDiagnostic,
  inspectCutoverSchema,
  type CutoverPhase,
} from "./cutover-diagnostics";
let phase: CutoverPhase = "configuration";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  statSync,
  mkdtempSync,
  cpSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
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
const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
export async function fingerprints(
  db: Pick<PrismaClient, "$queryRawUnsafe">,
  tables: string[],
) {
  const rows: Record<string, { count: number; hash: string }> = {};
  for (const table of tables) {
    const [row] = await db.$queryRawUnsafe<{ count: number; hash: string }[]>(
      `SELECT count(*)::int count,md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) hash FROM ${quote(table)} t`,
    );
    rows[table] = row;
  }
  return rows;
}
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
  if (execute && flags.get("--confirm-database") !== database)
    throw new CutoverCheckError(
      "Use --confirm-database with the exact reviewed database name",
    );
  console.log(
    JSON.stringify({
      tool: "clerk-cutover",
      diagnosticsVersion: 1,
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
      const temp = mkdtempSync(join(tmpdir(), "bvbtips-clerk-bootstrap-"));
      try {
        cpSync(resolve("prisma/schema.prisma"), join(temp, "schema.prisma"));
        cpSync(resolve("prisma/migrations"), join(temp, "migrations"), {
          recursive: true,
          filter: (source) =>
            !source.includes("20261126000000_clerk_identity_cutover"),
        });
        execFileSync(
          process.execPath,
          [
            resolve("node_modules/prisma/build/index.js"),
            "migrate",
            "deploy",
            "--schema",
            join(temp, "schema.prisma"),
          ],
          { env: process.env, stdio: "inherit" },
        );
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
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
    mkdirSync(resolve(directory), { recursive: true, mode: 0o700 });
    const prefix = join(
        resolve(directory),
        "clerk-cutover-" +
          new Date().toISOString().replace(/[:.]/g, "-") +
          "-" +
          randomUUID().slice(0, 8),
      ),
      backup = prefix + ".dump",
      manifest = prefix + ".json";
    await db.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "_ClerkCutoverPermit"(id text PRIMARY KEY,"backupSha256" text NOT NULL,database text NOT NULL,snapshot jsonb NOT NULL,"expiresAt" timestamptz NOT NULL)`,
    );
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
        await tx.$executeRawUnsafe(
          "LOCK TABLE " + tables.map(quote).join(",") + " IN EXCLUSIVE MODE",
        );
        const snapshot = await fingerprints(tx, tables),
          fd = openSync(backup, "wx", 0o600);
        const password = decodeURIComponent(url.password),
          env = { ...process.env, PGPASSWORD: password };
        try {
          const container = flags.get("--docker-container");
          if (container) {
            if (!local)
              throw new CutoverCheckError("Container backup is local-only");
            const inspected = JSON.parse(
              execFileSync("docker", ["inspect", container], {
                encoding: "utf8",
              }),
            )[0];
            if (
              !inspected.NetworkSettings?.Ports?.["5432/tcp"]?.some(
                (p: { HostPort: string }) => p.HostPort === port,
              )
            )
              throw new CutoverCheckError(
                "Backup container does not match the selected database port",
              );
            execFileSync(
              "docker",
              [
                "exec",
                "--env",
                "PGPASSWORD",
                container,
                "pg_dump",
                "-U",
                decodeURIComponent(url.username),
                "-d",
                database,
                "-Fc",
              ],
              { env, stdio: ["ignore", fd, "pipe"] },
            );
          } else {
            const connection = new URL(url);
            connection.password = "";
            execFileSync(
              "pg_dump",
              ["--dbname", connection.toString(), "-Fc"],
              { env, stdio: ["ignore", fd, "pipe"] },
            );
          }
        } finally {
          closeSync(fd);
        }
        phase = "backup-validation";
        if (
          statSync(backup).size < 100 ||
          readFileSync(backup).subarray(0, 5).toString() !== "PGDMP"
        )
          throw new CutoverCheckError("PostgreSQL backup validation failed");
        // Validate the archive directory with PostgreSQL itself before issuing the destructive permit.
        const container = flags.get("--docker-container");
        const listing = container
          ? execFileSync(
              "docker",
              ["exec", "-i", container, "pg_restore", "--list"],
              {
                input: readFileSync(backup),
                encoding: "utf8",
                maxBuffer: 64 * 1024 * 1024,
              },
            )
          : execFileSync("pg_restore", ["--list", backup], {
              encoding: "utf8",
              maxBuffer: 64 * 1024 * 1024,
            });
        if (!listing.includes("TABLE DATA"))
          throw new CutoverCheckError(
            "Backup archive has no restorable table data",
          );
        const sha256 = createHash("sha256")
          .update(readFileSync(backup))
          .digest("hex");
        writeFileSync(
          manifest,
          JSON.stringify(
            {
              version: 1,
              target: { host, port, database },
              backup,
              sha256,
              snapshot,
              createdAt: new Date().toISOString(),
            },
            null,
            2,
          ),
          { mode: 0o600, flag: "wx" },
        );
        await tx.$executeRaw`INSERT INTO "_ClerkCutoverPermit"(id,"backupSha256",database,snapshot,"expiresAt") VALUES('clerk-fresh-start',${sha256},current_database(),${JSON.stringify(snapshot)}::jsonb,now()+interval '15 minutes') ON CONFLICT(id) DO UPDATE SET "backupSha256"=excluded."backupSha256",snapshot=excluded.snapshot,"expiresAt"=excluded."expiresAt"`;
      },
      { timeout: 600000, maxWait: 10000 },
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
