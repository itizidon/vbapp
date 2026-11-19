import {
  motionMeasurementSchema,
  motionConfigSchema,
} from "../src/training/validation";
import {
  motionComparisonSchema,
  deterministicCoaching,
} from "../src/training/motion-result";
import { motionHash } from "../src/training/motion-runtime";
describe("versioned local video measurements", () => {
  it("rejects speculative unsupported automated features", () => {
    expect(
      motionMeasurementSchema.safeParse({
        version: 2,
        feature: "ball_contact",
        tolerance: 1,
        cameras: ["SIDE"],
      }).success,
    ).toBe(false);
    expect(
      motionMeasurementSchema.safeParse({
        version: 2,
        feature: "left_knee_angle",
        tolerance: 0,
        cameras: ["SIDE"],
      }).success,
    ).toBe(false);
  });
  it("validates explicit phase windows and mirror policy", () => {
    expect(
      motionConfigSchema.safeParse({
        version: 1,
        enabled: true,
        phaseWindows: [{ key: "plant", startRatio: 0.8, endRatio: 0.3 }],
      }).success,
    ).toBe(false);
    expect(
      motionConfigSchema.parse({ version: 1, enabled: true }).allowMirroring,
    ).toBe(false);
  });
  it("preserves null scores and produces an honest local explanation", () => {
    const comparison = motionComparisonSchema.parse({
      algorithmVersion: "confidence-dtw-v1",
      featureVersion: "image-plane-features-v1",
      scoreLabel: "Experimental movement similarity",
      overallSimilarity: null,
      aggregation: "Median, then weighted mean.",
      limitations: ["2D only"],
      references: [],
      checkpoints: [],
    });
    const coaching = deterministicCoaching(
      comparison,
      ["Keep the landing area clear"],
      "Balanced movement",
    );
    expect(coaching.summary).toMatch(/Not enough/);
    expect(coaching.improve).toEqual([]);
    expect(coaching.consistent).toEqual([]);
  });
  it("versions configuration changes instead of silently rewriting past results", () => {
    expect(motionHash({ version: 1, fps: 10 })).not.toEqual(
      motionHash({ version: 1, fps: 15 }),
    );
  });
});

import { motionReferenceCompatibility } from "../src/training/motion-selection";
describe("motion reference compatibility", () => {
  const versions = {
    modelVersion: "model-v1",
    extractionVersion: "extract-v1",
    featureVersion: "features-v1",
  };
  const player = {
    drillId: "drill",
    techniqueVariantId: "standard",
    cameraAngle: "SIDE",
    handedness: "RIGHT",
    allowMirroring: false,
  };
  const reference = {
    drillId: "drill",
    techniqueVariantId: "standard",
    cameraAngle: "SIDE",
    handedness: "RIGHT",
    status: "PUBLISHED",
    uploadStatus: "READY_FOR_ANALYSIS",
    qualityAcknowledgedAt: new Date(),
    checkpointIds: ["knee"],
    poseArtifacts: [versions],
  };
  const select = (p = player, r = reference, mirror = false) =>
    motionReferenceCompatibility(p, r, versions, mirror, ["knee"]);
  it("allows a quality-reviewed compatible demonstration", () =>
    expect(select().compatible).toBe(true));
  it("rejects different variants and cameras rather than scoring them", () => {
    expect(
      select(player, { ...reference, techniqueVariantId: "alternate" })
        .compatible,
    ).toBe(false);
    expect(
      select(player, { ...reference, cameraAngle: "FRONT" }).compatible,
    ).toBe(false);
  });
  it("requires both player permission and drill permission for mirroring", () => {
    const left = { ...reference, handedness: "LEFT" };
    expect(select(player, left, true).compatible).toBe(false);
    expect(
      select({ ...player, allowMirroring: true }, left, false).compatible,
    ).toBe(false);
    expect(
      select({ ...player, allowMirroring: true }, left, true).mirrored,
    ).toBe(true);
  });
  it("rejects missing coverage, unacknowledged quality and mismatched model artifacts", () => {
    expect(select(player, { ...reference, checkpointIds: [] }).compatible).toBe(
      false,
    );
    expect(
      select(player, {
        ...reference,
        qualityAcknowledgedAt: null as unknown as Date,
      }).compatible,
    ).toBe(false);
    expect(
      select(player, {
        ...reference,
        poseArtifacts: [{ ...versions, modelVersion: "old" }],
      }).compatible,
    ).toBe(false);
  });
  it("does not interpret both-handed as a known right/left execution", () =>
    expect(select({ ...player, handedness: "BOTH" }).compatible).toBe(false));
});
