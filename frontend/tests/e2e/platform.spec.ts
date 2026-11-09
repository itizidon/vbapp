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
    {
      id: "p1",
      matchId,
      userId,
      guestName: null,
      teamId: "t1",
      user: { id: userId, username: "Alex" },
    },
    {
      id: "p2",
      matchId,
      userId: otherId,
      guestName: null,
      teamId: "t2",
      user: { id: otherId, username: "Taylor" },
    },
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
    matches: [structuredClone(baseMatch)] as Match[],
    submissions: [] as Record<string, unknown>[],
    calls: [] as string[],
    isPublic: false,
    analyticsCategories: [
      { id: skillId, name: "Passing", description: "Control the first touch." },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Defense reads",
        description: "Read the next play.",
      },
    ],
    suggestionRequests: [] as string[],
    categoryFeedbackRequests: [] as {
      skillId: string;
      from: string | null;
      before: string;
    }[],
    analyticsRequests: [] as {
      from: string | null;
      before: string;
    }[],
    players: [
      { id: otherId, username: "Taylor", isPublic: true },
      {
        id: "88888888-8888-4888-8888-888888888888",
        username: "Private Pat",
        isPublic: false,
      },
    ],
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
    editFailure = false,
  }: {
    guest?: boolean;
    empty?: boolean;
    failure?: boolean;
    state?: ReturnType<typeof store>;
    authState?: { loggedIn: boolean };
    editFailure?: boolean;
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
    else if (q.includes("query PlayerSuggestions")) {
      state.suggestionRequests.push(vars.search);
      const query = vars.search.toLowerCase();
      const matches = state.players.filter(
        (player) =>
          player.username.toLowerCase().includes(query) ||
          `${player.username.toLowerCase().replace(/\s/g, "")}@example.test`.includes(
            query,
          ),
      );
      data = { playerSuggestions: matches.slice(0, 5) };
    } else if (q.includes("query MyCategoryFeedback")) {
      state.categoryFeedbackRequests.push(vars);
      const today = new Date(vars.before);
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const morning = new Date(yesterday);
      morning.setHours(9);
      const afternoon = new Date(yesterday);
      afternoon.setHours(15);
      const span = (Date.parse(vars.before) - today.getTime()) / 4;
      const times = [
        morning,
        afternoon,
        new Date(today.getTime() + span),
        new Date(today.getTime() + span * 2),
        new Date(today.getTime() + span * 3),
      ];
      data = {
        myCategoryFeedback: empty
          ? []
          : [2, 4, 3, 4, 5].map((rating, index) => ({
              id: `sample-${index}`,
              rating,
              submittedAt: times[index].toISOString(),
            })),
      };
    } else if (q.includes("query MyAnalytics")) {
      state.analyticsRequests.push(vars);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const points = [
        {
          date: yesterday.toISOString().slice(0, 10),
          winRate: 50,
          wins: 1,
          losses: 1,
          ratings: state.analyticsCategories.map((category) => ({
            skillId: category.id,
            average: 3,
            count: 2,
          })),
        },
        {
          date: today.toISOString().slice(0, 10),
          winRate: 100,
          wins: 1,
          losses: 0,
          ratings: state.analyticsCategories.map((category) => ({
            skillId: category.id,
            average: 4,
            count: 3,
          })),
        },
      ];
      data = {
        myAnalytics: {
          categories: state.analyticsCategories,
          points: empty ? [] : points,
          wins: empty ? 0 : 2,
          losses: empty ? 0 : 1,
          ratingCount: empty ? 0 : 10,
          from: vars.from,
          before: vars.before,
          timeZone: vars.timeZone,
        },
      };
    } else if (q.includes("mutation UpdateAccountVisibility")) {
      if (editFailure)
        return route.fulfill({
          json: { errors: [{ message: "Unable to save visibility." }] },
        });
      state.isPublic = vars.isPublic;
      data = {
        updateAccountVisibility: {
          id: userId,
          username: "Alex",
          email: "alex@example.test",
          createdAt: "2026-10-01",
          isPublic: state.isPublic,
        },
      };
    } else if (q.includes("query PlayerSearch")) {
      const rows = state.players.filter((player) =>
        player.username.toLowerCase().includes(vars.search.toLowerCase()),
      );
      const start = vars.cursor
        ? rows.findIndex((player) => player.id === vars.cursor) + 1
        : 0;
      data = { searchPlayers: rows.slice(start, start + 51) };
    } else if (q.includes("query PlayerProfile")) {
      data = {
        playerProfile: state.players.find((player) => player.id === vars.id),
      };
    } else if (q.includes("query PlayerMatches")) {
      const player = state.players.find((player) => player.id === vars.userId);
      if (!player?.isPublic)
        return route.fulfill({
          json: { errors: [{ message: "This account is private" }] },
        });
      const rows = state.matches.filter(
        (match) =>
          (!vars.playedFrom ||
            (match.playedAt && match.playedAt >= vars.playedFrom)) &&
          (!vars.playedBefore ||
            (match.playedAt && match.playedAt < vars.playedBefore)),
      );
      const start = vars.cursor
        ? rows.findIndex((match) => match.id === vars.cursor) + 1
        : 0;
      data = { playerMatches: rows.slice(start, start + 11) };
    } else if (q.includes("query MemberSearch"))
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
          isPublic: state.isPublic,
          createdAt: "2026-10-01",
        },
      };
    } else if (q.includes("mutation EditMatch")) {
      if (editFailure)
        return route.fulfill({
          json: { errors: [{ message: "Unable to save match." }] },
        });
      const match = state.matches.find((item) => item.id === vars.input.id)!;
      Object.assign(match, vars.input);
      data = { updateMatch: match };
    } else if (q.includes("mutation EditTeam")) {
      const team = state.matches
        .flatMap((item) => item.teams ?? [])
        .find((item) => item.id === vars.input.id)!;
      Object.assign(team, vars.input);
      data = { updateMatchTeam: team };
    } else if (q.includes("mutation AddTeam")) {
      const match = state.matches.find(
        (item) => item.id === vars.input.matchId,
      )!;
      const teams = match.teams ?? [];
      const team = {
        id: crypto.randomUUID(),
        matchId: match.id,
        teamNumber: Math.max(0, ...teams.map((item) => item.teamNumber)) + 1,
        name: vars.input.name ?? null,
        score: null,
      };
      match.teams = [...teams, team];
      data = { createMatchTeam: team };
    } else if (q.includes("mutation EditPlayerTeam")) {
      const player = state.matches
        .flatMap((item) => item.participants ?? [])
        .find((item) => item.id === vars.participantId)!;
      player.teamId = vars.teamId;
      data = { assignParticipantToTeam: player };
    } else if (q.includes("mutation RemovePlayer")) {
      for (const match of state.matches)
        match.participants =
          match.participants?.filter((player) => player.id !== vars.id) ?? [];
      data = { removeMatchParticipant: { id: vars.id } };
    } else if (
      q.includes("mutation AddExistingPlayer") ||
      q.includes("mutation AddGuestPlayer")
    ) {
      const match = state.matches.find(
        (item) => item.id === vars.input.matchId,
      )!;
      const player = {
        id: crypto.randomUUID(),
        matchId: match.id,
        teamId: vars.input.teamId ?? null,
        userId: vars.input.userId ?? null,
        guestName: vars.input.guestName ?? null,
        user: vars.input.userId
          ? {
              id: vars.input.userId,
              username: vars.input.userId === userId ? "Alex" : "Taylor",
            }
          : null,
      };
      match.participants = [...(match.participants ?? []), player];
      data = q.includes("mutation AddExistingPlayer")
        ? { addMatchParticipant: player }
        : { addGuestMatchParticipant: player };
    } else if (q.includes("query Matches")) {
      const rows = (empty ? [] : state.matches).filter(
        (match) =>
          (!vars.playedFrom ||
            (match.playedAt && match.playedAt >= vars.playedFrom)) &&
          (!vars.playedBefore ||
            (match.playedAt && match.playedAt < vars.playedBefore)),
      );
      const start = vars.cursor
        ? rows.findIndex((match) => match.id === vars.cursor) + 1
        : 0;
      data = { userMatches: rows.slice(start, start + 11) };
    } else if (q.includes("query Match("))
      data = { match: state.matches.find((m) => m.id === vars.id) ?? null };
    else if (q.includes("Received")) {
      const rows = (empty ? [] : state.feedback).filter(
        (feedback) =>
          (vars.matchOnly == null || !!feedback.matchId === vars.matchOnly) &&
          (!vars.createdFrom ||
            new Date(feedback.createdAt) >= new Date(vars.createdFrom)) &&
          (!vars.createdBefore ||
            new Date(feedback.createdAt) < new Date(vars.createdBefore)),
      );
      const start = vars.cursor
        ? rows.findIndex((feedback) => feedback.id === vars.cursor) + 1
        : 0;
      data = { receivedFeedback: rows.slice(start, start + 11) };
    } else if (q.includes("Submitted")) data = { submittedFeedback: [] };
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
        (team: { name: string; score?: number | null }, index: number) => ({
          id: `created-team-${index}`,
          matchId: id,
          teamNumber: index + 1,
          name: team.name,
          score: team.score ?? null,
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
test("four tabs and readable matches, feedback, and account layouts", async ({
  page,
}) => {
  test.setTimeout(60000);
  await api(page);
  await page.goto("/matches");
  await expect(
    page.getByRole("heading", { name: "Your matches" }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", {
    name:
      page.viewportSize()!.width < 768
        ? "Mobile navigation"
        : "Main navigation",
    exact: true,
  });
  await expect(nav.getByRole("link")).toHaveCount(4);
  expect(await nav.getByRole("link").allTextContents()).toEqual([
    "Matches",
    "Feedback",
    "Analytics",
    "Account",
  ]);
  await expect(
    page.getByRole("heading", { name: "Sunday beach session" }),
  ).toBeVisible();
  await noOverflow(page);
  await page.getByRole("link", { name: /Sunday beach session/ }).click();
  await page.waitForURL(`**/matches/${matchId}`);
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
  await expect(
    page.getByRole("img", { name: "Feedback link QR code", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Reusable for 24 hours/)).toBeVisible();
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
  const team1 = page.getByRole("group", { name: "Team 1", exact: true });
  const team2 = page.getByRole("group", { name: "Team 2", exact: true });
  const firstTeamBox = (await team1.boundingBox())!;
  const secondTeamBox = (await team2.boundingBox())!;
  if (page.viewportSize()!.width >= 1024) {
    expect(secondTeamBox.x).toBeGreaterThanOrEqual(
      firstTeamBox.x + firstTeamBox.width,
    );
    expect(Math.abs(secondTeamBox.y - firstTeamBox.y)).toBeLessThan(2);
    expect(
      (await page.getByRole("dialog").boundingBox())!.width,
    ).toBeGreaterThan(800);
  } else {
    expect(secondTeamBox.y).toBeGreaterThanOrEqual(
      firstTeamBox.y + firstTeamBox.height,
    );
  }

  await expect(team1.getByText("Alex (you)", { exact: true })).toBeVisible();
  await team2
    .getByRole("textbox", { name: "Find an existing member" })
    .fill("Tay");
  await team2.getByRole("button", { name: "Add member Taylor" }).click();
  await expect(team2.getByText("Taylor", { exact: true })).toBeVisible();
  await team2.getByRole("textbox", { name: "Guest name" }).fill("Jordan");
  await team2.getByRole("button", { name: "Add guest", exact: true }).click();
  await expect(team2.getByText("Jordan", { exact: true })).toBeVisible();
  await team2.getByRole("button", { name: "Move Jordan to Team 1" }).click();
  await expect(team1.getByText("Jordan", { exact: true })).toBeVisible();
  await team1.getByRole("button", { name: "Move Jordan to Team 2" }).click();
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add team", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Team 1 score", { exact: true }).fill("0");
  await page.getByLabel("Team 2 score", { exact: true }).fill("21");
  await noOverflow(page);

  const historyRequests = state.calls.filter((query) =>
    query.includes("query Matches("),
  ).length;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create match", exact: true })
    .click();
  await page.waitForURL(`**/matches/${state.matches.at(-1)!.id}`);
  await expect(
    page.getByRole("heading", { name: "Friday beach session" }),
  ).toBeVisible();
  await expect(page.getByText("Taylor", { exact: true })).toBeVisible();
  await expect(page.getByText("Jordan", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Team 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Team 2", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Taylor, Jordan", { exact: true })).toBeVisible();
  expect(state.matches.at(-1)?.teams?.map((team) => team.score)).toEqual([
    0, 21,
  ]);
  expect(
    state.calls.filter((q) => q.includes("mutation CreateMatch")),
  ).toHaveLength(1);
  expect(
    state.calls.filter((query) => query.includes("query Matches(")),
  ).toHaveLength(historyRequests);
  expect(
    state.calls.filter((query) => query.includes("query Match(")),
  ).toHaveLength(0);
  await noOverflow(page);
  await page
    .getByRole("link", { name: "← Back to matches", exact: true })
    .click();
  await page.waitForURL("**/matches");
  await expect(
    page.getByRole("heading", { name: "Friday beach session", exact: true }),
  ).toBeVisible();
  expect(
    state.calls.filter((query) => query.includes("query Matches(")),
  ).toHaveLength(historyRequests + 1);
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
    page.getByRole("alert").filter({
      hasText: "Choose a rating for Passing to include its comment.",
    }),
  ).toBeVisible();
});

test("organizer edits date, scores, players, and team assignments", async ({
  page,
}) => {
  const state = store();
  await api(page, { state });
  await page.goto(`/matches/${matchId}`);
  await page.getByRole("button", { name: "Edit match", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const sandPanel = dialog.getByRole("region", {
    name: "Edit Sand",
    exact: true,
  });
  const seaPanel = dialog.getByRole("region", {
    name: "Edit Sea",
    exact: true,
  });
  const firstTeamBox = (await sandPanel.boundingBox())!;
  const secondTeamBox = (await seaPanel.boundingBox())!;
  if (page.viewportSize()!.width >= 1024) {
    expect(secondTeamBox.x).toBeGreaterThanOrEqual(
      firstTeamBox.x + firstTeamBox.width,
    );
    expect(Math.abs(secondTeamBox.y - firstTeamBox.y)).toBeLessThan(2);
    expect((await dialog.boundingBox())!.width).toBeGreaterThan(800);
  } else {
    expect(secondTeamBox.y).toBeGreaterThanOrEqual(
      firstTeamBox.y + firstTeamBox.height,
    );
  }
  const details = dialog.getByRole("form", { name: "Edit match details" });
  await details
    .getByLabel("Match name or description")
    .fill("Updated Sunday match");
  await details.getByLabel("Date and time").fill("2026-11-09T18:30");
  await details.getByLabel("Match status").selectOption("SCHEDULED");
  await details.getByRole("button", { name: "Save match details" }).click();
  await expect(details.getByRole("status")).toHaveText("Match details saved.");
  const sand = dialog.getByRole("form", { name: "Edit team Sand" });
  await sand.getByLabel("Score for Sand").fill("0");
  await sand.getByRole("button", { name: "Save team" }).click();
  await expect(sand.getByRole("status")).toHaveText("Team saved.");
  const sea = dialog.getByRole("form", { name: "Edit team Sea" });
  await sea.getByLabel("Score for Sea").fill("");
  await sea.getByRole("button", { name: "Save team" }).click();
  await expect(sea.getByRole("status")).toHaveText("Team saved.");
  expect(state.matches[0].teams?.find((t) => t.id === "t2")?.score).toBeNull();
  await sea.getByLabel("Score for Sea").fill("19");
  await sea.getByRole("button", { name: "Save team" }).click();
  await expect(sea.getByRole("status")).toHaveText("Team saved.");
  const player = dialog.getByRole("region", {
    name: "Player Taylor",
    exact: true,
  });
  await player
    .getByRole("button", { name: "Move to Sand", exact: true })
    .click();
  await expect(
    sandPanel.getByRole("region", { name: "Player Taylor", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Remove player Taylor", exact: true })
    .click();
  await expect(player).not.toBeVisible();
  await seaPanel
    .getByRole("textbox", { name: "Find an existing member" })
    .fill("Tay");
  await seaPanel.getByRole("button", { name: "Add member Taylor" }).click();
  await expect(player).toBeVisible();
  await seaPanel
    .getByRole("textbox", { name: "Guest name", exact: true })
    .fill("Jordan");
  await seaPanel
    .getByRole("button", { name: "Add guest", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Player Jordan", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("heading", { name: "Updated Sunday match" }),
  ).toBeVisible();
  expect(
    state.matches[0].participants?.some(
      (p) => p.guestName === "Jordan" && p.teamId === "t2",
    ),
  ).toBe(true);
  await noOverflow(page);
});
test("participants cannot edit another organizer's match", async ({ page }) => {
  const state = store();
  state.matches[0].createdById = otherId;
  await api(page, { state });
  await page.goto(`/matches/${matchId}`);
  await expect(
    page.getByRole("heading", { name: "Sunday beach session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit match", exact: true }),
  ).not.toBeVisible();
});
test("edit errors retain the unsaved form values", async ({ page }) => {
  await api(page, { editFailure: true });
  await page.goto(`/matches/${matchId}`);
  await page.getByRole("button", { name: "Edit match", exact: true }).click();
  const form = page.getByRole("form", { name: "Edit match details" });
  await form.getByLabel("Match name or description").fill("An unsaved draft");
  await form.getByRole("button", { name: "Save match details" }).click();
  await expect(form.getByRole("alert")).toHaveText("Unable to save match.");
  await expect(form.getByLabel("Match name or description")).toHaveValue(
    "An unsaved draft",
  );
});

test("match cards reflect the logged-in player's result", async ({ page }) => {
  const state = store();
  const loss = structuredClone(baseMatch);
  loss.description = "My loss";
  const win = structuredClone(baseMatch);
  win.id = "99999999-9999-4999-8999-999999999999";
  win.description = "My win";
  win.participants!.find((player) => player.userId === userId)!.teamId = "t2";
  const neutral = structuredClone(baseMatch);
  neutral.id = "77777777-7777-4777-8777-777777777777";
  neutral.description = "Organizer only";
  neutral.participants = neutral.participants!.filter(
    (player) => player.userId !== userId,
  );
  state.matches = [loss, win, neutral];
  await api(page, { state });
  await page.goto("/matches");
  const lossCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "My loss", exact: true }),
  });
  const winCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "My win", exact: true }),
  });
  const neutralCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Organizer only", exact: true }),
  });
  await expect(lossCard.getByText("You lost", { exact: true })).toBeVisible();
  await expect(lossCard).toHaveClass(/bg-red-50/);
  await expect(winCard.getByText("You won", { exact: true })).toBeVisible();
  await expect(winCard).toHaveClass(/bg-green-50/);
  await expect(neutralCard).not.toHaveClass(/bg-(red|green)-50/);
  const backgrounds = await Promise.all(
    [lossCard, winCard, neutralCard].map((card) =>
      card.evaluate((element) => getComputedStyle(element).backgroundColor),
    ),
  );
  expect(new Set(backgrounds).size).toBe(3);
  await noOverflow(page);
});

