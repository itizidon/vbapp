import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createVerifiedBackup } from "../src/auth/clerk/cutover-backup";
import {
  prerequisitePlan,
  prepareHistoricalSchema,
  PREREQUISITE_MIGRATIONS,
  CLERK_CUTOVER,
} from "../src/auth/clerk/cutover-prerequisites";
jest.mock("node:child_process", () => ({ execFileSync: jest.fn() }));
jest.mock("../src/auth/clerk/cutover-backup", () => ({
  ...jest.requireActual("../src/auth/clerk/cutover-backup"),
  createVerifiedBackup: jest.fn(),
}));
const baseline = readdirSync("prisma/migrations").filter(
  (name) => /^\d{14}_/.test(name) && name < PREREQUISITE_MIGRATIONS[0],
);
const expected = ["User", "Sport", "UserAuthProvider"];
const url = new URL(
  "postgresql://operator:PRIVATE_PASSWORD@database.fixture/railway",
);
function database(applied = baseline) {
  const db: any = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const q = strings.join("");
      if (q.includes("finished_at IS NOT NULL"))
        return applied.map((name) => ({ name }));
      if (q.includes("pg_catalog"))
        return [...expected, "_prisma_migrations"].map((name) => ({ name }));
      if (q.includes("finished_at IS NULL")) return [];
      throw Error("Unexpected query");
    }),
    $queryRawUnsafe: jest
      .fn()
      .mockResolvedValue([{ count: 1, hash: "unchanged" }]),
    $executeRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(),
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  return db;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.mocked(createVerifiedBackup).mockResolvedValue({
    backup: "/tmp/fixture.dump",
    manifest: "/tmp/fixture.json",
    snapshot: {
      User: { count: 1, hash: "unchanged" },
      Sport: { count: 1, hash: "unchanged" },
    },
  });
});
afterEach(() => jest.restoreAllMocks());
it("plans precisely the six prerequisites missing from the confirmed production migration history", async () => {
  expect(await prerequisitePlan(database())).toEqual(PREREQUISITE_MIGRATIONS);
});
it("still supports the five-migration path when AI eligibility is already installed", async () => {
  expect(
    await prerequisitePlan(database([...baseline, PREREQUISITE_MIGRATIONS[0]])),
  ).toEqual(PREREQUISITE_MIGRATIONS.slice(1));
});
it("rejects an older baseline rather than silently applying unrelated history", async () => {
  await expect(
    prerequisitePlan(
      database(
        baseline.filter(
          (name) => name !== "20261120000000_decimal_feedback_ratings",
        ),
      ),
    ),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_PREREQUISITE_BASELINE" });
});
it("previews prerequisites without backup, migration subprocesses or database writes", async () => {
  const db = database();
  await prepareHistoricalSchema(
    db,
    url,
    expected,
    { missingTables: ["UserAuthProvider"], failedMigrations: [] },
    { execute: false },
  );
  expect(createVerifiedBackup).not.toHaveBeenCalled();
  expect(execFileSync).not.toHaveBeenCalled();
  expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(jest.mocked(console.log).mock.calls[0][0]).toContain(
    "Clerk identity reset is excluded",
  );
});
it("blocks unresolved failures before attempting prerequisite preparation", async () => {
  await expect(
    prepareHistoricalSchema(
      database(),
      url,
      expected,
      {
        missingTables: ["UserAuthProvider"],
        failedMigrations: [CLERK_CUTOVER],
      },
      { execute: true, backupDir: "/tmp/unused" },
    ),
  ).rejects.toMatchObject({ code: "FAILED_MIGRATIONS" });
  expect(createVerifiedBackup).not.toHaveBeenCalled();
});
it("rejects schema drift when migration history claims missing tables already exist", async () => {
  await expect(
    prepareHistoricalSchema(
      database([...baseline, ...PREREQUISITE_MIGRATIONS]),
      url,
      expected,
      { missingTables: ["UserAuthProvider"], failedMigrations: [] },
      { execute: false },
    ),
  ).rejects.toMatchObject({ code: "PREREQUISITE_SCHEMA_DRIFT" });
});
it("requires a backup directory and successfully verified backup before any migration", async () => {
  await expect(
    prepareHistoricalSchema(
      database(),
      url,
      expected,
      { missingTables: ["UserAuthProvider"], failedMigrations: [] },
      { execute: true },
    ),
  ).rejects.toMatchObject({ code: "BACKUP_REQUIRED" });
  jest
    .mocked(createVerifiedBackup)
    .mockRejectedValueOnce(new Error("Backup failed"));
  await expect(
    prepareHistoricalSchema(
      database(),
      url,
      expected,
      { missingTables: ["UserAuthProvider"], failedMigrations: [] },
      { execute: true, backupDir: "/tmp/unused" },
    ),
  ).rejects.toThrow("Backup failed");
  expect(execFileSync).not.toHaveBeenCalled();
});
it("creates a backup without an identity-reset permit and excludes the Clerk migration from the deploy tree", async () => {
  const db = database();
  jest.mocked(execFileSync).mockImplementationOnce(((...args: any[]) => {
    const argv = args[1] as string[];
    const schema = argv[argv.indexOf("--schema") + 1];
    const names = readdirSync(join(dirname(schema), "migrations"));
    expect(names).not.toContain(CLERK_CUTOVER);
    for (const name of PREREQUISITE_MIGRATIONS) expect(names).toContain(name);
    return Buffer.alloc(0);
  }) as never);
  await prepareHistoricalSchema(
    db,
    url,
    expected,
    { missingTables: ["UserAuthProvider"], failedMigrations: [] },
    { execute: true, backupDir: "/tmp/unused" },
  );
  expect(createVerifiedBackup).toHaveBeenCalledWith(
    db,
    url,
    "/tmp/unused",
    ["User", "Sport"],
    expect.objectContaining({
      authorizeCutover: false,
      purpose: "clerk-prerequisites",
    }),
  );
  expect(execFileSync).toHaveBeenCalledTimes(1);
  expect(db.$executeRaw).not.toHaveBeenCalled();
  for (const [sql] of db.$executeRawUnsafe.mock.calls)
    expect(sql).toBe("SET LOCAL TIME ZONE 'UTC'");
  expect(jest.mocked(console.log).mock.calls.at(-1)![0]).toContain(
    '"cutoverExecuted":false',
  );
});
it("aborts if source records change after backup", async () => {
  const db = database();
  jest.mocked(createVerifiedBackup).mockResolvedValueOnce({
    backup: "/tmp/fixture.dump",
    manifest: "/tmp/fixture.json",
    snapshot: {
      User: { count: 1, hash: "older" },
      Sport: { count: 1, hash: "unchanged" },
    },
  });
  await expect(
    prepareHistoricalSchema(
      db,
      url,
      expected,
      { missingTables: ["UserAuthProvider"], failedMigrations: [] },
      { execute: true, backupDir: "/tmp/unused" },
    ),
  ).rejects.toMatchObject({ code: "SOURCE_CHANGED_AFTER_BACKUP" });
  expect(execFileSync).not.toHaveBeenCalled();
});
