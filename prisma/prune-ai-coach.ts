import { PrismaClient } from "@prisma/client";
async function main() {
  const apply = process.argv[2] === "--apply";
  if (!apply && process.argv[2] !== "--dry-run")
    throw Error("Use --dry-run or --apply");
  const db = new PrismaClient();
  try {
    const now = new Date();
    const before = new Date(now.getTime() - 365 * 86400000);
    if (apply) {
      const conversations = await db.aiCoachConversation.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      const usage = await db.aiCoachUsage.deleteMany({
        where: { day: { lt: before } },
      });
      console.log(
        JSON.stringify({
          conversations: conversations.count,
          usageBuckets: usage.count,
        }),
      );
    } else
      console.log(
        JSON.stringify({
          expiredConversations: await db.aiCoachConversation.count({
            where: { expiresAt: { lte: now } },
          }),
        }),
      );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Coach retention command failed. Check migration, configuration, and arguments.",
  );
  process.exitCode = 1;
});
