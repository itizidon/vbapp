/** Read-only guard for ordinary deployments; fresh-start cutovers require the backup-gated CLI. */
import { PrismaClient } from "@prisma/client";
export class DeploymentPreflightError extends Error {}
type Db = Pick<PrismaClient, "$queryRaw">;
export async function deploymentPreflight(db: Db) {
  const [schema] = await db.$queryRaw<
    {
      legacy: boolean;
      clerk: boolean;
      migrations: boolean;
    }[]
  >`SELECT to_regclass('public."User"') IS NOT NULL AS legacy,
    to_regclass('public."ClerkDeletionJob"') IS NOT NULL AS clerk,
    to_regclass('public."_prisma_migrations"') IS NOT NULL AS migrations`;
  if (schema.migrations) {
    const failed = await db.$queryRaw<{ name: string }[]>`
      SELECT migration_name AS name FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at DESC`;
    if (failed.length)
      throw new DeploymentPreflightError(
        failed.some(
          (row) => row.name === "20261126000000_clerk_identity_cutover",
        )
          ? "A failed Clerk cutover is recorded. Stop db:deploy retries. Confirm QA versus production, inspect the migration logs and schema, and follow docs/clerk-migration.md recovery instructions. Do not mark the cutover applied or remove its backup guard."
          : "A failed migration is recorded. Inspect pnpm prisma migrate status and the migration logs before retrying deployment.",
      );
  }
  if (schema.legacy || !schema.clerk)
    throw new DeploymentPreflightError(
      "Initial Clerk cutover is required. Ordinary db:deploy cannot perform the destructive fresh start. Run clerk:cutover --dry-run against the explicitly selected environment, review the inventory, and use the backup-gated procedure in docs/clerk-migration.md before deployment. No migration or seed was run.",
    );
}
export async function main() {
  const db = new PrismaClient();
  try {
    await deploymentPreflight(db);
    console.log("Clerk deployment preflight passed.");
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(
      error instanceof DeploymentPreflightError
        ? error.message
        : "Database deployment preflight could not complete. Verify the selected database and connectivity; no migration or seed was run.",
    );
    process.exitCode = 1;
  });
