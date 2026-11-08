import { it, expect } from "vitest";
import {
  recipientMatches,
  matchDate,
  participantName,
} from "../src/lib/matches";
import type { Match } from "../src/lib/types";
const match = (id: string, userId: string): Match => ({
  id,
  createdById: "organizer",
  sportId: null,
  playedAt: null,
  description: null,
  status: "DRAFT",
  createdAt: "2026-11-08",
  updatedAt: "2026-11-08",
  teams: [],
  participants: [
    { id: "p", matchId: id, userId, guestName: null, teamId: null },
  ],
});
it("only offers recipient matches from an already-authorized list", () => {
  expect(
    recipientMatches(
      [match("one", "recipient"), match("two", "other")],
      "recipient",
    ).map((m) => m.id),
  ).toEqual(["one"]);
});
it("handles missing dates and avoids inventing registered player names", () => {
  expect(matchDate(match("one", "recipient"))).toBe("Date to be confirmed");
  expect(participantName({ userId: "12345678-rest", guestName: null })).toBe(
    "Player 12345678",
  );
  expect(
    participantName(
      { userId: "me", guestName: null },
      { id: "me", username: "Alex" },
    ),
  ).toBe("Alex (you)");
});
