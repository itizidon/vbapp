import { test, expect, type Page } from "@playwright/test";
const matchId = "44444444-4444-4444-8444-444444444444";
async function openReview(
  page: Page,
  { authenticated = false, returnTo = "", expired = false } = {},
) {
  const skills = ["Attack", "Defense", "Passing", "Setting", "Serving"].map(
    (name) => ({
      id: name.toLowerCase(),
      sportId: "sport",
      name,
      slug: name.toLowerCase(),
      description: `${name} description`,
      active: true,
      requiredForSelfAssessment: false,
    }),
  );
  const sport = {
    id: "sport",
    name: "Beach Volleyball",
    slug: "beach-volleyball",
    skills,
  };
  const user = {
    id: "reviewer",
    username: "Reviewer",
    email: "reviewer@example.test",
    createdAt: "2026-11-01",
    isPublic: false,
  };
  await page.route("**/api/graphql", async (route) => {
    const { query } = route.request().postDataJSON();
    if (query.includes("query Me"))
      return route.fulfill({
        status: authenticated ? 200 : 401,
        json: authenticated
          ? { data: { me: user } }
          : { errors: [{ message: "Unauthorized" }] },
      });
    if (query.includes("FeedbackInvitation"))
      return route.fulfill({
        json: expired
          ? { errors: [{ message: "This invitation has expired" }] }
          : {
              data: {
                feedbackInvitation: {
                  recipientId: "recipient",
                  recipientUsername: "Recipient",
                  assignedReviewer: null,
                  approvalRequired: false,
                  sport,
                  match: null,
                  matches: [],
                },
              },
            },
      });
    if (query.includes("mutation"))
      return route.fulfill({
        json: {
          data: {
            submitGuestFeedback: { id: "saved" },
            submitFeedback: { id: "saved" },
          },
        },
      });
    return route.fulfill({
      json: {
        data: {
          sports: [sport],
          userMatches: [],
          receivedFeedback: [],
          submittedFeedback: [],
          match: {
            id: matchId,
            createdById: "reviewer",
            sportId: "sport",
            playedAt: "2026-11-15",
            status: "COMPLETED",
            createdAt: "2026-11-15",
            teams: [],
            participants: [],
            feedback: [],
          },
        },
      },
    });
  });
  const query = new URLSearchParams(returnTo ? { returnTo } : {}).toString();
  await page.goto(`/f/${"c".repeat(64)}${query ? `?${query}` : ""}`);
  await expect(page.getByRole("link", { name: "BVBTips home" })).toBeVisible();
  if (!expired)
    await expect(
      page.getByRole("radiogroup", { name: "Attacking rating" }),
    ).toBeVisible();
}

test("direct guest and unsafe-return invitations exit to the public homepage without a warning when clean", async ({
  page,
}) => {
  await openReview(page, { returnTo: "https://evil.example" });
  await expect(
    page.getByRole("link", { name: "BVBTips home" }),
  ).toHaveAttribute("href", "/");
  await expect(
    page.getByRole("link", { name: "Back from feedback" }),
  ).toHaveAttribute("href", "/");
  await page.getByRole("button", { name: "Card Review", exact: true }).click();
  await page.getByRole("button", { name: "Quick Review", exact: true }).click();
  await page.getByRole("link", { name: "Back from feedback" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const returnTo of ["/feedback", "/matches", `/matches/${matchId}`]) {
  test(`Back returns an authenticated reviewer to ${returnTo} after confirmation`, async ({
    page,
  }) => {
    await openReview(page, { authenticated: true, returnTo });
    await expect(
      page.getByRole("link", { name: "BVBTips home" }),
    ).toHaveAttribute("href", "/matches");
    await page.getByRole("radio", { name: "Defense: 4 out of 5" }).click();
    const back = page.getByRole("link", { name: "Back from feedback" });
    await back.click();
    await expect(
      page.getByRole("dialog", { name: "Leave feedback?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Keep reviewing" }).click();
    await expect(back).toBeFocused();
    await expect(
      page.getByRole("radio", { name: "Defense: 4 out of 5" }),
    ).toBeChecked();
    await back.click();
    await page.getByRole("button", { name: "Leave without saving" }).click();
    await expect(page).toHaveURL(new RegExp(`${returnTo}$`));
  });
}

test("logo guards unsaved comments and native refresh warns about a guest name", async ({
  page,
}) => {
  await openReview(page);
  await page.getByLabel("Guest name").fill("Guest draft");
  await page.getByRole("button", { name: "Defense", exact: true }).click();
  await page.getByLabel("Defense comment").fill("Keep this feedback");
  await page.getByRole("link", { name: "BVBTips home" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Keep reviewing" }).click();
  await expect(page.getByLabel("Defense comment")).toHaveValue(
    "Keep this feedback",
  );
  const warning = page.waitForEvent("dialog");
  const reload = page.reload().catch(() => null);
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
  await reload;
  await expect(page.getByLabel("Guest name")).toHaveValue("");
});

test("successful guest feedback has a public return action with no exit warning", async ({
  page,
}) => {
  await openReview(page);
  await page.getByRole("radio", { name: "Passing: 5 out of 5" }).click();
  await page
    .getByRole("button", { name: "Review & Submit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit Feedback", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Thanks for your feedback." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to BVBTips" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("expired invitations retain safe exit navigation", async ({ page }) => {
  await openReview(page, { expired: true });
  await expect(page.getByText("This invitation has expired")).toBeVisible();
  await page.getByRole("link", { name: "BVBTips home" }).click();
  await expect(page).toHaveURL(/\/$/);
});
