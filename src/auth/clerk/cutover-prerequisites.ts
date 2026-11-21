import type { PrismaClient } from "@prisma/client";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createVerifiedBackup, fingerprints } from "./cutover-backup";
import {
  CutoverCheckError,
  inspectCutoverSchema,
  type CutoverPhase,
} from "./cutover-diagnostics";
export const CLERK_CUTOVER = "20261126000000_clerk_identity_cutover";
export const PREREQUISITE_MIGRATIONS = [
  "20261122000000_training_library",
  "20261123000000_motion_comparison",
  "20261124000000_social_auth",
  "20261124010000_oauth_deletion_replay",
  "20261125000000_email_verification",
];
function historicalMigrations() {
  return readdirSync(resolve("prisma/migrations"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^\d{14}_/.test(entry.name) &&
        entry.name < CLERK_CUTOVER,
    )
    .map((entry) => entry.name)
    .sort();
}
/** A temporary migration tree prevents the final destructive reset from being selected at all. */
export function deployHistoricalMigrations() {
  const allowed = new Set(historicalMigrations()),
    source = resolve("prisma/migrations"),
    temp = mkdtempSync(join(tmpdir(), "bvbtips-clerk-prerequisites-"));
  try {
    cpSync(resolve("prisma/schema.prisma"), join(temp, "schema.prisma"));
    cpSync(source, join(temp, "migrations"), {
      recursive: true,
      filter: (path) => {
        const first = relative(source, path).split(/[\\/]/)[0];
        return !first || first === "migration_lock.toml" || allowed.has(first);
      },
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
}
export async function prerequisitePlan(db: Pick<PrismaClient, "$queryRaw">) {
  const rows = await db.$queryRaw<
    { name: string }[]
  >`SELECT migration_name AS name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const applied = new Set(rows.map((row) => row.name)),
    pending = historicalMigrations().filter((name) => !applied.has(name));
  const unsupported = pending.filter(
    (name) => !PREREQUISITE_MIGRATIONS.includes(name),
  );
  if (unsupported.length)
    throw new CutoverCheckError(
      "The database is older than the supported prerequisite baseline. Review the historical migration plan before preparing it.",
      "UNSUPPORTED_PREREQUISITE_BASELINE",
      { pendingMigrations: pending },
    );
  if (applied.has(CLERK_CUTOVER))
    throw new CutoverCheckError(
      "The Clerk migration is recorded as applied but legacy account tables remain. Inspect schema drift before preparing it.",
      "INCONSISTENT_CUTOVER_STATE",
    );
  return pending;
}
export async function prepareHistoricalSchema(
  db: PrismaClient,
  url: URL,
  expected: string[],
  schema: { missingTables: string[]; failedMigrations: string[] },
  options: {
    execute: boolean;
    backupDir?: string;
    dockerContainer?: string;
    onPhase?: (phase: CutoverPhase) => void;
  },
) {
  options.onPhase?.("prerequisites");
  if (schema.failedMigrations.length)
    throw new CutoverCheckError(
      "Failed migrations must be inspected and their transaction state verified before prerequisite preparation. No schema change was attempted.",
      "FAILED_MIGRATIONS",
      schema,
    );
  const pending = await prerequisitePlan(db);
  if (!pending.length && schema.missingTables.length)
    throw new CutoverCheckError(
      "Migration history reports prerequisites applied but their tables are missing. Inspect schema drift; no schema change was attempted.",
      "PREREQUISITE_SCHEMA_DRIFT",
      schema,
    );
  const missing = new Set(schema.missingTables),
    existing = expected.filter((table) => !missing.has(table));
  const snapshot = await fingerprints(db, existing);
  console.log(
    JSON.stringify({
      message: `Historical prerequisites ${options.execute ? "execution" : "preview"}: ${pending.length ? pending.join(", ") : "already installed"}. Clerk identity reset is excluded.`,
      operation: "prepare-schema",
      execute: options.execute,
      pendingMigrations: pending,
      missingTables: schema.missingTables,
      existingRecordCounts: Object.fromEntries(
        Object.entries(snapshot).map(([name, row]) => [name, row.count]),
      ),
      cutoverExecuted: false,
    }),
  );
  if (!options.execute) return;
  if (!pending.length) {
    console.log(
      JSON.stringify({
        prepared: true,
        cutoverExecuted: false,
        alreadyPrepared: true,
      }),
    );
    return;
  }
  if (!options.backupDir)
    throw new CutoverCheckError(
      "--backup-dir is required before historical prerequisite migrations.",
      "BACKUP_REQUIRED",
    );
  const saved = await createVerifiedBackup(
    db,
    url,
    options.backupDir,
    existing,
    {
      dockerContainer: options.dockerContainer,
      purpose: "clerk-prerequisites",
      authorizeCutover: false,
      onPhase: options.onPhase,
    },
  );
  console.log(
    JSON.stringify({
      backup: saved.backup,
      manifest: saved.manifest,
      backupComplete: true,
      cutoverAuthorized: false,
    }),
  );
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
    const current = await fingerprints(tx, existing);
    for (const name of existing)
      if (current[name].hash !== saved.snapshot[name].hash)
        throw new CutoverCheckError(
          "Database changed after the prerequisite backup. Stop writers and inspect before retrying.",
          "SOURCE_CHANGED_AFTER_BACKUP",
        );
  });
  options.onPhase?.("prerequisites");
  deployHistoricalMigrations();
  const after = await inspectCutoverSchema(db, expected);
  if (after.missingTables.length || after.failedMigrations.length)
    throw new CutoverCheckError(
      "Historical preparation did not complete. Inspect migration history; the Clerk reset was not requested.",
      "PREREQUISITES_INCOMPLETE",
      after,
    );
  const preserved = await fingerprints(db, existing);
  for (const name of existing)
    if (preserved[name].count !== saved.snapshot[name].count)
      throw new CutoverCheckError(
        "An existing table row count changed during prerequisite preparation. Inspect the backup and migration logs before continuing.",
        "PREREQUISITE_RECORD_COUNT_CHANGED",
      );
  console.log(
    JSON.stringify({
      message:
        "Historical prerequisites installed; existing record counts preserved. Run the separate read-only Clerk cutover preview next.",
      prepared: true,
      cutoverExecuted: false,
      existingRecordCountsPreserved: true,
      backup: saved.backup,
      manifest: saved.manifest,
    }),
  );
}
