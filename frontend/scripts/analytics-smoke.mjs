// Local-only verification. Deletes its own users, matches, and feedback.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chromium, request, expect } from "@playwright/test";
const backendRequire = createRequire(
  new URL("../../package.json", import.meta.url),
);
const { PrismaClient } = backendRequire("@prisma/client");
const { JwtService } = backendRequire("@nestjs/jwt");
const db = new PrismaClient();
const users = [];
let api, anonymous, browser;
const baseURL = process.env.FRONTEND_URL ?? "http://localhost:3002";
try {
  const tag = randomUUID().slice(0, 8);
  for (const role of ["owner", "reviewer"])
    users.push(
      await db.user.create({
        data: {
          username: `analytics_${role}_${tag}`,
          email: `analytics_${role}_${tag}@example.test`,
          passwordHash: "local-test-no-login",
          age: 25,
          heightCm: 180,
        },
      }),
    );
  const [owner, reviewer] = users;
  const sport = await db.sport.findUniqueOrThrow({
    where: { slug: "beach-volleyball" },
    include: { skills: { where: { active: true }, orderBy: { name: "asc" } } },
  });
  assert.ok(sport.skills.length >= 2);
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 1);
  day.setUTCHours(12, 0, 0, 0);
  const oldDay = new Date(day);
  oldDay.setUTCFullYear(oldDay.getUTCFullYear() - 2);
  async function match(
    scores,
    status = "SCHEDULED",
    playedAt = day,
    playing = true,
  ) {
    const row = await db.match.create({
      data: {
        createdById: owner.id,
        sportId: sport.id,
        status,
        playedAt,
        teams: {
          create: scores.map((score, index) => ({
            teamNumber: index + 1,
            score,
          })),
        },
      },
      include: { teams: true },
    });
    if (playing)
      await db.matchParticipant.create({
        data: {
          matchId: row.id,
          userId: owner.id,
          teamId: row.teams.find((team) => team.teamNumber === 1).id,
        },
      });
  }
  await match([21, 0]);
  await match([0, 21]);
  await match([21, 21]);
  await match([21, null]);
  await match([21, 0], "CANCELLED");
  await match([21, 0], "IN_PROGRESS");
  await match([21, 0], "COMPLETED", day, false);
  await match([21, 0], "COMPLETED", oldDay);
  async function feedback(
    value,
    skill,
    createdAt = day,
    given = false,
    status = "PUBLISHED",
  ) {
    await db.feedback.create({
      data: {
        recipientId: given ? reviewer.id : owner.id,
        reviewerId: given ? owner.id : reviewer.id,
        sportId: sport.id,
        status,
        createdAt,
        analyticsAllowed: false,
        ratings: { create: { skillId: skill.id, rating: value } },
      },
    });
  }
  await feedback(2, sport.skills[0]);
  await feedback(4, sport.skills[0]);
  await feedback(5, sport.skills[1]);
  await feedback(5, sport.skills[0], day, false, "HIDDEN");
  await feedback(5, sport.skills[0], oldDay);
  await feedback(1, sport.skills[0], day, true);
  const token = await new JwtService({
    secret: process.env.JWT_SECRET,
  }).signAsync(
    { id: owner.id, sub: owner.id, username: owner.username },
    { expiresIn: "10m" },
  );
  api = await request.newContext({
    baseURL,
    storageState: {
      origins: [],
      cookies: [
        {
          name: "courtside_session",
          value: token,
          domain: "localhost",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 600,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
    },
  });
  anonymous = await request.newContext({ baseURL });
  const query =
    "query($from:DateTime,$timeZone:String!){myAnalytics(from:$from,timeZone:$timeZone){categories{id name} wins losses ratingCount from before timeZone points{date winRate wins losses ratings{skillId average count}}}}";
  async function analytics(from, context = api) {
    const response = await context.post("/api/graphql", {
      data: { query, variables: { from, timeZone: "UTC" } },
    });
    const result = await response.json();
    return result;
  }
  const from = new Date(day);
  from.setUTCDate(from.getUTCDate() - 5);
  const received = await analytics(from.toISOString());
  assert.ok(!received.errors, JSON.stringify(received.errors));
  const data = received.data.myAnalytics;
  assert.deepEqual(
    data.categories,
    sport.skills.map(({ id, name }) => ({ id, name })),
  );
  assert.equal(data.wins, 1);
  assert.equal(data.losses, 1);
  assert.equal(data.ratingCount, 3);
  assert.equal(data.points.length, 1);
  assert.equal(data.points[0].winRate, 50);
  assert.equal(data.points[0].date, day.toISOString().slice(0, 10));
  assert.deepEqual(
    data.points[0].ratings.find(
      (rating) => rating.skillId === sport.skills[0].id,
    ),
    { skillId: sport.skills[0].id, average: 3, count: 2 },
  );
  const sampleQuery =
    "query($skillId:ID!,$from:DateTime,$before:DateTime){myCategoryFeedback(skillId:$skillId,from:$from,before:$before){id submittedAt rating}}";
  const sampleVariables = {
    skillId: sport.skills[0].id,
    from: data.from,
    before: data.before,
  };
  const sampleResponse = await api.post("/api/graphql", {
    data: { query: sampleQuery, variables: sampleVariables },
  });
  const sampleResult = await sampleResponse.json();
  assert.ok(!sampleResult.errors, JSON.stringify(sampleResult.errors));
  const samples = sampleResult.data.myCategoryFeedback;
  assert.equal(samples.length, 2);
  assert.deepEqual(
    samples.map((row) => row.rating).sort((a, b) => a - b),
    [2, 4],
  );
  assert.ok(samples.every((row) => row.submittedAt === day.toISOString()));
  const anonymousSamples = await anonymous.post("/api/graphql", {
    data: { query: sampleQuery, variables: sampleVariables },
  });
  assert.ok(
    (await anonymousSamples.json()).errors?.some((error) =>
      error.message.includes("Unauthorized"),
    ),
  );
  const all = (await analytics(null)).data.myAnalytics;
  assert.equal(all.wins, 2);
  assert.equal(all.losses, 1);
  assert.equal(all.ratingCount, 4);
  assert.ok(
    (await analytics(null, anonymous)).errors?.some((error) =>
      error.message.includes("Unauthorized"),
    ),
  );
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto("/analytics");
  await page.getByLabel("Daily analytics line chart").waitFor();
  await page
    .getByRole("combobox", { name: "Chart metric", exact: true })
    .selectOption(sport.skills[0].id);
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await page.getByLabel("Daily analytics line chart").waitFor();
  await page
    .getByRole("switch", { name: "Individual feedback", exact: true })
    .click();
  const individualChart = page.getByLabel("Individual feedback line chart");
  await expect(individualChart.locator(".recharts-dot")).toHaveCount(3);
  await page.screenshot({
    path: "/tmp/bvbtips-analytics-live.png",
    fullPage: true,
  });
  await page.getByText("View individual feedback", { exact: true }).click();
  await page
    .getByRole("columnheader", { name: sport.skills[0].name, exact: true })
    .waitFor();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
  console.log(
    "Verified backend-defined categories, daily win rates, weighted feedback averages, received-feedback scope, full-history ranges, and daily/individual Analytics modes.",
  );
} finally {
  await browser?.close();
  await Promise.all([api?.dispose(), anonymous?.dispose()]);
  if (users.length) {
    const ids = users.map((user) => user.id);
    await db.feedback.deleteMany({
      where: {
        OR: [{ recipientId: { in: ids } }, { reviewerId: { in: ids } }],
      },
    });
    await db.matchParticipant.deleteMany({
      where: { match: { createdById: { in: ids } } },
    });
    await db.match.deleteMany({ where: { createdById: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  await db.$disconnect();
  console.log("Removed temporary analytics users, matches, and feedback.");
}
