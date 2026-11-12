import { PrismaService } from "../src/prisma/prisma.service";
import { InternalRatingsService } from "../src/internal-ratings/internal-ratings.service";
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--dry-run", "--apply"].includes(args[0]))
    throw new Error("Use --dry-run or --apply explicitly");
  const db = new PrismaService();
  try {
    console.log(
      JSON.stringify(
        await new InternalRatingsService(db).backfill(args[0] === "--dry-run"),
        null,
        2,
      ),
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    "Rating backfill failed. Check migrations, database access, and arguments.",
  );
  process.exitCode = 1;
});
