"use client";
import { PlayerSkillRadarChart } from "./player-skill-radar-chart";
import { useQuery } from "@tanstack/react-query";
import { gql } from "@/lib/api";
import type { Assessment, Sport } from "@/lib/types";
import { ErrorState, LoadingSkeleton, RatingStars } from "./common";
interface InternalRatingSummary {
  overallRating: number | null;
  ratedSkillCount: number;
  totalSkillCount: number;
  ratings: { skillId: string; currentRating: number; feedbackCount: number }[];
}
export function SelfSkillRatings({
  sport,
  assessment,
}: {
  sport: Sport;
  assessment?: Assessment;
}) {
  return (
    <div className="mb-5 space-y-4">
      <PlayerSkillRadarChart
        mode="self"
        allowCompare={false}
        data={sport.skills
          .filter((skill) => skill.active)
          .map((skill) => ({
            skillId: skill.id,
            skillName: skill.name,
            skillSlug: skill.slug,
            selfRating:
              assessment?.ratings.find((r) => r.skillId === skill.id)?.rating ??
              null,
            internalRating: null,
            averageFeedbackRating: null,
          }))}
      />
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{sport.name} self ratings</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="p-2">
              Skill
            </th>
            <th scope="col" className="p-2 text-right">
              Self rating
            </th>
          </tr>
        </thead>
        <tbody>
          {sport.skills
            .filter((skill) => skill.active)
            .map((skill) => {
              const rating = assessment?.ratings.find(
                (r) => r.skillId === skill.id,
              );
              return (
                <tr
                  key={skill.id}
                  className="border-b border-border last:border-0"
                >
                  <th scope="row" className="break-anywhere p-2 font-medium">
                    {skill.name}
                  </th>
                  <td className="p-2 text-right">
                    {rating ? (
                      <div className="space-y-1">
                        <p>{rating.rating} / 5</p>
                        <RatingStars value={rating.rating} />
                      </div>
                    ) : (
                      <span className="subtle">Unrated</span>
                    )}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
export function InternalRatingCard({
  userId,
  sport,
  assessment,
}: {
  userId: string;
  sport: Sport;
  assessment?: Assessment;
}) {
  const internal = useQuery({
    queryKey: ["internal-ratings", userId, sport.id, "summary"],
    queryFn: () =>
      gql<{ internalRatingSummary: InternalRatingSummary }>(
        `query ProfileInternalRatingSummary($userId:ID!,$sportId:ID!){internalRatingSummary(userId:$userId,sportId:$sportId){overallRating ratedSkillCount totalSkillCount ratings{skillId currentRating feedbackCount}}}`,
        { userId, sportId: sport.id },
      ),
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const data = internal.data?.internalRatingSummary;
  return (
    <section className="panel min-w-0 space-y-4" aria-label="Internal rating">
      <div>
        <h2>Internal rating</h2>
        <p className="subtle mt-1 text-sm">{sport.name}</p>
      </div>
      {internal.isPending ? (
        <LoadingSkeleton />
      ) : internal.error ? (
        <ErrorState error={internal.error} retry={() => internal.refetch()} />
      ) : (
        <>
          <div
            className="rounded-xl bg-muted p-4"
            aria-label="Overall internal rating"
          >
            <p className="subtle text-sm">Overall rating</p>
            <p className="mt-2 text-3xl font-bold tabular-nums">
              {data?.overallRating == null
                ? "Unrated"
                : `${data.overallRating.toFixed(4)} / 5`}
            </p>
            <p className="subtle mt-2 text-xs">
              {data?.ratedSkillCount ?? 0} of {data?.totalSkillCount ?? 0}{" "}
              skills rated
            </p>
          </div>
          <p className="subtle text-xs">
            Overall rating is the average of your rated skills. Unrated skills
            are excluded.
          </p>
          <PlayerSkillRadarChart
            mode="internal"
            data={sport.skills
              .filter((skill) => skill.active)
              .map((skill) => ({
                skillId: skill.id,
                skillName: skill.name,
                skillSlug: skill.slug,
                selfRating:
                  assessment?.ratings.find((r) => r.skillId === skill.id)
                    ?.rating ?? null,
                internalRating:
                  data?.ratings.find((r) => r.skillId === skill.id)
                    ?.currentRating ?? null,
                averageFeedbackRating: null,
              }))}
          />
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {sport.name} internal skill ratings
            </caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="p-2">
                  Skill
                </th>
                <th scope="col" className="p-2">
                  Rating
                </th>
                <th scope="col" className="p-2 text-right">
                  Reviews
                </th>
              </tr>
            </thead>
            <tbody>
              {sport.skills
                .filter((skill) => skill.active)
                .map((skill) => {
                  const rating = data?.ratings.find(
                    (r) => r.skillId === skill.id,
                  );
                  return (
                    <tr
                      key={skill.id}
                      className="border-b border-border last:border-0"
                    >
                      <th
                        scope="row"
                        className="break-anywhere p-2 font-medium"
                      >
                        {skill.name}
                      </th>
                      <td className="p-2 font-semibold tabular-nums">
                        {rating ? (
                          `${rating.currentRating.toFixed(4)} / 5`
                        ) : (
                          <span className="subtle font-normal">Unrated</span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {rating ? rating.feedbackCount : "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </>
      )}
      <p className="subtle text-xs">
        Internal ratings start from your first self-rating and update with
        feedback. Editing your self-rating does not reset them.
      </p>
    </section>
  );
}
