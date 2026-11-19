import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
export const trainingFacts = [
  "overallLevel",
  "selfAssessment",
  "skillProgress",
  "feedbackThemeCount",
  "reportedDifficulty",
  "attackReachCm",
  "standingReachCm",
  "jumpReachCm",
  "handedness",
  "availablePartners",
  "equipment",
  "completedDrill",
] as const;
export type RuleState = "MATCH" | "NO_MATCH" | "UNKNOWN";
export type FactEvidence = {
  value: string | number | boolean | string[] | null;
  source: string;
  trust?: string;
};
export type RuleNode =
  | { all: RuleNode[] }
  | { any: RuleNode[] }
  | {
      fact: (typeof trainingFacts)[number];
      key?: string;
      trust?:
        "VERIFIED_APPROVED" | "UNVERIFIED_GUEST" | "AWAITING_REVIEWER_APPROVAL";
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
      value: string | number | boolean | string[];
    };
const leaf = z
  .object({
    fact: z.enum(trainingFacts),
    key: z.string().min(1).max(100).optional(),
    trust: z
      .enum([
        "VERIFIED_APPROVED",
        "UNVERIFIED_GUEST",
        "AWAITING_REVIEWER_APPROVAL",
      ])
      .optional(),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]),
    value: z.union([
      z.string().max(120),
      z.number().finite(),
      z.boolean(),
      z.array(z.string().max(120)).max(30),
    ]),
  })
  .strict();
const node: z.ZodType<RuleNode> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(node).min(1).max(12) }).strict(),
    z.object({ any: z.array(node).min(1).max(12) }).strict(),
    leaf,
  ]),
);
const schema = z.object({ version: z.literal(1), root: node }).strict();
export function validateConditions(
  value: unknown,
  effect?: string,
): { version: 1; root: RuleNode } {
  let n = 0;
  const bound = (x: any, d: number) => {
    if (++n > 40 || d > 4)
      throw new BadRequestException("Rule complexity exceeded");
    if (x && typeof x === "object") {
      if (Array.isArray(x.all)) x.all.forEach((r: any) => bound(r, d + 1));
      if (Array.isArray(x.any)) x.any.forEach((r: any) => bound(r, d + 1));
    }
  };
  bound((value as any)?.root, 0);
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException("Invalid rule schema");
  const check = (r: RuleNode) => {
    if ("all" in r) return r.all.forEach(check);
    if ("any" in r) return r.any.forEach(check);
    const numeric = [
      "selfAssessment",
      "feedbackThemeCount",
      "attackReachCm",
      "standingReachCm",
      "jumpReachCm",
      "availablePartners",
    ].includes(r.fact);
    const list = ["equipment", "reportedDifficulty"].includes(r.fact);
    const bool = r.fact === "completedDrill";
    if (
      [
        "selfAssessment",
        "skillProgress",
        "feedbackThemeCount",
        "completedDrill",
      ].includes(r.fact) &&
      !r.key
    )
      throw new BadRequestException("Rule fact requires a key");
    if (r.trust && r.fact !== "feedbackThemeCount")
      throw new BadRequestException("Trust applies only to feedback facts");
    if (
      numeric &&
      (!["eq", "neq", "gt", "gte", "lt", "lte"].includes(r.op) ||
        typeof r.value !== "number")
    )
      throw new BadRequestException("Invalid numeric fact operator");
    if (list && (r.op !== "contains" || typeof r.value !== "string"))
      throw new BadRequestException("List facts support contains");
    if (bool && (!["eq", "neq"].includes(r.op) || typeof r.value !== "boolean"))
      throw new BadRequestException("Completion fact requires a boolean");
    if (
      !numeric &&
      !list &&
      !bool &&
      (!["eq", "neq", "in"].includes(r.op) ||
        (r.op === "in" ? !Array.isArray(r.value) : typeof r.value !== "string"))
    )
      throw new BadRequestException("Invalid categorical fact operator");
    if (
      effect === "EXCLUDE" &&
      r.fact === "feedbackThemeCount" &&
      r.trust &&
      r.trust !== "VERIFIED_APPROVED"
    )
      throw new BadRequestException(
        "Unverified feedback cannot exclude a drill",
      );
  };
  check(parsed.data.root);
  return parsed.data;
}
export function evaluateRule(
  root: RuleNode,
  lookup: (leaf: Extract<RuleNode, { fact: unknown }>) => FactEvidence,
) {
  const evidence: {
    fact: string;
    key?: string;
    value: unknown;
    source: string;
    trust?: string;
    state: RuleState;
  }[] = [];
  const visit = (r: RuleNode): RuleState => {
    if ("all" in r) {
      const s = r.all.map(visit);
      return s.includes("NO_MATCH")
        ? "NO_MATCH"
        : s.includes("UNKNOWN")
          ? "UNKNOWN"
          : "MATCH";
    }
    if ("any" in r) {
      const s = r.any.map(visit);
      return s.includes("MATCH")
        ? "MATCH"
        : s.includes("UNKNOWN")
          ? "UNKNOWN"
          : "NO_MATCH";
    }
    const fact = lookup(r);
    let state: RuleState = "UNKNOWN";
    const v = fact.value;
    if (v !== null && v !== undefined) {
      let matches = false;
      switch (r.op) {
        case "eq":
          matches = v === r.value;
          break;
        case "neq":
          matches = v !== r.value;
          break;
        case "contains":
          matches = Array.isArray(v) && v.includes(r.value as string);
          break;
        case "in":
          matches = Array.isArray(r.value) && r.value.includes(v as string);
          break;
        case "gt":
          matches = typeof v === "number" && v > (r.value as number);
          break;
        case "gte":
          matches = typeof v === "number" && v >= (r.value as number);
          break;
        case "lt":
          matches = typeof v === "number" && v < (r.value as number);
          break;
        case "lte":
          matches = typeof v === "number" && v <= (r.value as number);
          break;
      }
      state = matches ? "MATCH" : "NO_MATCH";
    }
    evidence.push({
      fact: r.fact,
      key: r.key,
      value: v,
      source: fact.source,
      trust: fact.trust,
      state,
    });
    return state;
  };
  const state = visit(root);
  return {
    state,
    evidence,
    reason:
      state === "UNKNOWN"
        ? "Required player information is unknown"
        : state === "MATCH"
          ? "Structured conditions matched"
          : "Structured conditions did not match",
  };
}
