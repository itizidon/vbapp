// Local-only pagination check. Removes all records it creates.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { request } from "@playwright/test";
const backendRequire = createRequire(
  new URL("../../package.json", import.meta.url),
);
const { PrismaClient } = backendRequire("@prisma/client");
const { JwtService } = backendRequire("@nestjs/jwt");
const db = new PrismaClient();
let user, api, anonymous;
try {
  const tag = randomUUID().slice(0, 8);
  user = await db.user.create({
    data: {
      username: `history_${tag}`,
      email: `history_${tag}@example.test`,
      passwordHash: "local-test-no-login",
      age: 25,
      heightCm: 180,
      isPublic: true,
    },
  });
  const sport = await db.sport.findUniqueOrThrow({
    where: { slug: "beach-volleyball" },
  });
  const token = await new JwtService({
    secret: process.env.JWT_SECRET,
  }).signAsync(
    { id: user.id, sub: user.id, username: user.username },
    { expiresIn: "10m" },
  );
  const baseURL = process.env.FRONTEND_URL ?? "http://localhost:3002";
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
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
          expires: Math.floor(Date.now() / 1000) + 600,
        },
      ],
    },
  });
  anonymous = await request.newContext({ baseURL });
  const matches = [];
  for (let index = 0; index < 25; index++) {
    const match = await db.match.create({
      data: {
        createdById: user.id,
        sportId: sport.id,
        description: `History test ${index}`,
        playedAt: new Date(
          index < 15 ? "2026-11-08T15:00:00Z" : "2026-10-01T15:00:00Z",
        ),
        createdAt: new Date(Date.now() - index * 60000),
      },
    });
    matches.push(match);
    await db.feedback.create({
      data: {
        recipientId: user.id,
        sportId: sport.id,
        guestName: "Pagination tester",
        overallComment: `History feedback ${index}`,
        matchId: index < 15 ? null : match.id,
        createdAt: match.createdAt,
      },
    });
  }
  async function gql(context, query, variables = {}) {
    const response = await context.post("/api/graphql", {
      data: { query, variables },
    });
    const result = await response.json();
    assert.ok(!result.errors, JSON.stringify(result.errors));
    return result.data;
  }
  async function allPages(field, context, args = "", vars = {}) {
    const ids = [];
    let cursor = null;
    const sizes = [];
    do {
      const data = await gql(
        context,
        `query($cursor:String${args ? ",$id:ID!" : ""}){${field}(cursor:$cursor${args}){id}}`,
        { cursor, ...vars },
      );
      const rows = data[field];
      sizes.push(rows.length);
      ids.push(...rows.slice(0, 10).map((row) => row.id));
      cursor = rows.length > 10 ? rows[9].id : null;
    } while (cursor);
    assert.deepEqual(sizes, [11, 11, 5]);
    assert.equal(ids.length, 25);
    assert.equal(new Set(ids).size, 25);
    return ids;
  }
  assert.deepEqual(
    await allPages("userMatches", api),
    matches.map((match) => match.id),
  );
  await allPages("receivedFeedback", api);
  assert.deepEqual(
    await allPages("playerMatches", anonymous, ",userId:$id", { id: user.id }),
    matches.map((match) => match.id),
  );
  const dates = {
    from: "2026-10-01T00:00:00Z",
    before: "2026-10-02T00:00:00Z",
  };
  const filtered = await gql(
    api,
    "query($from:DateTime,$before:DateTime){userMatches(playedFrom:$from,playedBefore:$before){id}}",
    dates,
  );
  assert.deepEqual(
    filtered.userMatches.map((match) => match.id),
    matches.slice(15).map((match) => match.id),
  );
  const publicFiltered = await gql(
    anonymous,
    "query($id:ID!,$from:DateTime,$before:DateTime){playerMatches(userId:$id,playedFrom:$from,playedBefore:$before){id}}",
    { id: user.id, ...dates },
  );
  assert.deepEqual(publicFiltered.playerMatches, filtered.userMatches);
  const feedback = await gql(
    api,
    "{receivedFeedback(matchOnly:true){id matchId}}",
  );
  assert.equal(feedback.receivedFeedback.length, 10);
  assert.ok(feedback.receivedFeedback.every((row) => row.matchId));
  const submissionDates = {
    from: matches[20].createdAt.toISOString(),
    before: matches[10].createdAt.toISOString(),
  };
  const datedFeedback = await gql(
    api,
    "query($from:DateTime,$before:DateTime){receivedFeedback(createdFrom:$from,createdBefore:$before){id createdAt}}",
    submissionDates,
  );
  assert.equal(datedFeedback.receivedFeedback.length, 10);
  assert.ok(
    datedFeedback.receivedFeedback.every(
      (row) =>
        new Date(row.createdAt) >= matches[20].createdAt &&
        new Date(row.createdAt) < matches[10].createdAt,
    ),
  );
  const datedMatchFeedback = await gql(
    api,
    "query($from:DateTime,$before:DateTime){receivedFeedback(matchOnly:true,createdFrom:$from,createdBefore:$before){id matchId}}",
    submissionDates,
  );
  assert.equal(datedMatchFeedback.receivedFeedback.length, 6);
  assert.deepEqual(
    datedMatchFeedback.receivedFeedback.map((row) => row.matchId),
    matches.slice(15, 21).map((match) => match.id),
  );
  console.log(
    "Verified 10-result cursor pages without gaps or duplicates, feedback submission dates/categories before pagination, and date ranges on personal/public history.",
  );
} finally {
  await Promise.all([api?.dispose(), anonymous?.dispose()]);
  if (user) {
    await db.feedback.deleteMany({ where: { recipientId: user.id } });
    await db.match.deleteMany({ where: { createdById: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
  await db.$disconnect();
  console.log("Removed temporary history test account, matches, and feedback.");
}
