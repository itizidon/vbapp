import { z } from "zod";
export const isClerkUserId = (id: unknown): id is string =>
  typeof id === "string" && /^user_[A-Za-z0-9]{8,128}$/.test(id);
export const roleSchema = z.enum(["PLAYER", "COACH", "ADMIN"]);
export const ratingSchema = z
  .object({ skillId: z.uuid(), rating: z.number().int().min(1).max(5) })
  .strict();
export const assessmentSchema = z
  .object({
    id: z.uuid(),
    sportId: z.uuid(),
    overallLevel: z.enum(["B", "BB", "A", "AA", "OPEN"]),
    ratings: z.array(ratingSchema).min(1).max(10),
    revision: z.uuid(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const privatePlayerSchema = z
  .object({
    version: z.literal(1),
    role: roleSchema.default("PLAYER"),
    age: z.number().int().min(13).max(120).optional(),
    heightCm: z.number().int().min(50).max(300).optional(),
    assessment: assessmentSchema.optional(),
    aiCoachingEnabled: z.boolean().default(false),
    trainingPreferences: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type PlayerMetadata = z.infer<typeof privatePlayerSchema>;
export const publicPlayerSchema = z
  .object({
    version: z.literal(1),
    isPublic: z.boolean().default(false),
    onboardingComplete: z.boolean().default(false),
  })
  .strict();
export function privatePlayer(user: {
  privateMetadata: Record<string, unknown>;
}): PlayerMetadata {
  const parsed = privatePlayerSchema.safeParse(user.privateMetadata.bvbtips);
  return parsed.success
    ? parsed.data
    : { version: 1, role: "PLAYER", aiCoachingEnabled: false };
}
export function publicPlayer(user: {
  publicMetadata: Record<string, unknown>;
}) {
  const parsed = publicPlayerSchema.safeParse(user.publicMetadata.bvbtips);
  return parsed.success
    ? parsed.data
    : { version: 1 as const, isPublic: false, onboardingComplete: false };
}
