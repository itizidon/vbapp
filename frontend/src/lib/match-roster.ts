import { parseTeamScore } from "./match-edit";
import type { Member } from "./types";
export interface DraftTeam {
  key: string;
  name: string;
  score?: string;
}
export interface DraftGuest {
  key: string;
  name: string;
}
export type TeamAssignments = Record<string, string>;
export function initialMatchTeams(): DraftTeam[] {
  return [
    { key: "team-1", name: "Team 1" },
    { key: "team-2", name: "Team 2" },
  ];
}
export function buildMatchRoster({
  organizerId,
  members,
  guests,
  teams,
  assignments,
}: {
  organizerId: string;
  members: Member[];
  guests: DraftGuest[];
  teams: DraftTeam[];
  assignments: TeamAssignments;
}) {
  const output = {
    memberIds: [] as string[],
    guestNames: [] as string[],
    teams: teams.map((team, index) => ({
      name: team.name.trim() || `Team ${index + 1}`,
      score: parseTeamScore(team.score ?? ""),
      memberIds: [] as string[],
      guestNames: [] as string[],
    })),
  };
  const groups = new Map(
    teams.map((team, index) => [team.key, output.teams[index]]),
  );
  function group(key: string) {
    const assigned = assignments[key];
    if (!assigned) return output;
    const target = groups.get(assigned);
    if (!target)
      throw new Error(
        "A selected team is no longer available. Choose another team.",
      );
    return target;
  }
  for (const member of [{ id: organizerId }, ...members])
    group(`member:${member.id}`).memberIds.push(member.id);
  for (const guest of guests)
    group(`guest:${guest.key}`).guestNames.push(guest.name);
  return output;
}
