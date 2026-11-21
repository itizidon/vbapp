// Local fake Clerk transport for domain tests. Session signature verification stays real.
jest.mock("@clerk/backend", () => {
  const actual = jest.requireActual("@clerk/backend");
  return {
    ...actual,
    createClerkClient: () => require("./helpers/clerk-fixtures").fixtureClient,
  };
});
const fixtures = require("./helpers/clerk-fixtures");
process.env.CLERK_SECRET_KEY = "sk_test_fixture_not_a_real_key";
process.env.CLERK_ISSUER = "https://clerk.fixture.test";
process.env.CLERK_AUTHORIZED_PARTIES = "http://localhost:3001";
process.env.CLERK_JWT_KEY = fixtures.fixtureJwtKey;
process.env.GUEST_CAPABILITY_SECRET =
  "guest-capability-fixture-secret-at-least-32";
process.env.CLERK_DELETION_WORKER_ENABLED = "false";
