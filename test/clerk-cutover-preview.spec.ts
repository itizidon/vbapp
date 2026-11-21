const db = {
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  $queryRaw: jest.fn(),
  $queryRawUnsafe: jest
    .fn()
    .mockResolvedValue([{ count: 1, hash: "fixture-hash" }]),
  $executeRaw: jest.fn(),
  $executeRawUnsafe: jest.fn(),
  $transaction: jest.fn(),
};
jest.mock("@prisma/client", () => ({ PrismaClient: jest.fn(() => db) }));
import {
  main,
  identityTables,
  contentTables,
  activityTables,
  mixedTables,
} from "../src/auth/clerk/cutover";
const all = [
  ...new Set([
    ...identityTables,
    ...contentTables,
    ...activityTables,
    ...mixedTables,
  ]),
];
const saved = process.env.DATABASE_URL;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.DATABASE_URL =
    "postgresql://operator:PRIVATE_PASSWORD@database.fixture/railway";
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});
function metadata(missing: string[] = []) {
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const q = strings.join("");
    if (q.includes("to_regclass('public.\"User\"')"))
      return [{ present: true, catalog: true }];
    if (q.includes("pg_catalog.pg_tables"))
      return [
        ...all.filter((t) => !missing.includes(t)),
        "_prisma_migrations",
      ].map((name) => ({ name }));
    if (q.includes("_prisma_migrations"))
      return [{ name: "20261126000000_clerk_identity_cutover" }];
    throw Error("Unexpected query");
  });
}
it("previews a failed cutover without resolving migrations or writing to the database", async () => {
  metadata();
  await main(["--dry-run", "--allow-remote", "--allow-production"]);
  const output = jest
    .mocked(console.log)
    .mock.calls.map(([v]) => v)
    .join("\n");
  expect(output).toContain('"diagnosticsVersion":1');
  expect(output).toContain('"execute":false');
  expect(output).toContain("failedMigrations");
  expect(output).not.toContain("PRIVATE_PASSWORD");
  expect(db.$executeRaw).not.toHaveBeenCalled();
  expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(db.$disconnect).toHaveBeenCalledTimes(1);
});
it("stops before fingerprinting or mutation when historical tables are missing", async () => {
  metadata(["UserAuthProvider"]);
  await expect(
    main(["--dry-run", "--allow-remote", "--allow-production"]),
  ).rejects.toMatchObject({
    code: "MISSING_PREREQUISITE_TABLES",
    message: expect.stringContaining("UserAuthProvider"),
    details: { missingTables: ["UserAuthProvider"] },
  });
  expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(db.$disconnect).toHaveBeenCalledTimes(1);
});
it("rejects execute mode with a known failed migration before creating a permit or backup", async () => {
  metadata();
  await expect(
    main([
      "--execute",
      "--allow-remote",
      "--allow-production",
      "--confirm-database",
      "railway",
      "--backup-dir",
      "/tmp/unused-clerk-fixture",
    ]),
  ).rejects.toMatchObject({ code: "FAILED_MIGRATIONS" });
  expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
});
