import { expect, it } from "vitest";
import PublicPlayerPage from "../src/app/players/[playerId]/page";
import RegisteredFeedbackPage from "../src/app/(workspace)/give-feedback/[userId]/page";
it("accepts Clerk subjects on player history and registered feedback routes", async () => {
  const id = "user_clerkfixture123";
  const history = await PublicPlayerPage({
    params: Promise.resolve({ playerId: id }),
  });
  expect(history.props.id).toBe(id);
  const feedback = await RegisteredFeedbackPage({
    params: Promise.resolve({ userId: id }),
  });
  expect(feedback.props.children.props.recipientId).toBe(id);
});
it("rejects retired UUID identities and malformed player routes", async () => {
  for (const id of [
    "11111111-1111-4111-8111-111111111111",
    "user_bad",
    "not-a-player",
  ]) {
    await expect(
      PublicPlayerPage({ params: Promise.resolve({ playerId: id }) }),
    ).rejects.toThrow();
    await expect(
      RegisteredFeedbackPage({ params: Promise.resolve({ userId: id }) }),
    ).rejects.toThrow();
  }
});
