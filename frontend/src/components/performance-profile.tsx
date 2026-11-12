"use client";
import { BeachCourtBackground } from "./beach-court-background";
import { PerformanceSummaryCards } from "./performance-summary-cards";
import { SkillRadarProfile } from "./skill-radar-profile";
export function PerformanceProfile({
  onSkillSelect,
}: {
  onSkillSelect?: (skillId: string) => void;
}) {
  return (
    <section className="performance-profile" aria-label="Performance profile">
      <BeachCourtBackground />
      <div className="performance-profile__content">
        <header className="performance-profile__heading">
          <div>
            <p className="performance-profile__eyebrow">
              BEACH VOLLEYBALL <span> / </span> YOUR GAME, IN FOCUS
            </p>
            <h1>
              MY PERFORMANCE
              <br className="sm:hidden" /> PROFILE
            </h1>
            <p className="performance-profile__intro">
              Every touch tells a story. See where your game is taking you.
            </p>
          </div>
          <div className="performance-profile__season">
            <span className="performance-live-dot" /> CAREER STATS · CURRENT
            OVERALL RATING
          </div>
        </header>
        <PerformanceSummaryCards />
        <SkillRadarProfile onSkillSelect={onSkillSelect} immersive />
      </div>
    </section>
  );
}
