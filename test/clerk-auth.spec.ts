import { JwtService } from "@nestjs/jwt";
import { ClerkSessions } from "../src/auth/clerk/sessions";
import { ClerkUserService } from "../src/auth/clerk/users";
import { privatePlayer } from "../src/auth/clerk/metadata";
import {
  createFixtureUser,
  clerkToken,
  fixtureClient,
  fixtureUsers,
  clerkId,
} from "./helpers/clerk-fixtures";
import {
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
afterEach(() => jest.restoreAllMocks());
it("verifies a real RSA-signed Clerk session and attaches only its subject", async () => {
  const u = createFixtureUser(),
    sessions = new ClerkSessions(new ClerkUserService());
  const result = await sessions.authenticate("Bearer " + clerkToken(u.id));
  expect(result).toMatchObject({
    id: u.id,
    clerkUserId: u.id,
    onboardingComplete: true,
  });
  expect(result).not.toHaveProperty("email");
});
it.each([
  { iss: "https://wrong.clerk.test" },
  { azp: "https://evil.example" },
  { azp: undefined },
  { exp: Math.floor(Date.now() / 1000) - 60 },
  { sid: undefined },
  { sts: "pending" },
])("rejects invalid Clerk session claims: %j", async (extra) => {
  const u = createFixtureUser();
  await expect(
    new ClerkSessions(new ClerkUserService()).authenticate(
      "Bearer " + clerkToken(u.id, extra),
    ),
  ).rejects.toBeInstanceOf(UnauthorizedException);
});
it("rejects the retired custom session JWT and arbitrary Clerk-looking IDs", async () => {
  const u = createFixtureUser(),
    token = new JwtService({
      secret: "legacy-account-jwt-secret-at-least-32",
    }).sign({ id: u.id, sub: u.id });
  const sessions = new ClerkSessions(new ClerkUserService());
  await expect(sessions.authenticate("Bearer " + token)).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
  await expect(
    sessions.authenticate("Bearer user_just_an_id"),
  ).rejects.toBeInstanceOf(UnauthorizedException);
});
it("requires primary-email verification", async () => {
  const u = createFixtureUser({ emailVerifiedAt: null });
  await expect(
    new ClerkSessions(new ClerkUserService()).authenticate(
      "Bearer " + clerkToken(u.id),
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
});
it("rejects deleted users and revoked sessions even before the JWT expires", async () => {
  const u = createFixtureUser(),
    token = clerkToken(u.id),
    users = new ClerkUserService();
  await users.getUserById(u.id);
  fixtureUsers.delete(u.id);
  await expect(
    new ClerkSessions(users).authenticate("Bearer " + token),
  ).rejects.toBeInstanceOf(UnauthorizedException);
  const other = createFixtureUser();
  jest
    .spyOn(fixtureClient.sessions, "getSession")
    .mockResolvedValue({ status: "revoked", userId: other.id } as never);
  await expect(
    new ClerkSessions(users).authenticate("Bearer " + clerkToken(other.id)),
  ).rejects.toBeInstanceOf(UnauthorizedException);
});
it("fails closed on issuer/audience mismatches and treats Clerk outages as retryable", async () => {
  const u = createFixtureUser();
  const saved = process.env.CLERK_AUDIENCE;
  process.env.CLERK_AUDIENCE = "bvbtips-api";
  try {
    await expect(
      new ClerkSessions(new ClerkUserService()).authenticate(
        "Bearer " + clerkToken(u.id, { aud: "wrong-api" }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  } finally {
    if (saved) process.env.CLERK_AUDIENCE = saved;
    else delete process.env.CLERK_AUDIENCE;
  }
  jest.spyOn(fixtureClient.users, "getUser").mockRejectedValue({ status: 429 });
  await expect(
    new ClerkSessions(new ClerkUserService()).authenticate(
      "Bearer " + clerkToken(u.id),
    ),
  ).rejects.toBeInstanceOf(ServiceUnavailableException);
});
it("ignores frontend-controlled metadata for roles and privacy", () => {
  const u = createFixtureUser();
  u.unsafeMetadata = {
    bvbtips: { version: 1, role: "ADMIN", aiCoachingEnabled: true },
  };
  expect(privatePlayer(u).role).toBe("PLAYER");
});
it("batches roster retrieval, never returns emails/private metadata and degrades on rate limits", async () => {
  const ids = Array.from({ length: 120 }, () => createFixtureUser().id),
    users = new ClerkUserService(),
    calls = jest.spyOn(fixtureClient.users, "getUserList");
  const names = await users.getUsersByIds([...ids, ids[0]]);
  expect(names.size).toBe(120);
  expect(calls).toHaveBeenCalledTimes(2);
  expect(JSON.stringify([...names.values()])).not.toMatch(
    /privateMetadata|emailAddresses|example.test/,
  );
  await users.getUsersByIds(ids);
  expect(calls).toHaveBeenCalledTimes(2);
  calls.mockRejectedValue({ status: 429 });
  expect((await users.getUsersByIds([clerkId()])).size).toBe(0);
});
it("coalesces GraphQL identity loads, including a later resolver wave", async () => {
  const a = createFixtureUser(),
    b = createFixtureUser(),
    users = new ClerkUserService(),
    context = { req: {} },
    calls = jest.spyOn(fixtureClient.users, "getUserList");
  const first = users.loadPublicPlayer(a.id, context),
    again = users.loadPublicPlayer(a.id, context);
  expect(first).toBe(again);
  expect((await first)?.id).toBe(a.id);
  expect((await users.loadPublicPlayer(b.id, context))?.id).toBe(b.id);
  expect(calls).toHaveBeenCalledTimes(2);
});
it("verifies the session once when multiple GraphQL fields share a request", async () => {
  const { GqlAuthGuard } = await import("../src/common/gql-auth.guard");
  const { GqlExecutionContext } = await import("@nestjs/graphql");
  const user = createFixtureUser(),
    req = { headers: { authorization: "Bearer " + clerkToken(user.id) } };
  jest
    .spyOn(GqlExecutionContext, "create")
    .mockReturnValue({ getContext: () => ({ req }) } as never);
  const users = jest.spyOn(fixtureClient.users, "getUser"),
    sessions = jest.spyOn(fixtureClient.sessions, "getSession");
  const guard = new GqlAuthGuard(new ClerkSessions(new ClerkUserService()), {
    reconcile: jest.fn(),
  } as never);
  await Promise.all([
    guard.canActivate({} as never),
    guard.canActivate({} as never),
  ]);
  expect(users).toHaveBeenCalledTimes(1);
  expect(sessions).toHaveBeenCalledTimes(1);
  expect(req).toMatchObject({ clerkUserId: user.id, user: { id: user.id } });
});
