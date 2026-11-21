import {
  cutoverDiagnostic,
  CutoverCheckError,
  inspectCutoverSchema,
} from "../src/auth/clerk/cutover-diagnostics";
it("identifies missing prerequisite tables without querying application records", async () => {
  const db = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([
        { name: "User" },
        { name: "Sport" },
        { name: "_prisma_migrations" },
      ])
      .mockResolvedValueOnce([
        { name: "20261126000000_clerk_identity_cutover" },
      ]),
  };
  const result = await inspectCutoverSchema(db as never, [
    "User",
    "Sport",
    "UserAuthProvider",
  ]);
  expect(result).toEqual({
    missingTables: ["UserAuthProvider"],
    failedMigrations: ["20261126000000_clerk_identity_cutover"],
  });
  for (const [query] of db.$queryRaw.mock.calls)
    expect(query.join("")).toMatch(/^SELECT /);
});
it("works before Prisma migration history exists", async () => {
  const db = {
    $queryRaw: jest.fn().mockResolvedValueOnce([{ name: "Sport" }]),
  };
  expect(await inspectCutoverSchema(db as never, ["User", "Sport"])).toEqual({
    missingTables: ["User"],
    failedMigrations: [],
  });
  expect(db.$queryRaw).toHaveBeenCalledTimes(1);
});
it("reports connectivity failures while omitting URLs, passwords, query text and stderr", () => {
  const diagnostic = cutoverDiagnostic(
    {
      errorCode: "P1001",
      message: "postgresql://private:SECRET@host/db",
      stack: "SECRET",
      stderr: "SECRET",
      meta: { message: "SECRET", database_error: "SECRET" },
    },
    "connection",
  );
  expect(diagnostic).toMatchObject({
    phase: "connection",
    code: "P1001",
    message: expect.stringContaining("unreachable"),
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(
    /SECRET|postgresql|stack|stderr/,
  );
});
it("keeps raw SQL error details private but preserves an actionable SQLSTATE", () => {
  const diagnostic = cutoverDiagnostic(
    { code: "P2010", meta: { code: "42501", message: "SECRET ROW CONTENT" } },
    "schema",
  );
  expect(diagnostic).toMatchObject({
    phase: "schema",
    code: "P2010",
    sqlState: "42501",
  });
  expect(JSON.stringify(diagnostic)).not.toContain("SECRET");
});
it("includes only explicit safe missing-table checks, never arbitrary error text", () => {
  expect(
    cutoverDiagnostic(
      new CutoverCheckError(
        "Historical schema is missing required cutover tables.",
        "MISSING_PREREQUISITE_TABLES",
        { missingTables: ["UserAuthProvider"] },
      ),
      "schema",
    ),
  ).toMatchObject({
    phase: "schema",
    code: "MISSING_PREREQUISITE_TABLES",
    missingTables: ["UserAuthProvider"],
  });
  expect(
    JSON.stringify(
      cutoverDiagnostic(new Error("SECRET CONNECTION URL"), "inventory"),
    ),
  ).not.toContain("SECRET");
});
it("explains missing backup tools without echoing subprocess arguments", () => {
  expect(
    cutoverDiagnostic(
      { code: "ENOENT", spawnargs: ["postgresql://user:SECRET@host/db"] },
      "backup",
    ),
  ).toMatchObject({
    code: "ENOENT",
    message: expect.stringContaining("pg_dump"),
  });
  expect(
    JSON.stringify(
      cutoverDiagnostic({ code: "ENOENT", spawnargs: ["SECRET"] }, "backup"),
    ),
  ).not.toContain("SECRET");
});
