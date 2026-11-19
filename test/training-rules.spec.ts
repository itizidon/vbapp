import { TrainingJSON } from "../src/training/dto";
import { validateConditions, evaluateRule } from "../src/training/rules";
import {
  contentJson,
  parse,
  measurementSchema,
  trainingProfileSchema,
} from "../src/training/validation";
const rule = (root: unknown) => validateConditions({ version: 1, root });
describe("deterministic training recommendation rules", () => {
  it("matches all/any and returns supporting evidence", () => {
    const r = rule({
      all: [
        { fact: "availablePartners", op: "gte", value: 1 },
        {
          any: [
            { fact: "equipment", op: "contains", value: "ball" },
            { fact: "attackReachCm", op: "gt", value: 300 },
          ],
        },
      ],
    });
    const out = evaluateRule(r.root, (f) => ({
      value:
        f.fact === "availablePartners"
          ? 1
          : f.fact === "equipment"
            ? ["ball"]
            : null,
      source: "SELF_REPORTED",
    }));
    expect(out.state).toBe("MATCH");
    expect(out.evidence.some((e) => e.state === "UNKNOWN")).toBe(true);
  });
  it.each(["eq", "neq", "gt", "gte", "lt", "lte"])(
    "never converts unknown capabilities into a result for %s",
    (op) => {
      const r = rule({ fact: "attackReachCm", op, value: 250 });
      expect(
        evaluateRule(r.root, () => ({ value: null, source: "UNKNOWN" })).state,
      ).toBe("UNKNOWN");
    },
  );
  it("distinguishes an explicit zero partners from missing data", () => {
    const r = rule({ fact: "availablePartners", op: "eq", value: 0 });
    expect(
      evaluateRule(r.root, () => ({ value: 0, source: "SELF_REPORTED" })).state,
    ).toBe("MATCH");
  });
  it("supports categorical in and known nonmatches", () => {
    const r = rule({ fact: "handedness", op: "in", value: ["LEFT", "BOTH"] });
    expect(
      evaluateRule(r.root, () => ({ value: "RIGHT", source: "SELF_REPORTED" }))
        .state,
    ).toBe("NO_MATCH");
  });
  it.each([
    { fact: "height", op: "lt", value: 170 },
    { fact: "attackReachCm", op: "eval", value: 1 },
    { fact: "attackReachCm", op: "contains", value: "x" },
    { fact: "equipment", op: "gt", value: 1 },
    { fact: "skillProgress", op: "eq", value: "CONFIDENT" },
  ])("rejects invalid facts/operators/schema %j", (root) =>
    expect(() => rule(root)).toThrow(),
  );
  it("rejects unverified evidence exclusions but allows labeled boosts", () => {
    const r = {
      version: 1,
      root: {
        fact: "feedbackThemeCount",
        key: "platform_control",
        trust: "UNVERIFIED_GUEST",
        op: "gte",
        value: 2,
      },
    };
    expect(() => validateConditions(r, "EXCLUDE")).toThrow();
    expect(validateConditions(r, "BOOST")).toMatchObject({ version: 1 });
  });
  it("bounds complexity and rejects executable or extra fields", () => {
    let root: any = { fact: "availablePartners", op: "gte", value: 1 };
    for (let n = 0; n < 6; n++) root = { all: [root] };
    expect(() => rule(root)).toThrow();
    expect(() =>
      rule({
        fact: "handedness",
        op: "eq",
        value: "LEFT",
        execute: "process.env",
      }),
    ).toThrow();
  });
  it("validates structured measurements and private capability fields", () => {
    expect(() =>
      parse(measurementSchema, {
        version: 1,
        feature: "timing",
        unit: "ms",
        min: 20,
        max: 1,
      }),
    ).toThrow();
    expect(() =>
      parse(trainingProfileSchema, { heightImpliesWeakness: true }),
    ).toThrow();
    expect(parse(trainingProfileSchema, {})).toEqual({});
    expect(() => contentJson({ constructor: {} })).toThrow();
  });
});

it("serializes optional evidence metadata as standard JSON", () => {
  const scalar = new TrainingJSON();
  expect(
    scalar.serialize({
      fact: "availablePartners",
      key: undefined,
      trust: undefined,
      value: null,
    }),
  ).toEqual({ fact: "availablePartners", value: null });
});
