import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, locked = false) {
  const submissions: Record<string, unknown>[] = [];
  await page.route("**/api/graphql", async (route) => {
    const { query, variables } = route.request().postDataJSON();
    let data = {};
    if (query.includes("FeedbackInvitation"))
      data = {
        feedbackInvitation: {
          recipientId: "recipient",
          recipientUsername: "Recipient",
          assignedReviewer: locked
            ? { id: "approver-id", username: "Approver" }
            : null,
          approvalRequired: locked,
          match: null,
          matches: [],
          sport: {
            id: "beach",
            name: "Beach Volleyball",
            slug: "beach-volleyball",
            skills: ["Attack", "Defense", "Passing", "Setting", "Serving"].map(
              (name) => ({
                id: name.toLowerCase(),
                name,
                slug: name.toLowerCase(),
                sportId: "beach",
                active: true,
                requiredForSelfAssessment: false,
                description: `${name} description`,
              }),
            ),
          },
        },
      };
    else if (query.includes("FeedbackReviewers"))
      data = {
        feedbackReviewers: [
          { id: "recipient", username: "Recipient" },
          { id: "approver-id", username: "Approver" },
        ],
      };
    else if (query.includes("mutation")) {
      submissions.push(variables.input);
      data = { submitGuestFeedback: { id: "pending", status: "PENDING" } };
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/f/${"b".repeat(64)}?mode=device`);
  await expect(
    page.getByRole("region", { name: "Feedback Details" }),
  ).toBeVisible();
  return submissions;
}

test("unified feedback details switch giver types without losing the review and support keyboard assignment", async ({
  page,
}, info) => {
  const submissions = await fixture(page);
  const infoPanel = page.getByRole("complementary", {
    name: "Feedback user information",
  });
  await expect(infoPanel.locator(":scope > *")).toHaveCount(1);
  await expect(
    infoPanel.getByText("@Recipient", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Guest name").fill("Guest draft name");
  await page.getByRole("radio", { name: "Attacking: 5 out of 5" }).click();
  await page.getByRole("button", { name: "Attacking", exact: true }).click();
  await page.getByLabel("Attacking comment").fill("Keep my review");
  await page
    .getByRole("button", { name: "Registered User", exact: true })
    .click();
  const search = page.getByRole("combobox", { name: "Feedback giver" });
  await search.fill("App");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(infoPanel.getByText("@Approver", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "@Approver must sign in and approve this feedback before it is published.",
      { exact: true },
    ),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Card Review", exact: true }).click();
  await expect(page.getByLabel("Add a comment")).toHaveValue("Keep my review");
  await page.getByRole("button", { name: "Guest", exact: true }).click();
  await expect(page.getByLabel("Guest name")).toHaveValue("Guest draft name");
  await expect(
    page.getByRole("radio", { name: "Attacking: 5 out of 5" }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Registered User", exact: true })
    .click();
  await search.fill("App");
  await page.getByRole("option", { name: /Approver/ }).click();
  await page.getByRole("button", { name: "Quick Review", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/vbapp-feedback-details-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review & Submit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit Feedback", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Thanks for your feedback." }),
  ).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    assignedReviewerId: "approver-id",
    ratings: [{ skillId: "attack", rating: 5, comment: "Keep my review" }],
  });
  expect(submissions[0]).not.toHaveProperty("guestName");
  expect(submissions[0]).not.toHaveProperty("reviewerId");
});

test("preassigned feedback giver stays locked and approval is explained once", async ({
  page,
}) => {
  const submissions = await fixture(page, true);
  await expect(
    page.getByRole("button", { name: "Registered User", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Registered User", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Guest", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Remove", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "@Approver must sign in and approve this feedback before it is published.",
      { exact: true },
    ),
  ).toHaveCount(1);
  await page.getByRole("radio", { name: "Passing: 4 out of 5" }).click();
  await page
    .getByRole("button", { name: "Review & Submit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit Feedback", exact: true })
    .click();
  await expect(page.getByText(/Your draft is awaiting Approver/)).toBeVisible();
  expect(submissions[0]).not.toHaveProperty("assignedReviewerId");
  expect(submissions[0]).not.toHaveProperty("reviewerId");
});
