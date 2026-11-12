import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Opt in only against a disposable/migrated database; this test creates accounts.
test("graphs internal and independent self-rating history", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.INTERNAL_RATINGS_E2E !== "true",
    "Requires a disposable rating-system test database",
  );
  const recipient = await browser.newContext({
    baseURL,
    viewport: testInfo.project.use.viewport,
  });
  const reviewer = await browser.newContext({
    baseURL,
    viewport: testInfo.project.use.viewport,
  });
  async function gql(
    request: APIRequestContext,
    query: string,
    variables: object = {},
  ) {
    const response = await request.post("/api/graphql", {
      headers: { origin: baseURL! },
      data: { query, variables },
    });
    const body = await response.json();
    expect(body.errors).toBeUndefined();
    expect(response.ok()).toBe(true);
    return body.data;
  }
  try {
    const catalog = await gql(
      recipient.request,
      "query {sports{id slug skills{id name active}}}",
    );
    const sport = catalog.sports.find(
      (s: { slug: string }) => s.slug === "beach-volleyball",
    );
    const skill = sport.skills.find(
      (s: { name: string }) => s.name === "Attack",
    );
    const register = async (request: APIRequestContext, rating: number) => {
      const name = randomUUID();
      return (
        await gql(
          request,
          "mutation Register($input:RegisterInput!){register(input:$input){accessToken user{id}}}",
          {
            input: {
              username: name,
              email: `${name}@example.test`,
              password: "test-only-long-password",
              age: 25,
              heightCm: 180,
              sportId: sport.id,
              overallLevel: "B",
              ratings: sport.skills.map((s: { id: string }) => ({
                skillId: s.id,
                rating,
              })),
            },
          },
        )
      ).register.user;
    };
    const target = await register(recipient.request, 3);
    await register(reviewer.request, 5);
    await gql(
      reviewer.request,
      "mutation Give($input:SubmitFeedbackInput!){submitFeedback(input:$input){id}}",
      {
        input: {
          recipientId: target.id,
          sportId: sport.id,
          ratings: [{ skillId: skill.id, rating: 5 }],
        },
      },
    );
    const profile = await gql(
      recipient.request,
      "query {mySelfAssessments{id}}",
    );
    await gql(
      recipient.request,
      "mutation Edit($input:UpdateSelfAssessmentRatingsInput!){updateSelfAssessmentRatings(input:$input){id}}",
      {
        input: {
          id: profile.mySelfAssessments[0].id,
          ratings: [{ skillId: skill.id, rating: 1 }],
        },
      },
    );
    const page = await recipient.newPage();
    await page.goto("/analytics");
    await page
      .getByRole("combobox", { name: "Chart metric", exact: true })
      .selectOption(skill.id);
    await page
      .getByRole("combobox", { name: "Chart mode", exact: true })
      .selectOption("internal");
    await expect(
      page.getByLabel("Internal rating history chart"),
    ).toBeVisible();
    await expect(
      page.getByText("Latest 3.0333 / 5", { exact: false }),
    ).toBeVisible();
    await page.getByText("View rating history", { exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "FEEDBACK APPLIED", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Chart mode", exact: true })
      .selectOption("self");
    await expect(
      page.getByLabel("Self-assessment history chart"),
    ).toBeVisible();
    await expect(
      page.getByText("Latest 1.0000 / 5", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Individual feedback" }),
    ).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Chart mode", exact: true })
      .selectOption("daily");
    await expect(
      page.getByRole("switch", { name: "Individual feedback" }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Chart mode", exact: true })
      .selectOption("internal");
    await page.setViewportSize({ width: 375, height: 900 });
    await expect(
      page.getByLabel("Internal rating history chart"),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await recipient.close().catch(() => {});
    await reviewer.close().catch(() => {});
  }
});
