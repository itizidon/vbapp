export interface InvitedMatch {
  id: string;
  playedAt: string | null;
  teams: { teamNumber: number; score: number | null; players: string[] }[];
  unassignedPlayers: string[];
}
