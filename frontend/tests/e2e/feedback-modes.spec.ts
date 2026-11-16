import { test, expect } from "@playwright/test";

for (const combined of [false, true]) {
  test(`quick and card modes preserve ${combined ? "combined" : "individual"} match reviews`, async ({
    page,
  }, info) => {
    const skills = ["Attack", "Defense", "Passing", "Setting", "Serving"].map(
      (name) => ({
        id: name.toLowerCase(),
        name,
        slug: name.toLowerCase(),
        sportId: "beach",
        active: true,
        description: `${name} description.`,
        requiredForSelfAssessment: false,
      }),
    );
    const matches = [1, 2].map((number) => ({
      id: `match-${number}`,
      playedAt: `2026-11-${10 + number}T12:00:00Z`,
      teams: [
        { teamNumber: 1, score: 21, players: ["Recipient", "Sam"] },
        { teamNumber: 2, score: 17, players: ["Opponent"] },
      ],
      unassignedPlayers: [],
    }));
    const submissions: {
      reviews: {
        matchId: string | null;
        ratings: { skillId: string; rating: number; comment?: string }[];
      }[];
      asGuest: boolean;
      submissionId: string;
      guestName?: string;
      assignedReviewerId?: string;
    }[] = [];
    await page.route("**/api/graphql", async (route) => {
      const { query, variables } = route.request().postDataJSON();
      if (query.includes("StartGuestReviewSession"))
        return route.fulfill({
          json: {
            data: {
              startGuestReviewSession: {
                token: "follow-up-token",
                expiresAt: "2026-11-17T12:00:00Z",
              },
            },
          },
        });
      if (query.includes("FeedbackInvitation"))
        return route.fulfill({
          json: {
            data: {
              feedbackInvitation: {
                recipientId: "recipient",
                recipientUsername: "Recipient",
                guestSession: variables.token === "follow-up-token",
                assignedReviewer:
                  variables.token === "follow-up-token"
                    ? null
                    : { id: "giver", username: "Giver" },
                approvalRequired: variables.token !== "follow-up-token",
                sport: {
                  id: "beach",
                  name: "Beach Volleyball",
                  slug: "beach-volleyball",
                  skills,
                },
                matches,
                match: null,
                reviewMode: combined
                  ? "COMBINED_MATCHES"
                  : "INDIVIDUAL_MATCHES",
              },
            },
          },
        });
      if (query.includes("SubmitFeedbackRequest")) {
        submissions.push(variables.input);
        return route.fulfill({
          json: { data: { submitFeedbackRequest: { id: "receipt" } } },
        });
      }
      return route.fulfill({ json: { data: {} } });
    });
    await page.goto(`/f/${"a".repeat(64)}?mode=device`);
    await expect(
      page.getByRole("button", { name: "Quick Review", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("radiogroup")).toHaveCount(5);
    await expect(page.locator(".feedback-art-image")).toHaveCount(0);
    await expect(
      page.getByLabel("Guest name (optional)", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: "Attacking: 5 out of 5" }).click();
    const defense = page.getByRole("button", { name: /^Defense/ });
    await defense.click();
    await expect(defense).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("radio", { name: "Defense: 3 out of 5" }).click();
    await page.getByLabel("Defense comment").fill("Good coverage");
    await defense.click();
    await expect(page.getByLabel("Defense comment")).not.toBeVisible();
    await expect(page.getByLabel("Comment added")).toBeVisible();
    await page
      .getByRole("button", { name: "Card Review", exact: true })
      .click();
    await expect(
      page.getByRole("radio", { name: "Attacking: 5 out of 5" }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByLabel("Add a comment")).toHaveValue("Good coverage");
    await page.getByRole("radio", { name: "Defense: 4 out of 5" }).click();
    await page
      .getByRole("button", { name: "Quick Review", exact: true })
      .click();
    await expect(
      page.getByRole("radio", { name: "Defense: 4 out of 5" }),
    ).toBeChecked();
    if (!combined) {
      await page
        .getByRole("button", { name: "Next match", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Reviewing Match 2 of 2" }),
      ).toBeVisible();
      await expect(
        page.getByRole("radio", { name: "Attacking: 5 out of 5" }),
      ).not.toBeChecked();
      await page.getByRole("radio", { name: "Serving: 2 out of 5" }).click();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/vbapp-feedback-modes-${combined ? "combined" : "individual"}-${info.project.name}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Review & Submit", exact: true })
      .click();
    await expect(page.getByRole("article")).toHaveCount(combined ? 5 : 10);
    await expect(
      page.getByText("Good coverage", { exact: true }),
    ).toBeVisible();
    expect(submissions).toHaveLength(0);
    await page
      .getByRole("button", { name: "Submit Feedback", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Thanks for your feedback." }),
    ).toBeVisible();
    expect(submissions).toHaveLength(1);
    expect(submissions[0].asGuest).toBe(true);
    expect(submissions[0].reviews).toHaveLength(combined ? 1 : 2);
    expect(submissions[0].reviews[0]).toMatchObject({
      matchId: combined ? null : "match-1",
      ratings: [
        { skillId: "attack", rating: 5 },
        { skillId: "defense", rating: 4, comment: "Good coverage" },
      ],
    });
    if (!combined)
      expect(submissions[0].reviews[1].ratings).toEqual([
        { skillId: "serving", rating: 2 },
      ]);
    expect(
      submissions[0].reviews
        .flatMap((review) => review.ratings)
        .every((answer) => answer.rating > 0),
    ).toBe(true);
    const originalId = submissions[0].submissionId;
    await page
      .getByRole("button", { name: "Leave Another Review", exact: true })
      .click();
    await expect(
      page.getByText("New guest review · Your own independent feedback", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Guest", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Registered User", exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel("Guest name")).toHaveValue("");
    await expect(page.getByText("Not rated yet", { exact: true })).toHaveCount(
      5,
    );
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Card Review", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: "Attacking feedback card" }),
    ).toBeVisible();
    await expect(page.getByLabel("Add a comment")).toHaveValue("");
    await page
      .getByRole("button", { name: "Quick Review", exact: true })
      .click();
    await page.getByLabel("Guest name").fill("New guest");
    for (let index = 0; index < (combined ? 1 : 2); index++) {
      await expect(
        page.getByRole("radio", { name: "Attacking: 5 out of 5" }),
      ).not.toBeChecked();
      if (!combined)
        await expect(
          page.getByLabel("Written feedback for this match"),
        ).toHaveValue("");
      await page.getByRole("radio", { name: "Serving: 3 out of 5" }).click();
      await page
        .getByRole("button", {
          name: !combined && index === 0 ? "Next match" : "Review & Submit",
          exact: true,
        })
        .click();
    }
    await page
      .getByRole("button", { name: "Submit Feedback", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Thanks for your feedback." }),
    ).toBeVisible();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toMatchObject({
      asGuest: true,
      guestName: "New guest",
    });
    expect(submissions[1]).not.toHaveProperty("assignedReviewerId");
    expect(submissions[1].submissionId).not.toBe(originalId);
    expect(submissions[1].reviews).toHaveLength(combined ? 1 : 2);
    expect(
      submissions[1].reviews.every(
        (review) =>
          review.ratings.length === 1 &&
          review.ratings[0].skillId === "serving",
      ),
    ).toBe(true);
    await page.reload();
    await expect(page.getByText("@Giver", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Guest", exact: true }),
    ).toBeDisabled();
    await expect(page.getByText("Not rated yet", { exact: true })).toHaveCount(
      5,
    );
    expect(submissions).toHaveLength(2);
  });
}
