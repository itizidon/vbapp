import type { Match } from "./types";
export const MATCH_FIELDS =
  "id createdById sportId playedAt description status createdAt updatedAt teams {id matchId name score teamNumber} participants {id matchId userId guestName teamId user {id username}}";
export function matchTitle(match: Match) {
  return match.description?.trim() || "Beach volleyball match";
}
export function matchDate(match: Match) {
  return match.playedAt
    ? new Date(match.playedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Date to be confirmed";
}
export function participantName(
  participant: {
    userId: string | null;
    guestName: string | null;
    user?: { username: string } | null;
  },
  me?: { id: string; username: string },
) {
  return (
    participant.guestName ||
    (participant.userId === me?.id
      ? `${me.username} (you)`
      : participant.user?.username
        ? participant.user.username
        : participant.userId
          ? `Player ${participant.userId.slice(0, 8)}`
          : "Guest")
  );
}
export function recipientMatches(matches: Match[], recipientId: string) {
  return matches.filter((match) =>
    match.participants?.some((p) => p.userId === recipientId),
  );
}
