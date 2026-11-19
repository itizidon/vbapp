import { z } from "zod";
const score = z.number().finite().min(0).max(100).nullable();
const quality = z.number().finite().min(0).max(1).nullable();
const evidence = z
  .object({
    playerMs: z.number().int().nonnegative(),
    referenceMs: z.number().int().nonnegative(),
    playerValue: z.number().finite(),
    referenceValue: z.number().finite(),
    difference: z.number().finite(),
    quality: z.number().min(0).max(1),
    referenceVideoId: z.string().uuid(),
    feature: z.string().max(80),
    unit: z.string().max(30),
  })
  .strict();
const timestamp = z
  .object({
    playerMs: z.number().int().nonnegative(),
    referenceMs: z.number().int().nonnegative(),
  })
  .strict();
export const motionComparisonSchema = z
  .object({
    algorithmVersion: z.string().max(100),
    featureVersion: z.string().max(100),
    scoreLabel: z.literal("Experimental movement similarity"),
    aggregation: z.string().max(1000),
    overallSimilarity: score,
    limitations: z.array(z.string().max(1000)).max(30),
    references: z
      .array(
        z
          .object({
            referenceVideoId: z.string().uuid(),
            referenceVersion: z.number().int().positive(),
            poseArtifactId: z.string().uuid(),
            similarity: score,
            evaluatedCheckpoints: z.number().int().nonnegative(),
            mirrored: z.boolean(),
            timestampMap: z.array(timestamp).max(1200),
            alignmentAvailable: z.boolean(),
          })
          .strict(),
      )
      .max(5),
    checkpoints: z
      .array(
        z
          .object({
            checkpointId: z.string().uuid(),
            name: z.string().max(120),
            status: z.enum(["EVALUATED", "NOT_SUPPORTED", "INSUFFICIENT_DATA"]),
            similarity: score,
            quality,
            evidence: z.array(evidence).max(5),
            explanation: z.string().max(5000),
            limitations: z.array(z.string().max(1000)).max(20),
            perReference: z
              .array(
                z
                  .object({
                    referenceVideoId: z.string().uuid(),
                    similarity: score,
                    medianAbsoluteDifference: z.number().finite().nonnegative(),
                    unit: z.string().max(30),
                    sampleCount: z.number().int().positive(),
                    mirrored: z.boolean(),
                    alignmentQuality: z
                      .object({
                        normalizedDistance: z.number().finite().nonnegative(),
                        playerCoverage: z.number().min(0).max(1),
                        warpFraction: z.number().min(0).max(1),
                      })
                      .strict(),
                  })
                  .strict(),
              )
              .max(5),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type MotionComparison = z.infer<typeof motionComparisonSchema>;
export function deterministicCoaching(
  comparison: MotionComparison,
  cues: string[],
  objective: string,
) {
  const evaluated = comparison.checkpoints.filter(
    (c) => c.status === "EVALUATED",
  );
  return {
    source: "DETERMINISTIC",
    summary: evaluated.length
      ? `${evaluated.length} projected movement checkpoints compared. Differences describe similarity, not whether your technique is correct.`
      : "Not enough reliable measurements to compare this attempt.",
    consistent: evaluated
      .filter((c) => (c.similarity ?? 0) >= 75)
      .map((c) => ({
        checkpointId: c.checkpointId,
        text: `${c.name}: tracked differences were within this checkpoint's configured similarity tolerance.`,
      })),
    improve: evaluated
      .filter((c) => (c.similarity ?? 0) < 75)
      .sort((a, b) => (a.similarity ?? 0) - (b.similarity ?? 0))
      .slice(0, 3)
      .map((c) => ({
        checkpointId: c.checkpointId,
        text:
          c.explanation ||
          `Review the aligned moments for ${c.name} with a coach before changing your technique.`,
        why: "A measured difference alone does not establish an error or its cause.",
      })),
    practice: cues.slice(0, 3),
    objective,
    limitations: comparison.limitations,
  };
}
