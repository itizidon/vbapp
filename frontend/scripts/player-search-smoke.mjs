// Local-only verification; removes the accounts it creates.
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
  const tag = `lookup_${randomUUID().slice(0, 8)}`;
  for (let index = 0; index < 10; index++) {
    const username =
      index === 0
        ? tag
        : index === 1
          ? `${tag}_prefix`
          : index === 8
            ? `wild_${tag}%`
            : index === 9
              ? `wild_${tag}Z`
              : `aaa_${tag}_${index}`;
    users.push(
      await db.user.create({
        data: {
          username,
          email: `mail_${tag}_${index}@example.test`,
          passwordHash: "local-test-no-login",
          age: 25,
          heightCm: 180,
          isPublic: index % 2 === 0 && index !== 2,
        },
      }),
    );
  }
  const token = await new JwtService({
    secret: process.env.JWT_SECRET,
  }).signAsync(
    { id: users[0].id, sub: users[0].id, username: users[0].username },
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
    "query($search:String!){playerSuggestions(search:$search){id username isPublic}}";
  async function search(value, context = api) {
    const response = await context.post("/api/graphql", {
      data: { query, variables: { search: value } },
    });
    return response.json();
  }
  const ranked = await search(tag);
  assert.ok(!ranked.errors, JSON.stringify(ranked.errors));
  assert.equal(ranked.data.playerSuggestions.length, 5);
  assert.equal(ranked.data.playerSuggestions[0].id, users[0].id);
  assert.equal(ranked.data.playerSuggestions[1].id, users[1].id);
  assert.ok(
    ranked.data.playerSuggestions.every(
      (player) => !Object.hasOwn(player, "email"),
    ),
  );
  const exact = await search(users[2].email.toUpperCase());
  assert.equal(exact.data.playerSuggestions.length, 1);
  assert.equal(exact.data.playerSuggestions[0].id, users[2].id);
  assert.equal(exact.data.playerSuggestions[0].isPublic, false);
  const literal = await search(`${tag}%`);
  assert.deepEqual(
    literal.data.playerSuggestions.map((player) => player.id),
    [users[8].id],
  );
  assert.ok(
    (await search(tag, anonymous)).errors?.some((error) =>
      error.message.includes("Unauthorized"),
    ),
  );
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    storageState: await api.storageState(),
    viewport: { width: 1024, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/matches");
  const input = page.getByRole("combobox", {
    name: "Search players",
    exact: true,
  });
  await expect(input).toBeEnabled();
  await input.fill(tag);
  const options = page
    .getByRole("listbox", { name: "Player suggestions" })
    .getByRole("option");
  await expect(options).toHaveCount(5);
  await page.screenshot({
    path: "/tmp/bvbtips-player-search-live.png",
    fullPage: true,
  });
  assert.ok(page.url().endsWith("/matches"));
  await input.fill(users[2].email);
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("Private account");
  await options.first().click();
  await page.waitForURL(`**/players/${users[2].id}`);
  await page
    .getByRole("heading", { name: "This account is private" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("combobox", { name: "Search players", exact: true })
      .inputValue(),
    "",
  );
  console.log(
    "Verified ranked top-five username/email suggestions, literal wildcard escaping, private labels, authenticated access, and inline-to-profile navigation.",
  );
} finally {
  await browser?.close();
  await Promise.all([api?.dispose(), anonymous?.dispose()]);
  if (users.length)
    await db.user.deleteMany({
      where: { id: { in: users.map((user) => user.id) } },
    });
  await db.$disconnect();
  console.log("Removed temporary player-search accounts.");
}
