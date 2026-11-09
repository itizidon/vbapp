// Local-only check: creates one temporary account and removes its own records.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chromium, request } from "@playwright/test";
const backendRequire = createRequire(
  new URL("../../package.json", import.meta.url),
);
const { PrismaClient } = backendRequire("@prisma/client");
const db = new PrismaClient();
const baseURL = process.env.FRONTEND_URL ?? "http://localhost:3001";
const api = await request.newContext({ baseURL });
let userId, memberId, browser;
async function gql(query, variables = {}, context = api) {
  const response = await context.post("/api/graphql", {
    data: { query, variables },
  });
  const result = await response.json();
  assert.ok(response.ok(), JSON.stringify(result.errors));
  assert.ok(!result.errors, JSON.stringify(result.errors));
  return result.data;
}
async function submitGuest(page, url, comment, matchBound = false) {
  await page.goto(url);
  await page
    .getByRole("textbox", { name: "Your name" })
    .fill("QA teammate")
    .catch(async (error) => {
      console.error(
        "Guest page:",
        (await page.locator("main").innerText()).slice(0, 1500),
      );
      throw error;
    });
  if (matchBound)
    await page.getByText("Feedback for the invited match").waitFor();
  else
    await page
      .getByRole("radio", { name: /No match — General Feedback/ })
      .check();
  await page
    .getByRole("group", { name: /Passing/ })
    .getByRole("button", { name: /4 out of 5/ })
    .click();
  await page.getByRole("textbox", { name: "Written feedback" }).fill(comment);
  await page.getByRole("button", { name: "Submit feedback" }).click();
  await page
    .getByRole("heading", { name: "Thanks for your feedback." })
    .waitFor();
}
try {
  const { sports } = await gql(
    "query Catalog {sports{id name slug skills{id name description active requiredForSelfAssessment}}}",
  );
  const sport = sports.find((s) => s.slug === "beach-volleyball");
  assert.ok(sport, "Seed Beach Volleyball before running this check.");
  assert.ok(
    sport.skills.every((skill) => skill.description?.trim()),
    "Seed category descriptions before this check.",
  );
  const username = `qa_${randomUUID().slice(0, 8)}`;
  const password = `QA-${randomUUID()}!`;
  const registered = await gql(
    "mutation Register($input:RegisterInput!){register(input:$input){accessToken user{id username}}}",
    {
      input: {
        username,
        email: `${username}@example.test`,
        password,
        age: 30,
        heightCm: 180,
        sportId: sport.id,
        overallLevel: "B",
        ratings: sport.skills
          .filter((s) => s.active && s.requiredForSelfAssessment)
          .map((s) => ({ skillId: s.id, rating: 3 })),
      },
    },
  );
  userId = registered.register.user.id;
  const memberUsername = `qa_member_${randomUUID().slice(0, 8)}`;
  const memberApi = await request.newContext({ baseURL });
  try {
    const created = await gql(
      "mutation Register($input:RegisterInput!){register(input:$input){accessToken user{id}}}",
      {
        input: {
          username: memberUsername,
          email: `${memberUsername}@example.test`,
          password,
          age: 30,
          heightCm: 180,
          sportId: sport.id,
          overallLevel: "B",
          ratings: sport.skills
            .filter((skill) => skill.active && skill.requiredForSelfAssessment)
            .map((skill) => ({ skillId: skill.id, rating: 3 })),
        },
      },
      memberApi,
    );
    memberId = created.register.user.id;
  } finally {
    await memberApi.dispose();
  }

  assert.equal(registered.register.accessToken, undefined);
  assert.ok(
    (await api.storageState()).cookies.some(
      (c) => c.name === "courtside_session" && c.httpOnly,
    ),
  );
  browser = await chromium.launch();
  const authenticated = await browser.newContext({
    baseURL,
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  const page = await authenticated.newPage();
  const anonymous = await browser.newContext({
    baseURL,
    viewport: { width: 375, height: 900 },
  });
  const guest = await anonymous.newPage();
  await page.goto("/feedback");
  await page.getByRole("heading", { name: "Your feedback" }).waitFor();
  await page
    .getByRole("button", { name: "Request feedback", exact: true })
    .click();
  await page.getByRole("button", { name: "Create feedback link" }).click();
  const generalLink = await page
    .getByRole("textbox", { name: "Feedback link" })
    .inputValue();
  assert.ok(generalLink.includes("/f/"));
  await page.getByRole("button", { name: "Close dialog" }).click();
  await submitGuest(guest, generalLink, "Live general feedback verification.");
  await page.reload();
  await page.getByText("Live general feedback verification.").waitFor();
  await page.goto("/matches");
  await page.getByRole("button", { name: "Create match", exact: true }).click();
  await page
    .getByRole("textbox", { name: /Match name or description/ })
    .fill("Live beach match verification");
  assert.ok(await page.getByLabel(/Date and time/).inputValue());
  const team2 = page.getByRole("group", { name: "Team 2", exact: true });
  await team2
    .getByRole("textbox", { name: "Find an existing member" })
    .fill(memberUsername);
  await team2
    .getByRole("button", { name: `Add member ${memberUsername}` })
    .click();
  await team2
    .getByRole("textbox", { name: "Guest name" })
    .fill("QA guest Jordan");
  await team2.getByRole("button", { name: "Add guest", exact: true }).click();

  await page.getByLabel("Team 1 score", { exact: true }).fill("0");
  await page.getByLabel("Team 2 score", { exact: true }).fill("21");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create match", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Live beach match verification" })
    .waitFor();
  await page.waitForURL(/\/matches\/[0-9a-f-]{36}$/);
  const matchId = new URL(page.url()).pathname.split("/").pop();
  const createdMatch = await gql(
    "query Match($id:ID!){match(id:$id){playedAt teams{id name score} participants{teamId userId guestName user{id username}}}}",
    { id: matchId },
  );
  assert.ok(createdMatch.match.playedAt);
  assert.equal(createdMatch.match.participants.length, 3);
  const sand = createdMatch.match.teams.find((team) => team.name === "Team 1");
  const sea = createdMatch.match.teams.find((team) => team.name === "Team 2");
  assert.ok(sand && sea);
  assert.equal(sand.score, 0);
  assert.equal(sea.score, 21);
  assert.equal(
    createdMatch.match.participants.find((player) => player.userId === userId)
      .teamId,
    sand.id,
  );
  assert.equal(
    createdMatch.match.participants.find((player) => player.userId === memberId)
      .teamId,
    sea.id,
  );
  assert.equal(
    createdMatch.match.participants.find(
      (player) => player.guestName === "QA guest Jordan",
    ).teamId,
    sea.id,
  );
  const failedName = `qa_rollback_${randomUUID()}`;
  const rejected = await api.post("/api/graphql", {
    data: {
      query:
        "mutation CreateMatch($input:CreateMatchInput){createMatch(input:$input){id}}",
      variables: {
        input: {
          sportId: sport.id,
          description: failedName,
          teams: [
            { name: "First", memberIds: [userId] },
            { name: "Second", memberIds: [randomUUID()] },
          ],
        },
      },
    },
  });
  assert.ok(
    (await rejected.json()).errors?.some((error) =>
      error.message.includes("no longer available"),
    ),
  );
  assert.equal(
    await db.match.count({
      where: { createdById: userId, description: failedName },
    }),
    0,
  );

  assert.ok(
    createdMatch.match.participants.some(
      (participant) =>
        participant.userId === memberId &&
        participant.user.username === memberUsername,
    ),
  );
  assert.ok(
    createdMatch.match.participants.some(
      (participant) => participant.guestName === "QA guest Jordan",
    ),
  );

  await page
    .getByRole("button", { name: "Request feedback", exact: true })
    .click();
  await page.getByRole("button", { name: "Create feedback link" }).click();
  const matchLink = await page
    .getByRole("textbox", { name: "Feedback link" })
    .inputValue();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await submitGuest(
    guest,
    matchLink,
    "Live match feedback verification.",
    true,
  );
  await page.reload();
  await page.getByText("Live match feedback verification.").waitFor();
  // Exercise the actual organizer-only editor after feedback already exists.
  await page.getByRole("button", { name: "Edit match", exact: true }).click();
  const editor = page.getByRole("dialog");
  const details = editor.getByRole("form", { name: "Edit match details" });
  await details
    .getByLabel("Match name or description")
    .fill("Edited beach match verification");
  await details.getByLabel("Date and time").fill("2026-11-09T18:30");
  const expectedPlayedAt = await details
    .getByLabel("Date and time")
    .evaluate((input) => new Date(input.value).toISOString());
  await details.getByLabel("Match status").selectOption("COMPLETED");
  await details.getByRole("button", { name: "Save match details" }).click();
  await details.getByRole("status").getByText("Match details saved.").waitFor();
  const sandEditor = editor.getByRole("form", { name: "Edit team Team 1" });
  await sandEditor.getByLabel("Score for Team 1").fill("0");
  await sandEditor.getByRole("button", { name: "Save team" }).click();
  await sandEditor.getByRole("status").waitFor();
  const seaEditor = editor.getByRole("form", { name: "Edit team Team 2" });
  await seaEditor.getByLabel("Score for Team 2").fill("19");
  await seaEditor.getByRole("button", { name: "Save team" }).click();
  await seaEditor.getByRole("status").waitFor();
  const memberRow = editor.getByRole("region", {
    name: `Player ${memberUsername}`,
    exact: true,
  });
  await memberRow
    .getByRole("button", { name: "Move to Team 1", exact: true })
    .click();
  await editor
    .getByRole("region", { name: "Edit Team 1", exact: true })
    .getByRole("region", { name: `Player ${memberUsername}`, exact: true })
    .waitFor();
  const moved = await gql(
    "query Match($id:ID!){match(id:$id){participants{userId teamId}}}",
    { id: matchId },
  );
  assert.equal(
    moved.match.participants.find((player) => player.userId === memberId)
      .teamId,
    sand.id,
  );
  await editor
    .getByRole("button", { name: "Remove player QA guest Jordan", exact: true })
    .click();
  await editor
    .getByRole("region", { name: "Player QA guest Jordan", exact: true })
    .waitFor({ state: "detached" });
  await editor
    .getByRole("button", {
      name: `Remove player ${memberUsername}`,
      exact: true,
    })
    .click();
  await memberRow.waitFor({ state: "detached" });
  const seaPanel = editor.getByRole("region", {
    name: "Edit Team 2",
    exact: true,
  });
  await seaPanel
    .getByRole("textbox", { name: "Find an existing member" })
    .fill(memberUsername);
  await seaPanel
    .getByRole("button", { name: `Add member ${memberUsername}` })
    .click();
  await memberRow.waitFor();
  await seaPanel
    .getByRole("textbox", { name: "Guest name", exact: true })
    .fill("QA guest Morgan");
  await seaPanel
    .getByRole("button", { name: "Add guest", exact: true })
    .click();
  await editor
    .getByRole("region", { name: "Player QA guest Morgan", exact: true })
    .waitFor();
  await editor.getByRole("button", { name: "Close dialog" }).click();
  const edited = await gql(
    "query Match($id:ID!){match(id:$id){description playedAt status teams{id name teamNumber score} participants{userId guestName teamId}}}",
    { id: matchId },
  );
  assert.equal(edited.match.description, "Edited beach match verification");
  assert.equal(edited.match.playedAt, expectedPlayedAt);
  assert.equal(edited.match.status, "COMPLETED");
  assert.equal(edited.match.teams.find((team) => team.id === sand.id).score, 0);
  assert.equal(edited.match.teams.find((team) => team.id === sea.id).score, 19);
  assert.equal(edited.match.participants.length, 3);
  assert.ok(
    !edited.match.participants.some(
      (player) => player.guestName === "QA guest Jordan",
    ),
  );
  assert.equal(
    edited.match.participants.find(
      (player) => player.guestName === "QA guest Morgan",
    ).teamId,
    sea.id,
  );
  const readOnlyApi = await request.newContext({ baseURL });
  try {
    await gql(
      "mutation Login($input:LoginInput!){login(input:$input){accessToken user{id}}}",
      { input: { login: memberUsername, password } },
      readOnlyApi,
    );
    const denied = await readOnlyApi.post("/api/graphql", {
      data: {
        query:
          "mutation EditMatch($input:UpdateMatchInput!){updateMatch(input:$input){id}}",
        variables: { input: { id: matchId, description: "Not authorized" } },
      },
    });
    assert.ok(
      (await denied.json()).errors?.some((error) =>
        error.message.includes("Only the organizer"),
      ),
    );
  } finally {
    await readOnlyApi.dispose();
  }

  const received = await gql(
    "{receivedFeedback{id matchId overallComment ratings{rating}}}",
  );
  assert.equal(received.receivedFeedback.length, 2);
  assert.ok(received.receivedFeedback.some((f) => f.matchId === null));
  assert.ok(received.receivedFeedback.some((f) => f.matchId === matchId));
  await page.screenshot({
    path: "/tmp/courtside-match-desktop.png",
    fullPage: true,
  });
  await page.goto("/feedback");
  await page.screenshot({
    path: "/tmp/courtside-feedback-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({
    path: "/tmp/courtside-feedback-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("link")
    .filter({ hasText: "Live general feedback verification." })
    .click();
  await page.getByRole("heading", { name: "Feedback details" }).waitFor();

  const anotherInvite = await gql(
    "mutation Invite($recipientId:ID!,$sportId:ID!){createGuestFeedbackInvite(recipientId:$recipientId,sportId:$sportId){token}}",
    { recipientId: userId, sportId: sport.id },
  );
  await guest.goto(`/f/${anotherInvite.createGuestFeedbackInvite.token}`);
  await guest.getByRole("textbox", { name: "Your name" }).waitFor();
  const loginTab = await anonymous.newPage();
  await loginTab.goto(
    await guest
      .getByRole("link", { name: "Log in", exact: true })
      .getAttribute("href"),
  );
  await loginTab.getByLabel("Email or username").fill(memberUsername);
  await loginTab.getByLabel("Password", { exact: true }).fill(password);
  await loginTab.getByRole("button", { name: "Sign in", exact: true }).click();
  await guest.waitForFunction(
    (name) =>
      document.querySelector('input[autocomplete="nickname"]')?.value === name,
    memberUsername,
  );
  assert.equal(
    await guest.getByRole("textbox", { name: "Your name" }).inputValue(),
    memberUsername,
  );
  await loginTab.close();
  await page.goto("/");
  await page.waitForURL("**/matches");
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  await api.post("/api/graphql", { data: { action: "logout" } });
  const login = await gql(
    "mutation Login($input:LoginInput!){login(input:$input){accessToken user{id}}}",
    { input: { login: username, password } },
  );
  assert.equal(login.login.user.id, userId);
  assert.equal(login.login.accessToken, undefined);
  console.log(
    "Live flow verified: request link → guest general feedback → recipient list; create match → match-specific link → guest feedback → match details; account sign-out/login, descriptions, mixed rosters, current date defaults, cross-tab identity, and organizer-only match editing.",
  );
} finally {
  await browser?.close();
  await api.dispose();
  if (userId) {
    await db.$transaction(async (tx) => {
      await tx.feedback.deleteMany({ where: { recipientId: userId } });
      await tx.matchParticipant.deleteMany({
        where: { match: { createdById: userId } },
      });
      await tx.match.deleteMany({ where: { createdById: userId } });
      await tx.selfAssessment.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
    console.log(
      "Removed temporary test account, matches, assessments, and feedback.",
    );
  }
  if (memberId) {
    await db.selfAssessment.deleteMany({ where: { userId: memberId } });
    await db.user.delete({ where: { id: memberId } });
  }
  await db.$disconnect();
}