test("account visibility switches between private and public and persists", async ({
  page,
}) => {
  const state = store();
  await api(page, { state });
  await page.goto("/account");
  const toggle = page.getByRole("switch", { name: "Public account" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(
    page.getByRole("status").filter({ hasText: "Account visibility saved." }),
  ).toBeVisible();
  expect(state.isPublic).toBe(true);
  await page.reload();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(state.isPublic).toBe(false);
  await noOverflow(page);
});
test("failed visibility saves keep the account private", async ({ page }) => {
  await api(page, { editFailure: true });
  await page.goto("/account");
  const toggle = page.getByRole("switch", { name: "Public account" });
  await toggle.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Unable to save visibility." }),
  ).toBeVisible();
  await expect(toggle).not.toBeChecked();
});
test("player search lists private accounts and public histories are read-only", async ({
  page,
}) => {
  test.setTimeout(60000);
  const state = store();
  await api(page, { state, guest: true });
  await page.goto("/players");
  await expect(page.getByRole("link", { name: /Private Pat/ })).toContainText(
    "Private account",
  );
  await page.getByRole("link", { name: /Private Pat/ }).click();
  await page.waitForURL("**/players/88888888-8888-4888-8888-888888888888");
  await expect(
    page.getByRole("heading", { name: "This account is private" }),
  ).toBeVisible();
  expect(
    state.calls.some((query) => query.includes("query PlayerMatches")),
  ).toBe(false);
  await page.getByRole("link", { name: "← Back to player search" }).click();
  await page.getByLabel("Player username").fill("Tay");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("link", { name: /Private Pat/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Taylor/ }).click();
  await page.waitForURL(`**/players/${otherId}`);
  await expect(
    page.getByRole("heading", { name: "Taylor’s match history" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sunday beach session" }),
  ).toBeVisible();
  await expect(page.getByText("Taylor", { exact: true })).toBeVisible();
  await expect(page.getByText("Won", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Edit match|feedback/i }),
  ).toHaveCount(0);
  await expect(
    page.locator('a[href^="/matches/"], a[href*="feedback"]'),
  ).toHaveCount(0);
  expect(
    state.calls.some((query) =>
      /query Received|query Submitted|query Match\(/.test(query),
    ),
  ).toBe(false);
  await noOverflow(page);
});
test("player search can browse beyond the first page", async ({ page }) => {
  const state = store();
  state.players = Array.from({ length: 52 }, (_, index) => ({
    id: `player-${index}`,
    username: `Player ${index}`,
    isPublic: false,
  }));
  await api(page, { state, guest: true });
  await page.goto("/players");
  const players = page
    .getByRole("list", { name: "Players", exact: true })
    .getByRole("listitem");
  await expect(players).toHaveCount(50);
  await page.getByRole("button", { name: "Load more players" }).click();
  await expect(players).toHaveCount(52);
  await expect(
    page.getByRole("button", { name: "Load more players" }),
  ).toHaveCount(0);
});

test("match history loads ten at a time on scroll and filters all pages by date", async ({
  page,
}) => {
  const state = store();
  state.matches = Array.from({ length: 25 }, (_, index) => ({
    ...structuredClone(baseMatch),
    id: `match-page-${index}`,
    description: `History game ${index + 1}`,
    playedAt: index < 15 ? "2026-11-08T15:00:00Z" : "2026-10-01T15:00:00Z",
  }));
  await api(page, { state });
  await page.goto("/matches");
  await expect(page.getByRole("article")).toHaveCount(10);
  await page
    .getByRole("button", { name: "Load more results" })
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole("article")).toHaveCount(20);
  await page
    .getByRole("button", { name: "Load more results" })
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole("article")).toHaveCount(25);
  await expect(
    page.getByRole("button", { name: "Load more results" }),
  ).toHaveCount(0);
  await page.getByLabel("From date").fill("2026-10-01");
  await page.getByLabel("To date").fill("2026-10-01");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect(page.getByRole("article")).toHaveCount(10);
  await expect(
    page.getByRole("heading", { name: "History game 16", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "History game 1", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Clear dates" }).click();
  await expect(
    page.getByRole("heading", { name: "History game 1", exact: true }),
  ).toBeVisible();
  await page.getByLabel("From date").fill("2026-11-09");
  await page.getByLabel("To date").fill("2026-11-01");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "From date must be on or before To date." }),
  ).toBeVisible();
  await noOverflow(page);
});
test("feedback loads ten at a time on scroll and filters before pagination", async ({
  page,
}) => {
  const state = store();
  state.feedback = Array.from({ length: 25 }, (_, index) => ({
    ...baseFeedback,
    id: `feedback-page-${index}`,
    overallComment: `Feedback entry ${index + 1}`,
    matchId: index < 15 ? null : matchId,
  }));
  await api(page, { state });
  await page.goto("/feedback");
  await expect(
    page.getByRole("link").filter({ hasText: /Feedback entry/ }),
  ).toHaveCount(10);
  await page
    .getByRole("button", { name: "Load more results" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("link").filter({ hasText: /Feedback entry/ }),
  ).toHaveCount(20);
  await page
    .getByRole("button", { name: "Load more results" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("link").filter({ hasText: /Feedback entry/ }),
  ).toHaveCount(25);
  await page
    .getByRole("button", { name: "Match feedback", exact: true })
    .click();
  await expect(
    page.getByRole("link").filter({ hasText: /Feedback entry/ }),
  ).toHaveCount(10);
  await expect(
    page.getByText("Feedback entry 16", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Feedback entry 1", { exact: true })).toHaveCount(
    0,
  );
  await noOverflow(page);
});
test("public match history supports date filters and infinite scrolling", async ({
  page,
}) => {
  const state = store();
  state.matches = Array.from({ length: 15 }, (_, index) => ({
    ...structuredClone(baseMatch),
    id: `public-page-${index}`,
    description: `Public game ${index + 1}`,
    playedAt: index < 10 ? "2026-11-08T15:00:00Z" : "2026-10-01T15:00:00Z",
  }));
  await api(page, { state, guest: true });
  await page.goto(`/players/${otherId}`);
  await expect(page.getByRole("article")).toHaveCount(10);
  await page
    .getByRole("button", { name: "Load more results" })
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole("article")).toHaveCount(15);
  await page.getByLabel("To date").fill("2026-10-01");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(
    page.getByRole("heading", { name: "Public game 11", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit match", exact: true }),
  ).toHaveCount(0);
});

test("feedback date ranges combine with categories and reset infinite pagination", async ({
  page,
}) => {
  const state = store();
  state.feedback = Array.from({ length: 25 }, (_, index) => ({
    ...baseFeedback,
    id: `dated-feedback-${index}`,
    overallComment: `Dated note ${index + 1}`,
    createdAt: index < 15 ? "2026-11-08T15:00:00Z" : "2026-10-01T15:00:00Z",
    matchId: index < 15 ? null : matchId,
  }));
  await api(page, { state });
  await page.goto("/feedback");
  const cards = page.getByRole("link").filter({ hasText: /Dated note/ });
  await expect(cards).toHaveCount(10);
  await page.getByLabel("From date").fill("2026-10-01");
  await page.getByLabel("To date").fill("2026-10-01");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect(cards).toHaveCount(10);
  await expect(page.getByText("Dated note 16", { exact: true })).toBeVisible();
  await expect(page.getByText("Dated note 1", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "General feedback", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No feedback in this date range" }),
  ).toBeVisible();
  await expect(cards).toHaveCount(0);
  await page.getByRole("button", { name: "All feedback", exact: true }).click();
  await expect(cards).toHaveCount(10);
  await page.getByRole("button", { name: "Clear dates" }).click();
  await expect(page.getByText("Dated note 1", { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(10);
  await page
    .getByRole("button", { name: "Load more results" })
    .scrollIntoViewIfNeeded();
  await expect(cards).toHaveCount(20);
  await page
    .getByRole("button", { name: "Load more results" })
    .scrollIntoViewIfNeeded();
  await expect(cards).toHaveCount(25);
  await page.getByLabel("From date").fill("2026-11-09");
  await page.getByLabel("To date").fill("2026-11-01");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "From date must be on or before To date." }),
  ).toBeVisible();
  await noOverflow(page);
});

test("analytics uses backend categories and interactive time frames", async ({
  page,
}) => {
  test.setTimeout(60000);
  const state = store();
  state.analyticsCategories[1].name = "Custom server category";
  await api(page, { state });
  await page.goto("/analytics");
  await expect(
    page.getByRole("heading", { name: "Your analytics" }),
  ).toBeVisible();
  const chart = page.getByLabel("Daily analytics line chart");
  await expect(chart).toBeVisible();
  await expect(chart.locator(".recharts-line")).toHaveCount(1);
  const metric = page.getByRole("combobox", {
    name: "Chart metric",
    exact: true,
  });
  const requests = state.analyticsRequests.length;
  await metric.selectOption(skillId);
  await expect(chart.locator(".recharts-line")).toHaveCount(1);
  await metric.selectOption({ label: "Custom server category" });
  const customId = state.analyticsCategories[1].id;
  await expect(chart.locator(".recharts-line")).toHaveCount(1);
  expect(state.analyticsRequests.length).toBe(requests);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByLabel("Feedback to chart")).toHaveCount(0);
  for (const name of [
    "1 week",
    "1 month",
    "3 months",
    "Year to date",
    "1 year",
    "All time",
  ]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(chart).toBeVisible();
    await expect(metric).toHaveValue(customId);
    await expect(chart.locator(".recharts-line")).toHaveCount(1);
  }
  expect(state.analyticsRequests.at(-1)?.from).toBeNull();
  await page.screenshot({
    path: `/tmp/courtside-analytics-${page.viewportSize()!.width}.png`,
    fullPage: true,
  });
  await page.getByText("View daily data", { exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Custom server category" }),
  ).toBeVisible();
  await noOverflow(page);
  if (page.viewportSize()!.width < 500) {
    const menu = page.getByRole("group", { name: "Time frame", exact: true });
    expect(
      await menu.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
  }
});
test("analytics handles missing data for the selected metric", async ({
  page,
}) => {
  await api(page, { empty: true });
  await page.goto("/analytics");
  await expect(
    page.getByRole("heading", { name: "No data for this metric" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Chart metric", exact: true })
    .selectOption(skillId);
  await expect(
    page.getByRole("heading", { name: "No data for this metric" }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(1);
  await noOverflow(page);
});

test("analytics switches daily averages and individual feedback within the same period", async ({
  page,
}) => {
  const state = store();
  await api(page, { state });
  await page.goto("/analytics");
  const toggle = page.getByRole("switch", {
    name: "Individual feedback",
    exact: true,
  });
  const metric = page.getByRole("combobox", {
    name: "Chart metric",
    exact: true,
  });
  await expect(toggle).toBeDisabled();
  await expect(page.getByLabel("Daily analytics line chart")).toBeVisible();
  expect(state.categoryFeedbackRequests).toHaveLength(0);
  await metric.selectOption(skillId);
  await expect(toggle).toBeEnabled();
  const daily = page.getByLabel("Daily analytics line chart");
  await expect(daily.locator(".recharts-dot")).toHaveCount(2);
  await toggle.click();
  await expect(toggle).toBeChecked();
  const individual = page.getByLabel("Individual feedback line chart");
  await expect(individual).toBeVisible();
  await expect(individual.locator(".recharts-dot")).toHaveCount(5);
  expect(state.categoryFeedbackRequests.at(-1)).toMatchObject({
    skillId,
    from: state.analyticsRequests.at(-1)!.from,
    before: state.analyticsRequests.at(-1)!.before,
  });
  await page.getByText("View individual feedback", { exact: true }).click();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(5);
  await expect(
    page.getByRole("cell", { name: "2 / 5", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "1 week", exact: true }).click();
  await expect(individual).toBeVisible();
  await expect(metric).toHaveValue(skillId);
  await expect(toggle).toBeChecked();
  expect(state.categoryFeedbackRequests.at(-1)?.from).toBe(
    state.analyticsRequests.at(-1)?.from,
  );
  await toggle.click();
  await expect(daily).toBeVisible();
  await expect(daily.locator(".recharts-dot")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "1 week", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await noOverflow(page);
});

test("top bar searches players inline by username or email and supports keyboard selection", async ({
  page,
}) => {
  const state = store();
  await api(page, { state });
  await page.goto("/matches");
  const input = page.getByRole("combobox", {
    name: "Search players",
    exact: true,
  });
  await expect(input).toBeEnabled();
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: "Search players", exact: true }),
  ).toHaveCount(0);
  await input.fill("taylor@example.test");
  const options = page.getByRole("listbox", { name: "Player suggestions" });
  await expect(options.getByRole("option")).toHaveCount(1);
  await expect(options).toContainText("Taylor");
  await expect(page).toHaveURL(/\/matches$/);
  await input.press("Escape");
  await expect(options).toHaveCount(0);
  await input.fill("Private");
  await expect(options).toContainText("Private account");
  await input.press("ArrowDown");
  await input.press("Enter");
  await page.waitForURL("**/players/88888888-8888-4888-8888-888888888888");
  await expect(
    page.getByRole("heading", { name: "This account is private" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Search players", exact: true }),
  ).toHaveValue("");
  await noOverflow(page);
});
test("top bar suggestions are limited to five and clear without navigating", async ({
  page,
}) => {
  const state = store();
  state.players = Array.from({ length: 8 }, (_, index) => ({
    id: `suggestion-${index}`,
    username: `SearchPlayer${index}`,
    isPublic: index % 2 === 0,
  }));
  await api(page, { state });
  await page.goto("/matches");
  const input = page.getByRole("combobox", {
    name: "Search players",
    exact: true,
  });
  await input.fill("SearchPlayer");
  await expect(
    page
      .getByRole("listbox", { name: "Player suggestions" })
      .getByRole("option"),
  ).toHaveCount(5);
  await page.getByRole("button", { name: "Clear player search" }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page).toHaveURL(/\/matches$/);
  await noOverflow(page);
});
