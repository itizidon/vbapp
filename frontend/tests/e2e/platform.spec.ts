import type { Match } from "../../src/lib/types";
import { test, expect, type Page } from "@playwright/test";
const userId = "11111111-1111-4111-8111-111111111111",
  sportId = "22222222-2222-4222-8222-222222222222",
  skillId = "33333333-3333-4333-8333-333333333333",
  matchId = "44444444-4444-4444-8444-444444444444",
  feedbackId = "55555555-5555-4555-8555-555555555555",
  otherId = "66666666-6666-4666-8666-666666666666";
function token(scoped?: string) {
  return `header.${Buffer.from(JSON.stringify({ kind: "guest-feedback", recipientId: userId, sportId, matchId: scoped ?? null, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
}
const baseMatch: Match = {
  id: matchId,
  createdById: userId,
  sportId,
  playedAt: "2026-11-08T15:00:00Z",
  description: "Sunday beach session",
  status: "COMPLETED",
  createdAt: "2026-11-08",
  updatedAt: "2026-11-08",
  teams: [
    { id: "t1", matchId, name: "Sand", teamNumber: 1, score: 0 },
    { id: "t2", matchId, name: "Sea", teamNumber: 2, score: 21 },
  ],
  participants: [
    { id: "p1", matchId, userId, guestName: null, teamId: "t1" },
    { id: "p2", matchId, userId: otherId, guestName: null, teamId: "t2" },
  ],
};
const baseFeedback = {
  id: feedbackId,
  recipientId: userId,
  sportId,
  matchId: null,
  reviewerId: null,
  guestName: "Teammate",
  overallComment: "Great communication on court.",
  createdAt: "2026-11-08T15:00:00Z",
  status: "PUBLISHED",
  ratings: [{ skillId, rating: 4 }],
  analyticsAllowed: false,
  evidenceAllowed: false,
};
function store() {
  return {
    feedback: [
      baseFeedback,
      {
        ...baseFeedback,
        id: "77777777-7777-4777-8777-777777777777",
        matchId,
        overallComment: "Good reads during the match.",
      },
    ],
    matches: [baseMatch] as Match[],
    submissions: [] as Record<string, unknown>[],
    calls: [] as string[],
  };
}
async function api(
  page: Page,
  {
    guest = false,
    empty = false,
    failure = false,
    state = store(),
    authState,
  }: {
    guest?: boolean;
    empty?: boolean;
    failure?: boolean;
    state?: ReturnType<typeof store>;
    authState?: { loggedIn: boolean };
  } = {},
) {
  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON();
    const q = body.query ?? "";
    const vars = body.variables ?? {};
    state.calls.push(q);
    if (failure)
      return route.fulfill({
        status: 502,
        json: { errors: [{ message: "API unavailable" }] },
      });
    let data: object = {};
    if (q.includes("Catalog"))
      data = {
        sports: [
          {
            id: sportId,
            name: "Beach Volleyball",
            slug: "beach-volleyball",
            skills: [
              {
                id: skillId,
                sportId,
                name: "Passing",
                description:
                  "Control the first touch so your partner can play the next ball.",
                slug: "passing",
                active: true,
                requiredForSelfAssessment: true,
              },
            ],
          },
        ],
      };
    else if (q.includes("query MemberSearch"))
      data = { members: [{ id: otherId, username: "Taylor" }] };
    else if (q.includes("query Me")) {
      if (authState ? !authState.loggedIn : guest)
        return route.fulfill({
          status: 401,
          json: { errors: [{ message: "Unauthorized" }] },
        });
      data = {
        me: {
          id: userId,
          username: "Alex",
          email: "alex@example.test",
          createdAt: "2026-10-01",
        },
      };
    } else if (q.includes("query Matches"))
      data = { userMatches: empty ? [] : state.matches };
    else if (q.includes("query Match("))
      data = { match: state.matches.find((m) => m.id === vars.id) ?? null };
    else if (q.includes("Received"))
      data = { receivedFeedback: empty ? [] : state.feedback };
    else if (q.includes("Submitted")) data = { submittedFeedback: [] };
    else if (q.includes("FeedbackDetail"))
      data = { feedback: state.feedback.find((f) => f.id === vars.id) };
    else if (q.includes("Summary"))
      data = {
        userSkillRatings: [],
        userSportFeedbackSummary: [],
        mySelfAssessments: [],
      };
    else if (q.includes("mutation Invite"))
      data = {
        createGuestFeedbackInvite: {
          token: token(vars.matchId || undefined),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };
    else if (
      q.includes("GuestFeedback") ||
      q.includes("mutation SubmitFeedback")
    ) {
      state.submissions.push(vars.input);
      state.feedback.unshift({
        ...baseFeedback,
        id: crypto.randomUUID(),
        matchId: vars.input.matchId,
        ratings: vars.input.ratings,
        overallComment: vars.input.overallComment,
        guestName: vars.input.guestName ?? null,
      });
      data = q.includes("GuestFeedback")
        ? { submitGuestFeedback: { id: "new" } }
        : { submitFeedback: { id: "new" } };
    } else if (q.includes("mutation CreateMatch")) {
      const id = "88888888-8888-4888-8888-888888888888";
      const teams = (vars.input.teams ?? []).map(
        (team: { name: string }, index: number) => ({
          id: `created-team-${index}`,
          matchId: id,
          teamNumber: index + 1,
          name: team.name,
          score: null,
        }),
      );
      function roster(
        memberIds: string[] = [],
        guestNames: string[] = [],
        teamId: string | null = null,
      ) {
        return [
          ...memberIds.map((memberId) => ({
            id: crypto.randomUUID(),
            matchId: id,
            userId: memberId,
            guestName: null,
            teamId,
            user: {
              id: memberId,
              username: memberId === userId ? "Alex" : "Taylor",
            },
          })),
          ...guestNames.map((name) => ({
            id: crypto.randomUUID(),
            matchId: id,
            userId: null,
            guestName: name,
            teamId,
            user: null,
          })),
        ];
      }
      const match: Match = {
        ...baseMatch,
        id,
        description: vars.input.description,
        teams,
        participants: [
          ...roster(vars.input.memberIds, vars.input.guestNames),
          ...(vars.input.teams ?? []).flatMap(
            (
              team: { memberIds?: string[]; guestNames?: string[] },
              index: number,
            ) => roster(team.memberIds, team.guestNames, teams[index].id),
          ),
        ],
      };
      state.matches.push(match);
      data = { createMatch: match };
    } else if (
      q.includes("mutation AddPlayer") ||
      q.includes("mutation JoinMatch")
    )
      data = { addMatchParticipant: { id: "p-new" } };
    else if (q.includes("mutation Login")) {
      if (authState) {
        authState.loggedIn = true;
        data = {
          login: {
            user: {
              id: userId,
              username: "Alex",
              email: "alex@example.test",
              createdAt: "2026-10-01",
            },
          },
        };
      } else
        return route.fulfill({
          json: { errors: [{ message: "Invalid credentials" }] },
        });
    } else if (body.action === "logout") data = { logout: true };
    else throw new Error(`Unhandled fixture operation: ${q.slice(0, 80)}`);
    return route.fulfill({ json: { data } });
  });
}
async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.width);
}
test("exactly three tabs and readable matches, feedback, and account layouts", async ({
  page,
}) => {
  await api(page);
  await page.goto("/matches");
  await expect(
    page.getByRole("heading", { name: "Your matches" }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", {
    name:
      page.viewportSize()!.width < 640
        ? "Mobile navigation"
        : "Main navigation",
    exact: true,
  });
  await expect(nav.getByRole("link")).toHaveCount(3);
  expect(await nav.getByRole("link").allTextContents()).toEqual([
    "Matches",
    "Feedback",
    "Account",
  ]);
  await expect(
    page.getByRole("heading", { name: "Sunday beach session" }),
  ).toBeVisible();
  await noOverflow(page);
  await page.getByRole("link", { name: /Sunday beach session/ }).click();
  await expect(
    page.getByRole("heading", { name: "Players", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0", { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.goto("/feedback");
  await expect(
    page.getByRole("heading", { name: "Your feedback" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "General feedback", exact: true })
    .click();
  await expect(page.getByText("Great communication on court.")).toBeVisible();
  await expect(
    page.getByText("Good reads during the match."),
  ).not.toBeVisible();
  await noOverflow(page);
  await page.goto(`/feedback/${feedbackId}`);
  await expect(
    page.getByRole("heading", { name: "Feedback details" }),
  ).toBeVisible();
  await noOverflow(page);
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Your account" }),
  ).toBeVisible();
  await noOverflow(page);
});
test("request, copy, guest review, confirmation, and recipient feedback", async ({
  page,
  browser,
}) => {
  const state = store();
  await api(page, { state });
  await page.goto("/feedback");
  await page
    .getByRole("button", { name: "Request feedback", exact: true })
    .click();
  await page.getByRole("button", { name: "Create feedback link" }).click();
  const link = await page
    .getByRole("textbox", { name: "Feedback link" })
    .inputValue();
  expect(link).toContain("/f/");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Link copied.");
  await noOverflow(page);
  const context = await browser.newContext({ viewport: page.viewportSize()! });
  const reviewer = await context.newPage();
  await api(reviewer, { guest: true, state });
  await reviewer.goto(link);
  await reviewer
    .getByRole("radio", { name: /No match — General Feedback/ })
    .check();
  await reviewer.getByRole("button", { name: "Passing: 5 out of 5" }).click();
  await reviewer
    .getByRole("textbox", { name: "Passing comment (optional)" })
    .fill("Reliable first touch.");
  await reviewer
    .getByRole("textbox", { name: "Written feedback" })
    .fill("Helpful on court.");
  await reviewer.getByRole("textbox", { name: "Your name" }).fill("Taylor");
  await noOverflow(reviewer);
  await reviewer.getByRole("button", { name: "Submit feedback" }).click();
  await expect(
    reviewer.getByRole("heading", { name: "Thanks for your feedback." }),
  ).toBeVisible();
  expect(state.submissions).toHaveLength(1);
  expect(state.submissions[0].matchId).toBeNull();
  expect(state.submissions[0].ratings).toEqual([
    { skillId, rating: 5, comment: "Reliable first touch." },
  ]);
  expect(
    state.calls.filter((q) => q.includes("mutation GuestFeedback")),
  ).toHaveLength(1);
  await page.reload();
  await expect(page.getByText("Helpful on court.")).toBeVisible();
  await page
    .getByRole("article")
    .filter({ hasText: "Helpful on court." })
    .locator("summary")
    .click();
  await expect(page.getByText("Reliable first touch.")).toBeVisible();
  await context.close();
});
test("match-bound guest links preserve match scope without private match reads", async ({
  page,
}) => {
  const state = store();
  await api(page, { guest: true, state });
  await page.goto(`/f/${token(matchId)}`);
  await expect(page.getByText("Feedback for the invited match")).toBeVisible();
  await expect(page.getByRole("radio", { name: /No match/ })).not.toBeVisible();
  await page.getByRole("button", { name: "Passing: 4 out of 5" }).click();
  await page.getByRole("textbox", { name: "Your name" }).fill("Taylor");
  await page.getByRole("button", { name: "Submit feedback" }).click();
  await expect(
    page.getByRole("heading", { name: "Thanks for your feedback." }),
  ).toBeVisible();
  expect(state.submissions[0].matchId).toBe(matchId);
  expect(state.calls.some((q) => q.includes("query Match"))).toBe(false);
  await noOverflow(page);
});
test("registered reviewers can choose a shared match or general feedback", async ({
  page,
}) => {
  const state = store();
  await api(page, { state });
  await page.goto(`/give-feedback/${otherId}?match=${matchId}`);
  await expect(
    page.getByRole("radio", { name: /Sunday beach session/ }),
  ).toBeChecked();
  await page
    .getByRole("radio", { name: /No match — General Feedback/ })
    .check();
  await page.getByRole("button", { name: "Passing: 3 out of 5" }).click();
  await page.getByRole("button", { name: "Submit feedback" }).click();
  await expect(
    page.getByRole("heading", { name: "Thanks for your feedback." }),
  ).toBeVisible();
  expect(state.submissions[0].matchId).toBeNull();
  expect(state.submissions[0].token).toBeUndefined();
  await noOverflow(page);
});
test("create a match through the existing API", async ({ page }) => {
  const state = store();
  await api(page, { state });
  await page.goto("/matches");
  await page.getByRole("button", { name: "Create match", exact: true }).click();
  await page
    .getByRole("textbox", { name: /Match name or description/ })
    .fill("Friday beach session");
  expect(await page.getByLabel(/Date and time/).inputValue()).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
  );
  await page
    .getByRole("textbox", { name: "Find an existing member" })
    .fill("Tay");
  await page.getByRole("button", { name: "Add member Taylor" }).click();
  await page.getByRole("textbox", { name: "Guest name" }).fill("Jordan");
  await page.getByRole("button", { name: "Add guest", exact: true }).click();
  await page.getByRole("button", { name: "Add team", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Team for Taylor", exact: true })
    .selectOption({ label: "Team 3" });
  await page
    .getByRole("button", { name: "Remove team Team 3", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Team for Taylor", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("textbox", { name: "Team 1 name", exact: true })
    .fill("Sand");
  await page
    .getByRole("textbox", { name: "Team 2 name", exact: true })
    .fill("Sea");
  await page
    .getByRole("combobox", { name: "Team for Alex", exact: true })
    .selectOption({ label: "Sand" });
  await page
    .getByRole("combobox", { name: "Team for Taylor", exact: true })
    .selectOption({ label: "Sea" });
  await page
    .getByRole("combobox", { name: "Team for Jordan", exact: true })
    .selectOption({ label: "Sea" });
  await noOverflow(page);

  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create match", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Friday beach session" }),
  ).toBeVisible();
  await expect(page.getByText("Taylor", { exact: true })).toBeVisible();
  await expect(page.getByText("Jordan", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sand", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sea", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Taylor, Jordan", { exact: true })).toBeVisible();
  expect(
    state.calls.filter((q) => q.includes("mutation CreateMatch")),
  ).toHaveLength(1);
  await noOverflow(page);
});
test("empty and failed states are honest", async ({ page }) => {
  await api(page, { empty: true });
  await page.goto("/matches");
  await expect(
    page.getByRole("heading", { name: "Your next match starts here" }),
  ).toBeVisible();
  await page.goto("/feedback");
  await expect(
    page.getByRole("heading", { name: "No feedback here yet" }),
  ).toBeVisible();
  await noOverflow(page);
  await page.unroute("**/api/graphql");
  await api(page, { failure: true });
  await page.goto("/matches");
  await expect(
    page.getByRole("heading", { name: "Something needs attention" }),
  ).toBeVisible();
});
test("old tabs redirect and invalid public links stay public", async ({
  page,
}) => {
  await api(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/matches$/);
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/account$/);
  await page.goto(`/feedback/${userId}?token=${token()}`);
  await expect(page).toHaveURL(/\/f\//);
  await page.goto("/f/invalid");
  await expect(
    page.getByRole("heading", { name: "This invitation is unavailable." }),
  ).toBeVisible();
  await noOverflow(page);
});
test("landing and signup fit without dashboard navigation", async ({
  page,
}) => {
  await api(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Good games/ })).toBeVisible();
  await noOverflow(page);
  await page.getByRole("link", { name: "Join Courtside" }).click();
  await expect(
    page.getByRole("heading", { name: "Let’s grow your game." }),
  ).toBeVisible();
  await noOverflow(page);
});

test("feedback descriptions and login/signup return links", async ({
  page,
}) => {
  await api(page, { guest: true });
  const path = `/f/${token()}`;
  await page.goto(path);
  await expect(
    page.getByText(
      "Control the first touch so your partner can play the next ball.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Passing" }),
  ).toHaveAccessibleDescription(
    "Control the first touch so your partner can play the next ball.",
  );
  const signup = page.getByRole("link", { name: "Sign up", exact: true });
  expect(
    new URL(
      (await signup.getAttribute("href"))!,
      "http://localhost",
    ).searchParams.get("next"),
  ).toBe(path);
  await signup.click();
  await expect(
    page.getByRole("heading", { name: "Let’s grow your game." }),
  ).toBeVisible();
  expect(
    new URL(
      (await page
        .getByRole("link", { name: "Sign in", exact: true })
        .getAttribute("href"))!,
      "http://localhost",
    ).searchParams.get("next"),
  ).toBe(path);
  await noOverflow(page);
});
test("login in another tab automatically fills the reviewer account name", async ({
  page,
  context,
}) => {
  const authState = { loggedIn: false };
  await api(page, { guest: true, authState });
  await page.goto(`/f/${token()}`);
  await expect(page.getByRole("textbox", { name: "Your name" })).toBeEditable();
  const login = await context.newPage();
  await api(login, { authState });
  await login.goto(
    (await page
      .getByRole("link", { name: "Log in", exact: true })
      .getAttribute("href"))!,
  );
  await login.getByLabel("Email or username").fill("alex");
  await login
    .getByLabel("Password", { exact: true })
    .fill("a-valid-test-password");
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Your name" })).toHaveValue(
    "Alex",
  );
  await expect(
    page.getByRole("textbox", { name: "Your name" }),
  ).toHaveAttribute("readonly", "");
  await noOverflow(page);
});

test("a skill comment requires a rating for that skill", async ({ page }) => {
  await api(page, { guest: true });
  await page.goto(`/f/${token()}`);
  await page.getByRole("textbox", { name: "Your name" }).fill("Taylor");
  await page
    .getByRole("textbox", { name: "Passing comment (optional)" })
    .fill("Useful observation.");
  await page.getByRole("button", { name: "Submit feedback" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({
        hasText: "Choose a rating for Passing to include its comment.",
      }),
  ).toBeVisible();
});
