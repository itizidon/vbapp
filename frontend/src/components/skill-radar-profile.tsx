"use client";
import { useQuery } from "@tanstack/react-query";
import { gql } from "@/lib/api";
import { useCatalog, useUser } from "@/lib/hooks";
import type { SkillRadarData } from "@/lib/skill-radar";
import { PlayerSkillRadarChart } from "./player-skill-radar-chart";
import { ErrorState, LoadingSkeleton } from "./common";
export function SkillRadarProfile({
  onSkillSelect,
  immersive = false,
}: {
  onSkillSelect?: (skillId: string) => void;
  immersive?: boolean;
}) {
  const user = useUser(),
    catalog = useCatalog();
  const sport = catalog.data?.sports[0];
  const profile = useQuery({
    queryKey: ["skill-radar", user.data?.me.id, sport?.id, null],
    enabled: !!user.data && !!sport,
    queryFn: () =>
      gql<{
        skillRadarProfile: { asOf: string | null; skills: SkillRadarData[] };
      }>(
        `query SkillRadarProfile($userId:ID!,$sportId:ID!){skillRadarProfile(userId:$userId,sportId:$sportId){asOf skills{skillId skillName skillSlug selfRating internalRating averageFeedbackRating feedbackCount}}}`,
        { userId: user.data!.me.id, sportId: sport!.id },
      ),
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const error = user.error ?? catalog.error ?? profile.error;
  return (
    <section
      className={
        immersive
          ? "performance-profile__radar min-w-0 space-y-4"
          : "panel mb-5 min-w-0 space-y-4"
      }
      aria-label={immersive ? "Skill profile" : "Performance profile"}
    >
      {!immersive && (
        <div>
          <h2>Performance profile</h2>
          <p className="subtle mt-1 text-sm">
            Explore your five-skill profile using internal ratings or your
            self-assessment.
          </p>
        </div>
      )}
      {error ? (
        <ErrorState
          error={error}
          retry={() => {
            void user.refetch();
            void catalog.refetch();
            void profile.refetch();
          }}
        />
      ) : user.isPending || catalog.isPending ? (
        <LoadingSkeleton />
      ) : !sport ? (
        <p className="subtle">No sport available.</p>
      ) : profile.isPending ? (
        <LoadingSkeleton />
      ) : (
        <PlayerSkillRadarChart
          data={profile.data?.skillRadarProfile.skills ?? []}
          onSkillSelect={onSkillSelect}
          onModeChange={() => {
            void profile.refetch();
          }}
          immersive={immersive}
          allowCompare={false}
        />
      )}
    </section>
  );
}
