import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("shows current five-skill radar profiles without snapshot controls", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.RADAR_E2E !== "true",
    "Requires an isolated migrated and seeded test database",
  );
  const owner = await browser.newContext({
      baseURL,
      viewport: testInfo.project.use.viewport,
    }),
    reviewer = await browser.newContext({ baseURL });
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
    return body.data;
  }
  try {
    const sport = (
      await gql(owner.request, "query{sports{id slug skills{id name}}}")
    ).sports.find((s: { slug: string }) => s.slug === "beach-volleyball");
    async function register(request: APIRequestContext, rating: number) {
      const name = randomUUID();
      return (
        await gql(
          request,
          "mutation($input:RegisterInput!){register(input:$input){accessToken user{id}}}",
          {
            input: {
              username: name,
              email: `${name}@example.test`,
              password: "radar-test-long-password",
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
    }
    const recipient = await register(owner.request, 3);
    await register(reviewer.request, 5);
    for (let index = 0; index < 3; index++) {
      await gql(
        owner.request,
        "mutation($input:CreateMatchInput!){createMatch(input:$input){id}}",
        {
          input: {
            sportId: sport.id,
            status: "COMPLETED",
            playedAt: new Date(
              Date.now() - (index + 1) * 86400000,
            ).toISOString(),
            teams: [
              { score: index < 2 ? 21 : 15, memberIds: [recipient.id] },
              { score: index < 2 ? 18 : 21, guestNames: ["Opponent"] },
            ],
          },
        },
      );
    }
    const passing = sport.skills.find(
      (s: { name: string }) => s.name === "Passing",
    );
    await gql(
      reviewer.request,
      "mutation($input:SubmitFeedbackInput!){submitFeedback(input:$input){id}}",
      {
        input: {
          recipientId: recipient.id,
          sportId: sport.id,
          ratings: [{ skillId: passing.id, rating: 4 }],
        },
      },
    );
    const assessment = (
      await gql(owner.request, "query{mySelfAssessments{id}}")
    ).mySelfAssessments[0];
    await gql(
      owner.request,
      "mutation($input:UpdateSelfAssessmentRatingsInput!){updateSelfAssessmentRatings(input:$input){id}}",
      {
        input: {
          id: assessment.id,
          ratings: [{ skillId: passing.id, rating: 2 }],
        },
      },
    );
    const page = await owner.newPage();
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "Your account" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Self-assessment", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Internal rating", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.goto("/analytics");
    const profile = page.getByRole("region", {
      name: "Performance profile",
      exact: true,
    });
    await expect(
      page.getByRole("heading", { name: "MY PERFORMANCE PROFILE" }),
    ).toBeVisible();
    await expect(profile.getByText("66.7%", { exact: true })).toBeVisible();
    await expect(profile.getByText("2W", { exact: true })).toBeVisible();
    await expect(
      profile.getByRole("switch", { name: "Self-assessment ratings" }),
    ).not.toBeChecked();
    await expect(
      profile.getByRole("button", { name: /Passing.*3.01666667/ }),
    ).toBeVisible();
    await expect(
      profile.getByRole("checkbox", {
        name: "Compare internal and self ratings",
      }),
    ).toHaveCount(0);
    await profile.getByRole("switch").click();
    await expect(
      profile.getByRole("button", { name: /Passing: 2 out of 5/ }),
    ).toBeVisible();
    await expect(profile.locator('input[type="date"]')).toHaveCount(0);
    await expect(
      profile.getByRole("button", { name: "Current ratings", exact: true }),
    ).toHaveCount(0);
    await expect(
      profile.getByRole("group", { name: "Profile snapshot shortcuts" }),
    ).toHaveCount(0);
    await profile.getByRole("switch").click();
    await expect(
      profile.getByRole("button", { name: /Passing.*3.01666667/ }),
    ).toBeVisible();
    const labels = await profile
      .locator(".recharts-polar-angle-axis-tick-value")
      .allTextContents();
    expect(labels).toEqual([
      "Passing",
      "Setting",
      "Attack",
      "Serving",
      "Defense",
    ]);
    const labelsFit = await profile
      .locator(".recharts-polar-angle-axis-tick-value")
      .evaluateAll((nodes) =>
        nodes.every((node) => {
          const text = node.getBoundingClientRect(),
            svg = node.closest("svg")!.getBoundingClientRect();
          return (
            text.left >= svg.left - 1 &&
            text.right <= svg.right + 1 &&
            text.top >= svg.top - 1 &&
            text.bottom <= svg.bottom + 1
          );
        }),
      );
    expect(labelsFit).toBe(true);
    const cardsClear = await profile.evaluate((root) => {
      const targets = [
        ...root.querySelectorAll(
          ".recharts-polar-angle-axis-tick-value, .recharts-polar-grid-concentric-polygon",
        ),
      ].map((node) => node.getBoundingClientRect());
      return [...root.querySelectorAll(".skill-rating-card")].every((node) => {
        const card = node.getBoundingClientRect();
        return targets.every(
          (target) =>
            card.right <= target.left ||
            card.left >= target.right ||
            card.bottom <= target.top ||
            card.top >= target.bottom,
        );
      });
    });
    expect(cardsClear).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      fullPage: true,
      path: `/tmp/vbapp-beach-performance-${testInfo.project.name}.png`,
    });
  } finally {
    await owner.close().catch(() => {});
    await reviewer.close().catch(() => {});
  }
});
