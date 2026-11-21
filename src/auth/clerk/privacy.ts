import { ClerkUserService } from "./users";
import { isClerkUserId, privatePlayer } from "./metadata";
import { NotFoundException } from "@nestjs/common";
export async function clerkCoachingAllowed(
  userId: string,
  users = new ClerkUserService(),
): Promise<boolean> {
  if (!isClerkUserId(userId)) return false;
  try {
    return privatePlayer(await users.getUserById(userId, true))
      .aiCoachingEnabled;
  } catch (e) {
    if (e instanceof NotFoundException) return false;
    throw e;
  }
}
