import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("assigned invitation stays pending until reviewer approves or rejects on Account", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    process.env.APPROVALS_E2E !== "true",
    "Requires isolated migrated test database",
  );
  const owner = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
  });
  const reviewer = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
  });
  const other = await browser.newContext({ baseURL });
  const guest = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
  });
  async function request(
    api: APIRequestContext,
    query: string,
    variables: object = {},
  ) {
    return (
      await api.post("/api/graphql", {
        headers: { origin: baseURL! },
        data: { query, variables },
      })
    ).json();
  }
  async function gql(
    api: APIRequestContext,
    query: string,
    variables: object = {},
  ) {
    const response = await request(api, query, variables);
    expect(response.errors).toBeUndefined();
    return response.data;
  }
  try {
    const sport = (
      await gql(owner.request, "query{sports{id slug skills{id name}}}")
    ).sports.find((s: { slug: string }) => s.slug === "beach-volleyball");
    async function register(
      api: APIRequestContext,
      prefix: string,
      rating: number,
    ) {
      const username = prefix + randomUUID().slice(0, 8);
      return (
        await gql(
          api,
          "mutation($input:RegisterInput!){register(input:$input){accessToken user{id username}}}",
          {
            input: {
              username,
              email: `${username}@example.test`,
              password: "approval-browser-test-long-password",
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
    const recipient = await register(owner.request, "recipient", 3);
    const assigned = await register(reviewer.request, "reviewer", 5);
    await register(other.request, "preparer", 2);
    const page = await owner.newPage();
    await page.goto("/account");
    await page
      .getByRole("button", { name: "Create a feedback link", exact: true })
      .click();
    await page.getByLabel(/Assign feedback giver/).fill(assigned.username);
    await page
      .getByRole("button", { name: assigned.username, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create feedback link", exact: true })
      .click();
    const link = await page
      .getByLabel("Feedback link", { exact: true })
      .inputValue();
    expect(link).toMatch(/\/f\/[a-f0-9]{64}$/);
    const guestPage = await guest.newPage();
    await guestPage.goto(link);
    await expect(
      guestPage.getByText(`@${assigned.username}`, { exact: true }),
    ).toBeVisible();
    await guestPage
      .getByLabel("Your name", { exact: true })
      .fill("Court observer");
    const artwork = guestPage.locator(".feedback-art-image");
    await expect(artwork).toBeVisible();
    await expect
      .poll(() =>
        artwork.evaluate((node) => {
          const img = node as HTMLImageElement;
          return img.complete && img.naturalWidth > 0;
        }),
      )
      .toBe(true);
    expect(
      await guestPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await guestPage.screenshot({
      fullPage: true,
      animations: "disabled",
      path: `/tmp/vbapp-feedback-cards-${info.project.name}.png`,
    });
    for (let i = 0; i < 2; i++)
      await guestPage
        .getByRole("button", { name: "Next", exact: true })
        .click();
    await guestPage
      .getByRole("radio", { name: "Passing: 5 out of 5", exact: true })
      .click();
    for (let i = 2; i < 5; i++)
      await guestPage
        .getByRole("button", { name: /^(Next|Review Feedback)$/ })
        .click();
    await expect(
      guestPage.getByRole("heading", { name: "Review feedback", exact: true }),
    ).toBeVisible();
    await guestPage.screenshot({
      fullPage: true,
      animations: "disabled",
      path: `/tmp/vbapp-feedback-review-${info.project.name}.png`,
    });
    await guestPage
      .getByLabel("Written feedback")
      .fill("First draft prepared by guest");
    await guestPage
      .getByRole("button", { name: "Submit Feedback", exact: true })
      .click();
    await expect(guestPage.getByText(/Your draft is awaiting/)).toBeVisible();
    const pending = (
      await gql(
        reviewer.request,
        "query{myPendingFeedbackApprovals{totalCount items{id}}}",
      )
    ).myPendingFeedbackApprovals;
    expect(pending.totalCount).toBe(1);
    const first = pending.items[0].id;
    expect(
      (await gql(owner.request, "query{receivedFeedback{id}}"))
        .receivedFeedback,
    ).toHaveLength(0);
    expect(
      (
        await request(
          owner.request,
          "mutation($id:ID!){approveFeedback(feedbackId:$id){id}}",
          { id: first },
        )
      ).errors,
    ).toBeTruthy();
    expect(
      (
        await request(
          guest.request,
          "mutation($id:ID!){approveFeedback(feedbackId:$id){id}}",
          { id: first },
        )
      ).errors,
    ).toBeTruthy();
    const otherPage = await other.newPage();
    await otherPage.goto(link);
    await otherPage
      .getByRole("radiogroup", { name: "Attacking rating" })
      .waitFor();
    for (let i = 0; i < 4; i++)
      await otherPage
        .getByRole("button", { name: "Next", exact: true })
        .click();
    await otherPage
      .getByRole("radio", { name: "Serving: 3 out of 5", exact: true })
      .click();
    await otherPage
      .getByRole("button", { name: "Review Feedback", exact: true })
      .click();
    await otherPage
      .getByLabel("Written feedback")
      .fill("Second draft prepared while signed in");
    await otherPage
      .getByRole("button", { name: "Submit Feedback", exact: true })
      .click();
    await expect(otherPage.getByText(/Your draft is awaiting/)).toBeVisible();
    const reviewPage = await reviewer.newPage();
    await reviewPage.goto("/account");
    const queue = reviewPage.getByRole("region", {
      name: "Pending Feedback Approvals",
      exact: true,
    });
    await expect(queue.getByText("2 pending", { exact: true })).toBeVisible();
    await expect(
      queue.getByText("First draft prepared by guest", { exact: true }),
    ).toBeVisible();
    await expect(queue.locator("article")).toHaveCount(1);
    expect(
      await reviewPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await queue.screenshot({
      path: `/tmp/vbapp-feedback-approvals-${info.project.name}.png`,
    });
    await queue
      .getByRole("button", { name: "Approve Feedback", exact: true })
      .click();
    await expect(
      queue.getByText("Second draft prepared while signed in", { exact: true }),
    ).toBeVisible();
    await expect(queue.getByText("1 pending", { exact: true })).toBeVisible();
    const published = (
      await gql(
        owner.request,
        "query{receivedFeedback{id reviewerId reviewerUsername status}}",
      )
    ).receivedFeedback;
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      id: first,
      reviewerId: assigned.id,
      reviewerUsername: assigned.username,
      status: "PUBLISHED",
    });
    const ratings = (
      await gql(
        owner.request,
        "query($u:ID!,$s:ID!){internalRatings(userId:$u,sportId:$s){skillId currentRating}}",
        { u: recipient.id, s: sport.id },
      )
    ).internalRatings;
    const passing = sport.skills.find(
      (s: { name: string }) => s.name === "Passing",
    );
    expect(
      ratings.find((r: { skillId: string }) => r.skillId === passing.id)
        .currentRating,
    ).toBeGreaterThan(3);
    await queue.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(
      queue.getByText("You're all caught up!", { exact: true }),
    ).toBeVisible();
    expect(
      (await gql(owner.request, "query{receivedFeedback{id}}"))
        .receivedFeedback,
    ).toHaveLength(1);
    const again = await gql(
      reviewer.request,
      "mutation($id:ID!){approveFeedback(feedbackId:$id){id status}}",
      { id: first },
    );
    expect(again.approveFeedback.status).toBe("PUBLISHED");
  } finally {
    await Promise.all(
      [owner, reviewer, other, guest].map((context) => context.close()),
    );
  }
});
