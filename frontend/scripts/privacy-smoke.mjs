// Local-only verification; creates and removes its own accounts and match.
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
const baseURL = process.env.FRONTEND_URL ?? "http://localhost:3002";
const createdUsers = [];
let matchId, browser, ownerApi, viewerApi, anonymousApi;
async function call(context, query, variables = {}) {
  const response = await context.post("/api/graphql", {
    data: { query, variables },
  });
  return response.json();
}
async function gql(context, query, variables = {}) {
  const result = await call(context, query, variables);
  assert.ok(!result.errors, JSON.stringify(result.errors));
  return result.data;
}
async function signedContext(user) {
  const token = await new JwtService({
    secret: process.env.JWT_SECRET,
  }).signAsync(
    { sub: user.id, id: user.id, username: user.username },
    { expiresIn: "10m" },
  );
  return request.newContext({
    baseURL,
    storageState: {
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
      origins: [],
    },
  });
}
try {
  const tag = randomUUID().slice(0, 8);
  for (const role of ["owner", "viewer"]) {
    const user = await db.user.create({
      data: {
        username: `privacy_${role}_${tag}`,
        email: `privacy_${role}_${tag}@example.test`,
        passwordHash: "local-test-account-no-login",
        age: 25,
        heightCm: 180,
      },
    });
    createdUsers.push(user);
    assert.equal(user.isPublic, false);
  }
  const [owner, viewer] = createdUsers;
  ownerApi = await signedContext(owner);
  viewerApi = await signedContext(viewer);
  anonymousApi = await request.newContext({ baseURL });
  const sport = await db.sport.findUniqueOrThrow({
    where: { slug: "beach-volleyball" },
  });
  const created = await gql(
    ownerApi,
    "mutation($input:CreateMatchInput){createMatch(input:$input){id}}",
    {
      input: {
        sportId: sport.id,
        description: `Privacy history ${tag}`,
        status: "COMPLETED",
        playedAt: new Date().toISOString(),
        teams: [
          { name: "Team 1", score: 21, memberIds: [owner.id] },
          { name: "Team 2", score: 0, guestNames: ["Privacy QA guest"] },
        ],
      },
    },
  );
  matchId = created.createMatch.id;
  const search = await gql(
    anonymousApi,
    "query($search:String!){searchPlayers(search:$search){id username isPublic}}",
    { search: owner.username },
  );
  assert.equal(
    search.searchPlayers.find((player) => player.id === owner.id).isPublic,
    false,
  );
  const historyQuery =
    "query($id:ID!){playerMatches(userId:$id){id description playedAt status teams{name score} participants{guestName user{id username}}}}";
  assert.ok(
    (await call(anonymousApi, historyQuery, { id: owner.id })).errors?.some(
      (error) => error.message.includes("private"),
    ),
  );
  browser = await chromium.launch();
  const ownerBrowser = await browser.newContext({
    baseURL,
    storageState: await ownerApi.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  const ownerPage = await ownerBrowser.newPage();
  await ownerPage.goto("/account");
  const toggle = ownerPage.getByRole("switch", { name: "Public account" });
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  await toggle.click();
  await expect(toggle).toBeChecked();
  await ownerPage
    .getByRole("status")
    .filter({ hasText: "Account visibility saved." })
    .waitFor();
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).isPublic,
    true,
  );
  const publicHistory = await gql(anonymousApi, historyQuery, { id: owner.id });
  assert.equal(publicHistory.playerMatches.length, 1);
  assert.equal(publicHistory.playerMatches[0].id, matchId);
  assert.deepEqual(
    publicHistory.playerMatches[0].teams.map((team) => team.score),
    [21, 0],
  );
  assert.ok(
    publicHistory.playerMatches[0].participants.some(
      (player) => player.guestName === "Privacy QA guest",
    ),
  );
  const publicBrowser = await browser.newContext({
    baseURL,
    viewport: { width: 375, height: 900 },
  });
  const publicPage = await publicBrowser.newPage();
  await publicPage.goto(`/players/${owner.id}`);
  await publicPage
    .getByRole("heading", { name: `Privacy history ${tag}` })
    .waitFor();
  assert.equal(
    await publicPage
      .getByRole("button", { name: /Edit match|feedback/i })
      .count(),
    0,
  );
  assert.equal(
    await publicPage
      .locator('a[href^="/matches/"], a[href*="feedback"]')
      .count(),
    0,
  );
  assert.equal(await publicPage.getByText("Won", { exact: true }).count(), 1);
  const deniedEdit = await call(
    viewerApi,
    "mutation($input:UpdateMatchInput!){updateMatch(input:$input){id}}",
    { input: { id: matchId, description: "Unwanted change" } },
  );
  assert.ok(
    deniedEdit.errors?.some((error) =>
      error.message.includes("Only the organizer"),
    ),
  );
  const deniedInvite = await call(
    viewerApi,
    "mutation($id:ID!,$sport:ID!){createGuestFeedbackInvite(recipientId:$id,sportId:$sport){token}}",
    { id: owner.id, sport: sport.id },
  );
  assert.ok(
    deniedInvite.errors?.some((error) => error.message.includes("themselves")),
  );
  const personalData = await call(
    anonymousApi,
    "query($id:ID!){playerProfile(id:$id){email}}",
    { id: owner.id },
  );
  assert.ok(
    personalData.errors?.some((error) =>
      error.message.includes('Cannot query field "email"'),
    ),
  );
  const forbiddenFeedback = await call(
    anonymousApi,
    "query($id:ID!){playerMatches(userId:$id){feedback{id}}}",
    { id: owner.id },
  );
  assert.ok(
    forbiddenFeedback.errors?.some((error) =>
      error.message.includes('Cannot query field "feedback"'),
    ),
  );
  const unauthenticatedUpdate = await call(
    anonymousApi,
    "mutation{updateAccountVisibility(isPublic:true){id}}",
  );
  assert.ok(
    unauthenticatedUpdate.errors?.some((error) =>
      error.message.includes("Unauthorized"),
    ),
  );
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await ownerPage
    .getByRole("status")
    .filter({ hasText: "Account visibility saved." })
    .waitFor();
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).isPublic,
    false,
  );
  assert.ok(
    (await call(anonymousApi, historyQuery, { id: owner.id })).errors?.some(
      (error) => error.message.includes("private"),
    ),
  );
  await publicPage.reload();
  await publicPage
    .getByRole("heading", { name: "This account is private" })
    .waitFor();
  assert.equal(
    await publicPage
      .getByRole("heading", { name: `Privacy history ${tag}` })
      .count(),
    0,
  );
  assert.equal(
    (await gql(ownerApi, "{userMatches{id}}")).userMatches.some(
      (match) => match.id === matchId,
    ),
    true,
  );
  console.log(
    "Verified private defaults, public search, account switch persistence, read-only public histories, ownership and feedback restrictions, and revocation of public access.",
  );
} finally {
  await browser?.close();
  await Promise.all([
    ownerApi?.dispose(),
    viewerApi?.dispose(),
    anonymousApi?.dispose(),
  ]);
  if (matchId) {
    await db.matchParticipant.deleteMany({ where: { matchId } });
    await db.match.delete({ where: { id: matchId } });
  }
  for (const user of createdUsers)
    await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
  console.log("Removed temporary privacy test accounts and match.");
}
