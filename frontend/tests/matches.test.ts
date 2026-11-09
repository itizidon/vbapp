import { it, expect } from "vitest";
import {
  recipientMatches,
  matchDate,
  participantName,
  teamResult,
  playerMatchResult,
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

it("identifies winners and losers while preserving zero scores", () => {
  const teams = [{ score: 0 }, { score: 21 }];
  expect(teamResult(teams[0], teams)).toBe("Loss");
  expect(teamResult(teams[1], teams)).toBe("Win");
});
it.each([[21, 21], [0, 0], [21, null], [null, null], [21]])(
  "keeps tied, incomplete, and single-team scores neutral: %j",
  (...scores) => {
    const teams = scores.map((score) => ({ score }));
    for (const team of teams) expect(teamResult(team, teams)).toBeNull();
  },
);

it("uses the logged-in player's team rather than the organizer for card results", () => {
  const game = match("one", "player");
  game.teams = [
    { id: "t1", matchId: game.id, name: null, teamNumber: 1, score: 0 },
    { id: "t2", matchId: game.id, name: null, teamNumber: 2, score: 21 },
  ];
  game.participants![0].teamId = "t1";
  expect(playerMatchResult(game, "player")).toBe("Loss");
  expect(playerMatchResult(game, "organizer")).toBeNull();
  expect(playerMatchResult(game)).toBeNull();
  game.participants![0].teamId = "t2";
  expect(playerMatchResult(game, "player")).toBe("Win");
  game.teams[0].score = 21;
  expect(playerMatchResult(game, "player")).toBeNull();
  game.teams[0].score = null;
  expect(playerMatchResult(game, "player")).toBeNull();
  game.participants![0].teamId = null;
  expect(playerMatchResult(game, "player")).toBeNull();
});
