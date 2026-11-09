import { expect, it } from "vitest";
import { buildMatchRoster, initialMatchTeams } from "../src/lib/match-roster";
it("groups the organizer, members, and guests under their selected teams", () => {
  expect(
    buildMatchRoster({
      organizerId: "me",
      members: [{ id: "other", username: "Taylor" }],
      guests: [{ key: "guest-1", name: "Jordan" }],
      teams: initialMatchTeams(),
      assignments: {
        "member:me": "team-1",
        "member:other": "team-2",
        "guest:guest-1": "team-2",
      },
    }),
  ).toEqual({
    memberIds: [],
    guestNames: [],
    teams: [
      { name: "Team 1", score: null, memberIds: ["me"], guestNames: [] },
      {
        name: "Team 2",
        score: null,
        memberIds: ["other"],
        guestNames: ["Jordan"],
      },
    ],
  });
});
it("keeps identical guest names distinct by their local identities", () => {
  const result = buildMatchRoster({
    organizerId: "me",
    members: [],
    guests: [
      { key: "one", name: "Alex" },
      { key: "two", name: "Alex" },
    ],
    teams: initialMatchTeams(),
    assignments: { "guest:one": "team-1", "guest:two": "team-2" },
  });
  expect(result.teams.map((t) => t.guestNames)).toEqual([["Alex"], ["Alex"]]);
  expect(result.memberIds).toEqual(["me"]);
});
it("rejects stale team references rather than assigning a player incorrectly", () => {
  expect(() =>
    buildMatchRoster({
      organizerId: "me",
      members: [],
      guests: [],
      teams: [],
      assignments: { "member:me": "removed" },
    }),
  ).toThrow("no longer available");
});

it("includes recorded team scores, including zero", () => {
  const teams = initialMatchTeams().map((team, index) => ({
    ...team,
    score: index ? "21" : "0",
  }));
  const result = buildMatchRoster({
    organizerId: "me",
    members: [],
    guests: [],
    teams,
    assignments: {},
  });
  expect(result.teams.map((team) => team.score)).toEqual([0, 21]);
});
