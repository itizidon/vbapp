import { setPeerRating } from "./rating-helpers";
import { test, expect } from "@playwright/test";
test("private processing is optional and public sharing stays separate on every viewport", async ({
  page,
}) => {
  const calls: Record<string, unknown>[] = [];
  await page.route("**/api/graphql", async (route) => {
    const { query, variables } = route.request().postDataJSON();
    if (query.includes("FeedbackInvitation"))
      return route.fulfill({
        json: {
          data: {
            feedbackInvitation: {
              recipientId: "player",
              recipientUsername: "BeachPlayer",
              assignedReviewer: null,
              approvalRequired: false,
              guestSession: true,
              matches: [],
              reviewMode: "INDIVIDUAL_MATCHES",
              match: null,
              sport: {
                id: "sport",
                name: "Beach Volleyball",
                slug: "beach-volleyball",
                skills: [
                  "attack",
                  "defense",
                  "passing",
                  "setting",
                  "serving",
                ].map((slug) => ({
                  id: slug,
                  sportId: "sport",
                  name: slug,
                  slug,
                  description: "A volleyball skill.",
                  active: true,
                  requiredForSelfAssessment: false,
                })),
              },
            },
          },
        },
      });
    if (query.includes("GuestFeedback")) {
      calls.push(variables.input);
      return route.fulfill({
        json: {
          data: {
            submitGuestFeedback: {
              id: "saved",
              privacyWithdrawalToken: "purpose-limited-receipt",
            },
          },
        },
      });
    }
    if (query.includes("Withdraw"))
      return route.fulfill({
        json: { data: { withdrawGuestFeedbackPrivacy: true } },
      });
    return route.fulfill({
      status: 401,
      json: { errors: [{ message: "Sign in" }] },
    });
  });
  await page.goto("/f/test-invitation?mode=device");
  await page.getByRole("button", { name: "Quick Review", exact: true }).click();
  await setPeerRating(page, "Attacking", 4);
  await page.getByRole("button", { name: "Review & Submit" }).click();
  await expect(
    page.getByRole("heading", { name: "How your feedback is used" }),
  ).toBeVisible();
  const consent = page.getByRole("checkbox", {
    name: /Allow private performance analytics/,
  });
  await expect(consent).not.toBeChecked();
  await expect(
    page.getByRole("link", { name: /Privacy notice and withdrawal/ }),
  ).toHaveAttribute("href", "/privacy");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Submit Feedback", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Thanks for your feedback." }),
  ).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    privateAnalyticsAllowed: false,
    privateCoachingAllowed: false,
  });
  expect(calls[0]).not.toHaveProperty("publicAnalyticsAllowed");
  await expect(
    page.getByRole("link", { name: "Manage privacy for review 1" }),
  ).toHaveAttribute("href", "/privacy/feedback#purpose-limited-receipt");
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: "How BVBTips uses feedback" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
