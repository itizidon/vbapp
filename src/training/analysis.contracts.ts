// Internal worker contracts only. No implementation sends video/pose data to an AI provider.
export interface VideoMetadata {
  durationMs: number;
  width: number;
  height: number;
  frameRate: number;
  mimeType: string;
  bytes: number;
  cameraAngle: string;
}
export interface VideoPreprocessor {
  readonly version: string;
  probe(storageKey: string): Promise<VideoMetadata>;
  prepareFrames(
    storageKey: string,
  ): Promise<{ artifactKey: string; warnings: string[] }>;
}
export interface PoseFrame {
  timestampMs: number;
  landmarks: {
    name: string;
    x: number;
    y: number;
    z?: number;
    confidence: number;
    visibility?: number;
  }[];
  jointAngles?: Record<string, number>;
}
export interface PoseResult {
  artifactKey: string;
  modelVersion: string;
  coordinateSystem: {
    space: "NORMALIZED_IMAGE" | "WORLD";
    units: "normalized" | "meters";
    orientation: string;
  };
  frames: PoseFrame[];
  phases?: MovementPhase[];
  warnings: string[];
}
export interface PoseExtractionProvider {
  readonly modelVersion: string;
  extract(artifactKey: string): Promise<PoseResult>;
}
export interface MovementPhase {
  key: string;
  fromMs: number;
  toMs: number;
  confidence: number;
}
export interface MovementPhaseDetector {
  detect(pose: PoseResult): Promise<MovementPhase[]>;
}
export interface MotionAlignmentProvider {
  align(
    player: PoseResult,
    references: PoseResult[],
  ): Promise<{
    alignmentArtifactKey: string;
    referenceIds: string[];
    warnings: string[];
  }>;
}
export interface SelectedReference {
  id: string;
  referenceVersion: number;
  storageKey: string;
  reason: string;
}
export interface ReferenceSelectionService {
  select(input: {
    drillId: string;
    variantId?: string;
    cameraAngle: string;
    handedness?: string;
  }): Promise<SelectedReference[]>;
}
export interface TechniqueComparisonResult {
  drillId: string;
  submissionId: string;
  references: { id: string; version: number }[];
  checkpoints: {
    id: string;
    status: "EVALUATED" | "NOT_MEASURABLE";
    differences?: { metric: string; value: number; unit: string }[];
    evidenceTimestampsMs: number[];
    confidence: number | null;
    limitations: string[];
  }[];
  confidence: number | null;
  limitations: string[];
  observations: {
    skillId?: string;
    checkpointId?: string;
    description: string;
    evidenceTimestampsMs: number[];
  }[];
  suggestedSkillIds: string[];
  suggestedDrillIds: string[];
}
export interface TechniqueComparisonProvider {
  readonly version: string;
  compare(input: {
    submissionId: string;
    drillId: string;
    player: PoseResult;
    references: PoseResult[];
    checkpointSnapshot: unknown;
    alignmentArtifactKey: string;
  }): Promise<TechniqueComparisonResult>;
}
export interface VideoAnalysisOrchestrator {
  readonly analysisVersion: string;
  process(analysisId: string): Promise<TechniqueComparisonResult>;
}

// Result validation is a persistence boundary for real future workers, not an analysis implementation.
import { z } from "zod";
import { motionComparisonSchema } from "./motion-result";
const timestamp = z.number().int().nonnegative();
export const techniqueResultSchema = z
  .object({
    drillId: z.string().uuid(),
    submissionId: z.string().uuid(),
    references: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    checkpoints: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            status: z.enum(["EVALUATED", "NOT_MEASURABLE"]),
            differences: z
              .array(
                z
                  .object({
                    metric: z.string().max(100),
                    value: z.number().finite(),
                    unit: z.string().max(30),
                  })
                  .strict(),
              )
              .max(30)
              .optional(),
            evidenceTimestampsMs: z.array(timestamp).max(50),
            confidence: z.number().min(0).max(1).nullable(),
            limitations: z.array(z.string().max(500)).max(20),
          })
          .strict(),
      )
      .max(100),
    confidence: z.number().min(0).max(1).nullable(),
    limitations: z.array(z.string().max(500)).max(30),
    observations: z
      .array(
        z
          .object({
            skillId: z.string().uuid().optional(),
            checkpointId: z.string().uuid().optional(),
            description: z.string().min(1).max(1000),
            evidenceTimestampsMs: z.array(timestamp).max(50),
          })
          .strict(),
      )
      .max(100),
    playerPoseArtifactId: z.string().uuid().optional(),
    comparison: motionComparisonSchema.optional(),
    coaching: z
      .object({
        source: z.enum(["DETERMINISTIC", "OPENAI_CURATED_SELECTION"]),
        summary: z.string().max(1000),
        consistent: z
          .array(
            z.object({
              checkpointId: z.string().uuid(),
              text: z.string().max(5000),
            }),
          )
          .max(100),
        improve: z
          .array(
            z.object({
              checkpointId: z.string().uuid(),
              text: z.string().max(5000),
              why: z.string().max(1000),
            }),
          )
          .max(3),
        practice: z.array(z.string().max(2000)).max(3),
        objective: z.string().max(5000),
        limitations: z.array(z.string().max(1000)).max(30),
      })
      .strict()
      .optional(),
    selection: z
      .array(
        z.object({
          referenceVideoId: z.string().uuid(),
          reason: z.string().max(200),
          compatible: z.boolean(),
        }),
      )
      .max(100)
      .optional(),
    suggestedSkillIds: z.array(z.string().uuid()).max(20),
    suggestedDrillIds: z.array(z.string().uuid()).max(20),
  })
  .strict();
