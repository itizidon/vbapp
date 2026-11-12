import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
// V1 serializes rating-affecting writes globally. Acquire before any source locks.
// READ COMMITTED reads see the last holder's committed results after waiting.
export async function ratingTransaction<T>(
  db: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(73011421)`;
          return work(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 15000,
          timeout: 30000,
        },
      );
    } catch (error) {
      if (
        attempt >= 3 ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034"
      )
        throw error;
    }
  }
}
