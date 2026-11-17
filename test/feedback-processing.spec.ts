import {
  embeddingDocument,
  extractionSchema,
  hash,
  ProcessingError,
  validateExtraction,
  validateVector,
} from "../src/feedback-processing/contracts";
const input = {
  sources: [
    { key: "overall", text: "Your passing platform is steady. Talk earlier." },
  ],
  skillSlugs: ["passing"],
  themes: [
    {
      id: "platform_control",
      name: "Platform control",
      skillSlugs: ["passing"],
    },
    { id: "communication", name: "Communication", skillSlugs: [] },
  ],
};
const row = {
  sourceKey: "overall",
  skill: "passing",
  theme: "platform_control",
  sentiment: "positive",
  evidence: "passing platform is steady",
};
describe("feedback processing contracts", () => {
  it("accepts exact evidence, multiple observations, neutral and negative sports feedback", () => {
    const output = validateExtraction(
      {
        moderation: "ALLOW",
        observations: [
          row,
          {
            ...row,
            skill: null,
            theme: "communication",
            sentiment: "negative",
            evidence: "Talk earlier.",
          },
        ],
      },
      input,
    );
    expect(output.observations).toHaveLength(2);
    expect(
      extractionSchema.parse({ moderation: "ALLOW", observations: [] })
        .observations,
    ).toEqual([]);
  });
  it("rejects invented evidence and source identities", () => {
    for (const change of [
      { evidence: "excellent passing" },
      { sourceKey: "other" },
    ]) {
      expect(() =>
        validateExtraction(
          { moderation: "ALLOW", observations: [{ ...row, ...change }] },
          input,
        ),
      ).toThrow("INVALID_EVIDENCE");
    }
  });
  it("enforces taxonomy and sport skill scope, deduplicating exact repeats", () => {
    expect(() =>
      validateExtraction(
        { moderation: "ALLOW", observations: [{ ...row, skill: "setting" }] },
        input,
      ),
    ).toThrow("INVALID_SKILL");
    expect(() =>
      validateExtraction(
        { moderation: "ALLOW", observations: [{ ...row, skill: null }] },
        input,
      ),
    ).toThrow("INVALID_THEME_SKILL");
    const result = validateExtraction(
      {
        moderation: "ALLOW",
        observations: [row, row, { ...row, theme: "unknown_theme" }],
      },
      input,
    );
    expect(result.observations).toHaveLength(1);
    expect(result.unknownThemes).toEqual(["unknown_theme"]);
  });
  it("rejects invalid structured output and arbitrary sentiment", () => {
    expect(() => validateExtraction({}, input)).toThrow(ProcessingError);
    expect(() =>
      validateExtraction(
        { moderation: "ALLOW", observations: [{ ...row, sentiment: "bad" }] },
        input,
      ),
    ).toThrow("INVALID_EXTRACTION");
  });
  it("validates dimensions, finite and nonzero vectors", () => {
    for (const v of [[0, 0], [Infinity, 1], [NaN, 1], [1]])
      expect(() => validateVector(v, 2)).toThrow("INVALID_EMBEDDING");
    expect(validateVector([0.1, -0.2], 2)).toEqual([0.1, -0.2]);
  });
  it("contextualizes embeddings deterministically", () => {
    const document = embeddingDocument({
      evidence: "Talk earlier.",
      sentiment: "negative",
      theme: input.themes[1],
    });
    expect(document).toContain("Communication");
    expect(document).toContain("Skill: general");
    expect(hash(document)).toEqual(hash(document));
  });
});
