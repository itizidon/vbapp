import { test, expect } from "@playwright/test";
const user = "11111111-1111-4111-8111-111111111111",
  sport = "22222222-2222-4222-8222-222222222222",
  skill = "33333333-3333-4333-8333-333333333333",
  conversation = "44444444-4444-4444-8444-444444444444",
  feedback = "55555555-5555-4555-8555-555555555555";
test("AI coach is usable on mobile and desktop with verified references and general advice", async ({
  page,
}) => {
  let saved = false;
  let question = "";
  const message = () => ({
    id: "66666666-6666-4666-8666-666666666666",
    conversationId: conversation,
    question,
    startedAt: "2026-11-16T12:00:00Z",
    status: "COMPLETED",
    model: "gpt-6.1-sol",
    promptVersion: "bvbtips-coach-v2",
    inputTokens: 100,
    outputTokens: 50,
    response: {
      message:
        "Passing has an average peer rating of 3.00 / 5 across 6 eligible reviews.",
      status: "ANSWERED",
      insufficientEvidence: false,
      generalSuggestions: ["Keep a steady platform and aim at a target."],
      recommendedDrillIds: [],
      evidence: [
        {
          factId: "known",
          claim: "Verified platform feedback.",
          supportingReviewCount: 1,
          feedbackIds: [feedback],
          metricKey: null,
        },
      ],
    },
  });
  await page.route("**/api/graphql", async (route) => {
    const { query: q, variables: v } = route.request().postDataJSON();
    let data: object = {};
    if (q.includes("query Me "))
      data = {
        me: {
          id: user,
          username: "Alex",
          email: "alex@example.test",
          createdAt: "2026-11-01",
          isPublic: false,
        },
      };
    else if (q.includes("query Catalog"))
      data = {
        sports: [
          {
            id: sport,
            name: "Beach Volleyball",
            slug: "beach-volleyball",
            skills: [
              {
                id: skill,
                sportId: sport,
                name: "Passing",
                slug: "passing",
                active: true,
                requiredForSelfAssessment: true,
              },
            ],
          },
        ],
      };
    else if (q.includes("query CoachProfile"))
      data = {
        myFeedbackAnalysisProfile: {
          state: "READY",
          rebuildQueued: false,
          profile: {
            totalEligibleFeedbackCount: 6,
            verifiedFeedbackCount: 2,
            guestFeedbackCount: 3,
            awaitingReviewerApprovalCount: 1,
            evidenceStatus: "SUFFICIENT",
            state: "COMPLETE",
          },
        },
      };
    else if (q.includes("query CoachConversations"))
      data = {
        myAiCoachConversations: saved
          ? [
              {
                id: conversation,
                title: question,
                updatedAt: "2026-11-16T12:00:00Z",
              },
            ]
          : [],
      };
    else if (q.includes("query CoachMessages"))
      data = {
        myAiCoachMessages: {
          messages: saved ? [message()] : [],
          nextCursor: null,
        },
      };
    else if (q.includes("mutation AskAiCoach")) {
      question = v.input.question;
      await new Promise((r) => setTimeout(r, 350));
      saved = true;
      data = { askAiCoach: message() };
    } else if (q.includes("query MyAnalytics"))
      data = {
        myAnalytics: {
          categories: [],
          points: [],
          wins: 0,
          losses: 0,
          ratingCount: 0,
          from: v.from,
          before: v.before,
          timeZone: v.timeZone,
        },
      };
    else if (q.includes("query MyPerformanceSummary"))
      data = {
        myPerformanceSummary: {
          winRate: null,
          currentStreak: 0,
          streakKind: "NONE",
          gamesPlayed: 0,
          averagePlayerRating: null,
          ratedSkillCount: 0,
        },
      };
    else if (q.includes("query SkillRadarProfile"))
      data = {
        skillRadarProfile: {
          asOf: "2026-11-16T12:00:00Z",
          skills: [
            {
              skillId: skill,
              skillName: "Passing",
              skillSlug: "passing",
              selfRating: 3,
              internalRating: 3,
              averageFeedbackRating: 3,
              feedbackCount: 6,
            },
          ],
        },
      };
    await route.fulfill({ json: { data } });
  });
  await page.goto("/analytics");
  const coach = page.getByRole("region", { name: "AI Coach", exact: true });
  await expect(
    coach.getByRole("heading", { name: "AI Coach", exact: true }),
  ).toBeVisible();
  await expect(coach.getByText(/Evidence: 2 verified approved/)).toBeVisible();
  await expect(coach.getByText(/1 awaiting reviewer approval/)).toBeVisible();
  await coach
    .getByRole("button", { name: "What are my biggest weaknesses?" })
    .click();
  await expect(coach.getByRole("textbox")).toHaveValue(
    "What are my biggest weaknesses?",
  );
  await coach.getByRole("button", { name: "Send", exact: true }).click();
  await expect(coach.getByText("Checking your feedback…")).toBeVisible();
  await expect(
    coach.getByText(
      "Passing has an average peer rating of 3.00 / 5 across 6 eligible reviews.",
    ),
  ).toBeVisible();
  await expect(
    coach.getByRole("heading", { name: "General practice suggestions" }),
  ).toBeVisible();
  await coach.getByText("Feedback evidence (1)").click();
  await expect(
    coach.getByRole("link", { name: "View supporting feedback" }),
  ).toHaveAttribute("href", "/feedback/" + feedback);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await coach.getByRole("button", { name: "New conversation" }).click();
  await expect(
    coach.getByText("What would help your game today?"),
  ).toBeVisible();
});
