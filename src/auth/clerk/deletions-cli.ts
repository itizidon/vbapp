import { PrismaService } from "../../prisma/prisma.service";
import { options, target } from "../../feedback-processing/maintenance";
import { ClerkUserService } from "./users";
import { ClerkDeletionService } from "./deletion";
export async function main(args = process.argv.slice(2)) {
  const o = options(["deletions", ...args]),
    selected = target(o, process.env);
  const db = new PrismaService();
  try {
    console.log(
      JSON.stringify({
        target: { host: selected.host, database: selected.database },
        execute: o.execute && !o.dryRun,
        pending: await db.clerkDeletionJob.count({
          where: { status: { not: "COMPLETED" } },
        }),
      }),
    );
    if (!o.execute || o.dryRun) return;
    const service = new ClerkDeletionService(db, new ClerkUserService(db));
    let done = 0;
    while (done < o.batchSize && (await service.processOne())) done++;
    console.log(JSON.stringify({ attempted: done }));
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      "Clerk deletion maintenance failed; verify the selected target and migration status.",
    );
    process.exitCode = 1;
  });
