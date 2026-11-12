import type { InvitedMatch } from "@/lib/invites";
export function InvitedMatchPreview({ match }: { match: InvitedMatch | null }) {
  if (!match)
    return (
      <section
        aria-label="Feedback context"
        className="rounded-xl border border-border bg-muted p-4"
      >
        <h2>General feedback</h2>
        <p className="subtle mt-2 text-sm">
          This invitation is for feedback without a specific match.
        </p>
      </section>
    );
  return (
    <section
      aria-label="Invited match"
      className="space-y-4 rounded-xl border border-border bg-muted p-4"
    >
      <div>
        <h2>Match for this feedback</h2>
        <p className="subtle mt-2 text-sm">
          {match.playedAt
            ? new Date(match.playedAt).toLocaleString()
            : "Date not recorded"}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {match.teams.map((team) => (
          <div
            key={team.teamNumber}
            className="rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <h3>Team {team.teamNumber}</h3>
              <span className="font-semibold">
                {team.score === null
                  ? "Score not recorded"
                  : `${team.score} points`}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {team.players.map((player, index) => (
                <li key={index} className="break-anywhere">
                  {player}
                </li>
              ))}
            </ul>
            {!team.players.length && (
              <p className="subtle mt-2 text-sm">No players recorded</p>
            )}
          </div>
        ))}
      </div>
      {!!match.unassignedPlayers.length && (
        <div>
          <h3>Other players</h3>
          <p className="mt-1 text-sm">{match.unassignedPlayers.join(", ")}</p>
        </div>
      )}
      <p className="subtle text-xs">
        This match is set by the invitation and cannot be changed here.
      </p>
    </section>
  );
}
