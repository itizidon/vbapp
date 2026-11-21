import { isFeedbackRating } from "./feedback-rating";
import { z } from "zod";
export const feedbackSchema = z.object({
  overallComment: z.string().max(5000),
  guestName: z.string().max(100),
  privateProcessingAllowed: z.boolean(),
});
export function validateRatings(
  ratings: { skillId: string; rating: number }[],
) {
  return (
    ratings.length > 0 &&
    ratings.every(
      (r) => isFeedbackRating(r.rating),
    ) &&
    new Set(ratings.map((r) => r.skillId)).size === ratings.length
  );
}
