import { setPeerRating } from "./rating-helpers";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
for (const combined of [false, true]) {
  test(`same-device ${combined ? "combined" : "individual"} match request queues all selected matches for the assigned giver`, async ({
    browser,
    baseURL,
  }, info) => {
    test.skip(
      process.env.MULTI_MATCH_E2E !== "true",
      "Requires isolated migrated and seeded database",
    );
    test.setTimeout(90000);
    const owner = await browser.newContext({
      baseURL,
      viewport: info.project.use.viewport,
    });
    const giver = await browser.newContext({
      baseURL,
      viewport: info.project.use.viewport,
    });
    async function gql(
      api: APIRequestContext,
      query: string,
      variables: object = {},
    ) {
      const response = await api.post("/api/graphql", {
        headers: { origin: baseURL! },
        data: { query, variables },
      });
      const body = await response.json();
      expect(body.errors).toBeUndefined();
      return body.data;
    }
    try {
      const sport = (
        await gql(owner.request, "query{sports{id slug skills{id}}}")
      ).sports.find((s: { slug: string }) => s.slug === "beach-volleyball");
      async function register(api: APIRequestContext, prefix: string) {
        const username = prefix + randomUUID().slice(0, 8);
        return (
          await gql(
            api,
            "mutation($input:RegisterInput!){register(input:$input){accessToken user{id username}}}",
            {
              input: {
                username,
                email: `${username}@example.test`,
                password: "multi-device-browser-long-password",
                age: 25,
                heightCm: 180,
                sportId: sport.id,
                overallLevel: "B",
                ratings: sport.skills.map((s: { id: string }) => ({
                  skillId: s.id,
                  rating: 3,
                })),
              },
            },
          )
        ).register.user;
      }
      const recipient = await register(owner.request, "recipient");
      const assigned = await register(giver.request, "giver");
      const ids: string[] = [];
      const titles: string[] = [];
      for (let i = 0; i < 2; i++) {
        const description = `Device game ${i + 1} ${randomUUID().slice(0, 6)}`;
        titles.push(description);
        ids.push(
          (
            await gql(
              owner.request,
              "mutation($input:CreateMatchInput!){createMatch(input:$input){id}}",
              {
                input: {
                  sportId: sport.id,
                  description,
                  playedAt: new Date(
                    Date.now() - (i + 1) * 86400000,
                  ).toISOString(),
                  teams: [
                    { score: 21, memberIds: [recipient.id] },
                    { score: 17, guestNames: ["Opponent"] },
                  ],
                },
              },
            )
          ).createMatch.id,
        );
      }
      const page = await owner.newPage();
      await page.goto("/account");
      await page
        .getByRole("button", { name: "Create a feedback link", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      const noOverflow = async () =>
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      await dialog
        .getByRole("button", { name: "Selected matches", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", {
          name: "Review each match separately",
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        dialog.getByRole("button", {
          name: "Review on this device",
          exact: true,
        }),
      ).toBeDisabled();
      for (const title of titles)
        await dialog.getByRole("checkbox", { name: new RegExp(title) }).check();
      await dialog.getByLabel(/Assign feedback giver/).fill(assigned.username);
      await dialog
        .getByRole("button", { name: assigned.username, exact: true })
        .click();
      if (combined)
        await dialog
          .getByRole("button", {
            name: "One review for all matches",
            exact: true,
          })
          .click();
      await expect(
        dialog.getByText(`2 selected · ${combined ? 5 : 10} skill steps`, {
          exact: true,
        }),
      ).toBeVisible();
      await noOverflow();
      await page.screenshot({
        path: `/tmp/vbapp-multi-request-${combined ? "combined" : "individual"}-${info.project.name}.png`,
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: "Review on this device", exact: true })
        .click();
      await expect(page).toHaveURL(
        /\/f\/[a-f0-9]{64}\?mode=device&returnTo=%2Faccount$/,
      );
      await expect(
        page.getByLabel("Guest name (optional)", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", {
          name: combined
            ? "Reviewing 2 matches together"
            : "Reviewing Match 1 of 2",
          exact: true,
        }),
      ).toBeVisible();
      await noOverflow();
      await page
        .getByRole("button", { name: "Card Review", exact: true })
        .click();
      const rounds = combined ? 1 : 2;
      for (let i = 0; i < rounds; i++) {
        await setPeerRating(page, "Attacking", i ? 2 : 4);
        if (!combined)
          await page
            .getByLabel("Written feedback for this match (optional)", {
              exact: true,
            })
            .fill(`Notes for match ${i + 1}`);
        for (let skill = 0; skill < 5; skill++)
          await page
            .getByRole("button", {
              name: skill === 0 ? "Next" : "Skip",
              exact: true,
            })
            .click();
      }
      await expect(
        page.getByRole("heading", { name: "Review feedback", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Submit Feedback", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Thanks for your feedback.",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        (await gql(owner.request, "query{receivedFeedback{id}}"))
          .receivedFeedback,
      ).toHaveLength(0);
      const pending = (
        await gql(
          giver.request,
          "query{myPendingFeedbackApprovals{totalCount items{id match{id} matches{id}}}}",
        )
      ).myPendingFeedbackApprovals;
      expect(pending.totalCount).toBe(combined ? 1 : 2);
      expect(
        new Set(
          pending.items.flatMap((row: { matches: { id: string }[] }) =>
            row.matches.map((m) => m.id),
          ),
        ),
      ).toEqual(new Set(ids));
      const reviewerPage = await giver.newPage();
      await reviewerPage.goto("/approvals");
      const queue = reviewerPage.getByRole("region", {
        name: "Feedback approvals",
        exact: true,
      });
      await expect(
        queue.getByText(
          `${combined ? "1 pending review" : "2 pending reviews"} · Newest first`,
          { exact: true },
        ),
      ).toBeVisible();
      expect(
        await reviewerPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await queue.locator("article summary").first().click();
      if (combined) {
        await expect(
          queue.getByRole("heading", {
            name: "Combined feedback · 2 matches",
            exact: true,
          }),
        ).toBeVisible();
        for (const title of titles)
          await expect(queue.getByText(new RegExp(title))).toBeVisible();
      }
      await queue
        .getByRole("checkbox", { name: /I’ve reviewed every/ })
        .check();
      await queue.getByRole("button", { name: "Approve", exact: true }).click();
      if (!combined) {
        await expect(
          queue.getByText("1 pending review · Newest first", { exact: true }),
        ).toBeVisible();
        await queue.locator("article summary").click();
        await queue
          .getByRole("button", { name: "Reject", exact: true })
          .click();
        await queue
          .getByRole("button", { name: "Confirm rejection", exact: true })
          .click();
      }
      await expect(
        queue.getByText("You’re all caught up!", { exact: true }),
      ).toBeVisible();
      const published = (
        await gql(
          owner.request,
          "query{receivedFeedback{id matchId matches{id}}}",
        )
      ).receivedFeedback;
      expect(published).toHaveLength(1);
      if (combined) {
        expect(published[0].matches).toHaveLength(2);
        for (const id of ids) {
          await page.goto(`/matches/${id}`);
          await expect(
            page.getByText("Combined feedback · 2 matches", { exact: true }),
          ).toBeVisible();
        }
        await page.goto("/feedback");
        await expect(page.getByRole("article")).toHaveCount(1);
        await expect(
          page.getByText("Combined feedback · 2 matches", { exact: true }),
        ).toBeVisible();
      }
    } finally {
      await owner.close();
      await giver.close();
    }
  });
}
