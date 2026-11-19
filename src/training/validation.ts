import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
export function contentJson(value: unknown) {
  let count = 0;
  const walk = (v: unknown, d: number) => {
    if (++count > 2000 || d > 8)
      throw new BadRequestException("Structured content is too complex");
    if (v === null || typeof v === "boolean" || typeof v === "string") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, d + 1));
      return;
    }
    if (typeof v === "object" && v) {
      for (const [k, x] of Object.entries(v)) {
        if (["__proto__", "prototype", "constructor"].includes(k))
          throw new BadRequestException("Invalid content key");
        walk(x, d + 1);
      }
      return;
    }
    throw new BadRequestException("Invalid structured content");
  };
  walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > 100000)
    throw new BadRequestException("Structured content is too large");
  return value;
}
const legacyMeasurementSchema = z
  .object({
    version: z.literal(1),
    feature: z.enum(["joint_angle", "timing", "accuracy", "movement_feature"]),
    unit: z.enum(["degrees", "ms", "ratio", "normalized"]),
    phaseKey: z.string().max(80).optional(),
    landmarks: z.array(z.string().max(80)).max(8).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .strict()
  .refine(
    (v) => v.min === undefined || v.max === undefined || v.min <= v.max,
    "Invalid measurement range",
  );
export const motionMeasurementSchema = z
  .object({
    version: z.literal(2),
    feature: z.enum([
      "left_elbow_angle",
      "right_elbow_angle",
      "left_knee_angle",
      "right_knee_angle",
      "trunk_inclination",
      "platform_wrist_height",
    ]),
    tolerance: z.number().positive().max(180),
    cameras: z
      .array(z.enum(["SIDE", "FRONT", "REAR", "OBLIQUE"]))
      .min(1)
      .max(4),
    minConfidence: z.number().min(0.5).max(0.95).optional(),
    phaseKey: z.string().max(80).optional(),
    phaseWindow: z
      .object({
        startRatio: z.number().min(0).max(1),
        endRatio: z.number().min(0).max(1),
      })
      .strict()
      .refine((v) => v.startRatio < v.endRatio)
      .optional(),
  })
  .strict();
export const measurementSchema = z.union([
  legacyMeasurementSchema,
  motionMeasurementSchema,
]);
export const motionConfigSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    allowMirroring: z.boolean().default(false),
    phaseWindows: z
      .array(
        z
          .object({
            key: z.string().min(1).max(80),
            startRatio: z.number().min(0).max(1),
            endRatio: z.number().min(0).max(1),
          })
          .strict()
          .refine((v) => v.startRatio < v.endRatio),
      )
      .max(20)
      .default([]),
  })
  .strict();
export const trainingProfileSchema = z
  .object({
    handedness: z.enum(["LEFT", "RIGHT", "BOTH"]).optional(),
    attackReachCm: z.number().min(50).max(450).optional(),
    standingReachCm: z.number().min(50).max(350).optional(),
    jumpReachCm: z.number().min(50).max(450).optional(),
    availablePartners: z.number().int().min(0).max(50).optional(),
    equipment: z.array(z.string().min(1).max(80)).max(30).optional(),
    reportedDifficulties: z.array(z.string().min(1).max(80)).max(30).optional(),
  })
  .strict();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException("Invalid structured configuration");
  return result.data;
}

// GraphQL list arguments do not automatically validate each item as a DTO.
export function checkedInput<T extends object>(
  type: new () => T,
  value: unknown,
): T {
  const { plainToInstance } =
    require("class-transformer") as typeof import("class-transformer");
  const { validateSync } =
    require("class-validator") as typeof import("class-validator");
  const result = plainToInstance(type, value);
  if (
    validateSync(result, { whitelist: true, forbidNonWhitelisted: true }).length
  )
    throw new BadRequestException("Invalid training input");
  return result;
}
