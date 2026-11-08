import { describe, it, expect } from "vitest";
import {
  loginSchema,
  signupSchema,
  feedbackSchema,
  validateRatings,
} from "../src/lib/validation";
describe("API-aligned validation", () => {
  it("rejects empty credentials", () => {
    expect(loginSchema.safeParse({ login: "  ", password: "" }).success).toBe(
      false,
    );
  });
  it("enforces registration age, height, and password constraints", () => {
    const user = {
      username: "alex",
      email: "a@example.com",
      password: "a-long-password",
      age: 18,
      heightCm: 180,
      sportId: "11111111-1111-4111-8111-111111111111",
      overallLevel: "B",
    };
    expect(signupSchema.safeParse(user).success).toBe(true);
    for (const invalid of [
      { age: 12 },
      { heightCm: 20 },
      { password: "short" },
    ])
      expect(signupSchema.safeParse({ ...user, ...invalid }).success).toBe(
        false,
      );
  });
  it("uses the real 1–5 scale and rejects duplicate skills", () => {
    expect(validateRatings([])).toBe(false);
    expect(validateRatings([{ skillId: "a", rating: 6 }])).toBe(false);
    expect(validateRatings([{ skillId: "a", rating: 1.5 }])).toBe(false);
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
        analyticsAllowed: false,
        evidenceAllowed: false,
      }),
    ).toMatchObject({ analyticsAllowed: false, evidenceAllowed: false });
  });
});
