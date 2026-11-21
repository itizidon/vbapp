import type { PrismaClient } from "@prisma/client";
export type CutoverPhase =
  | "configuration"
  | "connection"
  | "schema"
  | "inventory"
  | "bootstrap"
  | "prerequisites"
  | "backup"
  | "backup-validation"
  | "migration"
  | "verification";
export class CutoverCheckError extends Error {
  constructor(
    message: string,
    readonly code = "CUTOVER_CHECK_FAILED",
    readonly details: {
      missingTables?: string[];
      failedMigrations?: string[];
      pendingMigrations?: string[];
    } = {},
  ) {
    super(message);
  }
}
/** Table/migration metadata only: never query account content or print connection credentials. */
export async function inspectCutoverSchema(
  db: Pick<PrismaClient, "$queryRaw">,
  expected: string[],
) {
  const tables = await db.$queryRaw<
    { name: string }[]
  >`SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname='public'`;
  const names = new Set(tables.map((row) => row.name));
  const failed = names.has("_prisma_migrations")
    ? await db.$queryRaw<
        { name: string }[]
      >`SELECT migration_name AS name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at`
    : [];
  return {
    missingTables: expected.filter((name) => !names.has(name)),
    failedMigrations: failed.map((row) =>
      /^[a-zA-Z0-9_-]{1,200}$/.test(row.name)
        ? row.name
        : "[unrecognized-migration-name]",
    ),
  };
}
/** Error text, stack, stderr, input URLs and Prisma metadata are intentionally never serialized. */
export function cutoverDiagnostic(error: unknown, phase: CutoverPhase) {
  if (error instanceof CutoverCheckError)
    return {
      phase,
      code: error.code,
      message: error.message,
      ...error.details,
    };
  const value =
    error && typeof error === "object"
      ? (error as {
          code?: unknown;
          errorCode?: unknown;
          meta?: { code?: unknown };
          status?: unknown;
        })
      : {};
  const rawCode =
    typeof value.code === "string"
      ? value.code
      : typeof value.errorCode === "string"
        ? value.errorCode
        : "";
  const code = /^(P\d{4}|ENOENT|EACCES|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)$/.test(
    rawCode,
  )
    ? rawCode
    : "CUTOVER_FAILED";
  const messages: Record<string, string> = {
    P1000:
      "Database authentication failed. Check the selected service DATABASE_URL without sharing it.",
    P1001:
      "Database server is unreachable. Check DATABASE_URL and private-network access from this deployment.",
    P1002: "The database connection timed out.",
    P1003: "The selected database does not exist.",
    P1010:
      "The database user does not have permission to access the selected database.",
    P1011:
      "Database TLS setup failed. Check the database connection SSL settings.",
    P1012: "The database client configuration is invalid.",
    P1013: "DATABASE_URL has an invalid connection-string format.",
    P1017: "The database server closed the connection.",
    P2021:
      "A required database table is missing. Inspect the historical migration state.",
    ENOENT:
      "A required executable or file is unavailable. For backup phases, check pg_dump and pg_restore are installed.",
    EACCES:
      "An executable or backup directory is not accessible to this process.",
    ECONNREFUSED: "The database connection was refused.",
    ENOTFOUND:
      "The database hostname could not be resolved from this environment.",
    ETIMEDOUT: "A connection or subprocess timed out.",
  };
  const sqlState =
    typeof value.meta?.code === "string" &&
    /^[0-9A-Z]{5}$/.test(value.meta.code)
      ? value.meta.code
      : undefined;
  return {
    phase,
    code,
    message:
      messages[code] ??
      "Cutover failed at the reported phase. Inspect database/service logs for the original error; no automatic reset retry was attempted.",
    ...(sqlState ? { sqlState } : {}),
    ...(Number.isSafeInteger(value.status) ? { exitStatus: value.status } : {}),
  };
}
