import { describe, it, expect } from "vitest";
import {
  feedbackSchema,
  validateRatings,
} from "../src/lib/validation";
describe("API-aligned validation", () => {
  it("uses the real 1–5 scale and rejects duplicate skills", () => {
    expect(validateRatings([])).toBe(false);
    expect(validateRatings([{ skillId: "a", rating: 6 }])).toBe(false);
    expect(validateRatings([{ skillId: "a", rating: 1.55 }])).toBe(false);
    expect(
      validateRatings([
        { skillId: "a", rating: 3 },
        { skillId: "a", rating: 4 },
      ]),
    ).toBe(false);
    expect(validateRatings([{ skillId: "a", rating: 5 }])).toBe(true);
  });
  it("permits optional comments and keeps consent opt-in", () => {
    expect(
      feedbackSchema.parse({
        guestName: "",
        overallComment: "",
        privateProcessingAllowed: false,
      }),
    ).toMatchObject({ privateProcessingAllowed: false });
  });
});
