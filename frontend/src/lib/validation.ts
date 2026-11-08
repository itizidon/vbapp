import { z } from "zod";
export const loginSchema = z.object({
  login: z.string().trim().min(1, "Enter your email or username"),
  password: z.string().min(1, "Enter your password"),
});
export const signupSchema = z.object({
  username: z.string().trim().min(3).max(40),
  email: z.email(),
  password: z.string().min(12, "Use at least 12 characters"),
  age: z.number().int().min(13).max(120),
  heightCm: z.number().int().min(50).max(300),
  sportId: z.uuid(),
  overallLevel: z.string().min(1),
});
export const feedbackSchema = z.object({
  overallComment: z.string().max(5000),
  guestName: z.string().max(100),
  analyticsAllowed: z.boolean(),
  evidenceAllowed: z.boolean(),
});
export function validateRatings(
  ratings: { skillId: string; rating: number }[],
) {
  return (
    ratings.length > 0 &&
    ratings.every(
      (r) => Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5,
    ) &&
    new Set(ratings.map((r) => r.skillId)).size === ratings.length
  );
}
