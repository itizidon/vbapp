import { options, target } from "../src/feedback-processing/maintenance";
import { feedbackSources, hash } from "../src/feedback-processing/contracts";

describe("historical feedback command safety", () => {
  it("parses bounded scoped dry runs and rejects unsafe typos", () => {
    expect(
      options([
        "enqueue",
        "--dry-run",
        "--all",
        "--batch-size",
        "25",
        "--player-id",
        "00000000-0000-4000-8000-000000000001",
      ]),
    ).toMatchObject({
      dryRun: true,
      all: true,
      batchSize: 25,
      playerId: "00000000-0000-4000-8000-000000000001",
    });
    for (const args of [
      ["work", "--dry-run", "--execute"],
      ["work", "--player-id", "oops"],
      ["work", "--batch-size", "0"],
      ["work", "--plaeyr-id", "a"],
    ])
      expect(() => options(args)).toThrow();
  });
  it("blocks remote and production connections before Prisma initialization and never exposes credentials", () => {
    const local = {
      DATABASE_URL:
        "postgresql://privateuser:privatepassword@localhost:5432/sports",
    };
    const output = target(options(["status"]), local);
    expect(output.database).toBe("sports");
    expect(JSON.stringify(output)).not.toMatch(/privateuser|privatepassword/);
    expect(() =>
      target(options(["status"]), {
        DATABASE_URL: "postgresql://u:p@remote.test/prod",
      }),
    ).toThrow();
    expect(() =>
      target(options(["status"]), { ...local, APP_ENV: "production" }),
    ).toThrow();
    expect(() =>
      target(
        options(["status", "--allow-remote", "--confirm-database", "wrong"]),
        { DATABASE_URL: "postgresql://u:p@remote.test/prod" },
      ),
    ).toThrow();
    expect(() => target(options(["status"]), {})).toThrow();
  });
  it("shares stable full-comment source hashing across planning and processing", () => {
    const row = {
      overallComment: " Overall ",
      ratings: [
        { skillId: "b", comment: "Skill B" },
        { skillId: "a", comment: "Skill A" },
        { skillId: "c", comment: "  " },
      ],
    };
    expect(feedbackSources(row)).toEqual([
      { key: "overall", text: " Overall " },
      { key: "skill:a", text: "Skill A" },
      { key: "skill:b", text: "Skill B" },
    ]);
    expect(hash(feedbackSources(row))).toBe(
      hash(feedbackSources({ ...row, ratings: [...row.ratings].reverse() })),
    );
  });
});
