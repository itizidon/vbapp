// Local-only verification; removes its temporary account and feedback.
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
const jwt = new JwtService({ secret: process.env.JWT_SECRET });
const baseURL = process.env.FRONTEND_URL ?? "http://localhost:3002";
let user, api, anonymous, browser;
try {
  const tag = randomUUID().slice(0, 8);
  user = await db.user.create({
    data: {
      username: `link_${tag}`,
      email: `link_${tag}@example.test`,
      passwordHash: "local-test-no-login",
      age: 25,
      heightCm: 180,
    },
  });
  const sport = await db.sport.findUniqueOrThrow({
    where: { slug: "beach-volleyball" },
    include: { skills: { where: { active: true } } },
  });
  const auth = await jwt.signAsync(
    { id: user.id, sub: user.id, username: user.username },
    { expiresIn: "10m" },
  );
  api = await request.newContext({
    baseURL,
    storageState: {
      origins: [],
      cookies: [
        {
          name: "courtside_session",
          value: auth,
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
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    storageState: await api.storageState(),
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 375, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/feedback");
  await page
    .getByRole("button", { name: "Request feedback", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create feedback link", exact: true })
    .click();
  const code = page.getByRole("img", {
    name: "Feedback link QR code",
    exact: true,
  });
  await expect(code).toBeVisible();
  await code.screenshot({ path: "/tmp/bvbtips-feedback-link-qr.png" });
  const url = await page
    .getByRole("textbox", { name: "Feedback link", exact: true })
    .inputValue();
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Link copied.");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
  const token = decodeURIComponent(new URL(url).pathname.slice(3));
  const claims = await jwt.verifyAsync(token);
  assert.equal(claims.exp - claims.iat, 86400);
  const input = {
    token,
    recipientId: user.id,
    sportId: sport.id,
    guestName: "First guest",
    ratings: [{ skillId: sport.skills[0].id, rating: 4 }],
  };
  const query =
    "mutation($input:SubmitGuestFeedbackInput!){submitGuestFeedback(input:$input){id}}";
  async function submit(value) {
    const response = await anonymous.post("/api/graphql", {
      data: { query, variables: { input: value } },
    });
    return response.json();
  }
  for (const name of ["First guest", "Second guest"]) {
    const result = await submit({ ...input, guestName: name });
    assert.ok(!result.errors, JSON.stringify(result.errors));
  }
  assert.equal(
    await db.feedback.count({ where: { guestInviteNonce: claims.nonce } }),
    2,
  );
  const expired = await jwt.signAsync(
    {
      kind: claims.kind,
      nonce: claims.nonce,
      recipientId: user.id,
      sportId: sport.id,
    },
    { expiresIn: -1 },
  );
  assert.ok(
    (await submit({ ...input, token: expired })).errors?.some((error) =>
      error.message.includes("expired"),
    ),
  );
  assert.ok(
    (await submit({ ...input, matchId: randomUUID() })).errors?.some((error) =>
      error.message.includes("does not match"),
    ),
  );
  assert.equal(
    await db.feedback.count({ where: { guestInviteNonce: claims.nonce } }),
    2,
  );
  const guests = await browser.newContext({ baseURL });
  const guest = await guests.newPage();
  await guest.goto(url);
  await guest
    .getByRole("textbox", { name: "Your name", exact: true })
    .fill("Third guest");
  await guest
    .getByRole("button", {
      name: `${sport.skills[0].name}: 4 out of 5`,
      exact: true,
    })
    .click();
  await guest
    .getByRole("button", { name: "Submit feedback", exact: true })
    .click();
  await guest
    .getByRole("heading", { name: "Thanks for your feedback." })
    .waitFor();
  assert.equal(
    await db.feedback.count({ where: { guestInviteNonce: claims.nonce } }),
    3,
  );
  console.log(
    "Verified QR display and copy URL, 24-hour JWT expiration, three submissions through one link, and rejection of expired or changed-scope links.",
  );
} finally {
  await browser?.close();
  await Promise.all([api?.dispose(), anonymous?.dispose()]);
  if (user) {
    await db.feedback.deleteMany({ where: { recipientId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
  await db.$disconnect();
  console.log("Removed temporary feedback-link account and submissions.");
}
