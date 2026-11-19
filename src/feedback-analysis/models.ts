import {
  Field,
  Float,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";
export enum RatingTrend {
  IMPROVING = "IMPROVING",
  DECLINING = "DECLINING",
  STABLE = "STABLE",
  MIXED = "MIXED",
  INSUFFICIENT_DATA = "INSUFFICIENT_DATA",
}
export enum TechniqueTrend {
  LIKELY_IMPROVING = "LIKELY_IMPROVING",
  POSSIBLY_IMPROVING = "POSSIBLY_IMPROVING",
  STABLE = "STABLE",
  POSSIBLY_DECLINING = "POSSIBLY_DECLINING",
  MIXED = "MIXED",
  INSUFFICIENT_DATA = "INSUFFICIENT_DATA",
}
export enum EvidenceStatus {
  NO_DATA = "NO_DATA",
  INSUFFICIENT_DATA = "INSUFFICIENT_DATA",
  LIMITED_REVIEWER_DIVERSITY = "LIMITED_REVIEWER_DIVERSITY",
  PARTIAL_ANALYSIS = "PARTIAL_ANALYSIS",
  SUFFICIENT = "SUFFICIENT",
}
registerEnumType(RatingTrend, { name: "FeedbackRatingTrend" });
registerEnumType(TechniqueTrend, { name: "FeedbackTechniqueTrend" });
registerEnumType(EvidenceStatus, { name: "FeedbackEvidenceStatus" });
@ObjectType()
export class AnalysisAverage {
  @Field(() => Int) count!: number;
  @Field(() => Float, { nullable: true }) average!: number | null;
}
@ObjectType()
export class RatingComparison {
  @Field(() => AnalysisAverage) recent!: AnalysisAverage;
  @Field(() => AnalysisAverage) previous!: AnalysisAverage;
  @Field(() => Float, { nullable: true }) delta!: number | null;
  @Field(() => RatingTrend) trend!: RatingTrend;
  @Field() explanation!: string;
}
@ObjectType()
export class FeedbackTrustEvidence {
  @Field() classification!: string;
  @Field(() => Int) feedbackCount!: number;
  @Field(() => Int) positiveFeedbackCount!: number;
  @Field(() => Int) negativeFeedbackCount!: number;
  @Field(() => Int) neutralFeedbackCount!: number;
}
@ObjectType()
export class FeedbackTrustRating {
  @Field() classification!: string;
  @Field(() => AnalysisAverage) all!: AnalysisAverage;
  @Field(() => AnalysisAverage) recent!: AnalysisAverage;
  @Field(() => AnalysisAverage) previous!: AnalysisAverage;
}
@ObjectType()
export class FeedbackSkillAnalysis {
  @Field(() => AnalysisAverage, { nullable: true })
  verifiedPeer?: AnalysisAverage;
  @Field(() => AnalysisAverage, { nullable: true })
  unverifiedPeer?: AnalysisAverage;
  @Field(() => [FeedbackTrustRating], { nullable: true })
  trustBreakdown?: FeedbackTrustRating[];
  @Field(() => RatingComparison, { nullable: true })
  verifiedNinetyDayComparison?: RatingComparison;
  @Field(() => ID) skillId!: string;
  @Field() name!: string;
  @Field() slug!: string;
  @Field(() => AnalysisAverage) peer!: AnalysisAverage;
  @Field(() => String, { nullable: true }) latestRatingAt!: string | null;
  @Field(() => AnalysisAverage) last30Days!: AnalysisAverage;
  @Field(() => AnalysisAverage) last90Days!: AnalysisAverage;
  @Field(() => AnalysisAverage) previous90Days!: AnalysisAverage;
  @Field(() => RatingComparison) lastFiveComparison!: RatingComparison;
  @Field(() => RatingComparison) ninetyDayComparison!: RatingComparison;
  @Field(() => RatingTrend) trend!: RatingTrend;
  @Field() explanation!: string;
  @Field(() => Float, { nullable: true }) selfAssessment!: number | null;
  @Field(() => Float, { nullable: true }) internalRating!: number | null;
  @Field(() => Float, { nullable: true }) selfMinusPeer!: number | null;
  @Field(() => EvidenceStatus) evidenceStatus!: EvidenceStatus;
}
@ObjectType()
export class ThemePeriod {
  @Field(() => [FeedbackTrustEvidence], { nullable: true })
  trustBreakdown?: FeedbackTrustEvidence[];
  @Field(() => Int) feedbackCount!: number;
  @Field(() => Int) relevantFeedbackCount!: number;
  @Field(() => Int) positiveFeedbackCount!: number;
  @Field(() => Int) negativeFeedbackCount!: number;
  @Field(() => Int) neutralFeedbackCount!: number;
  @Field(() => Int) distinctVerifiedReviewers!: number;
  @Field(() => Int) distinctNegativeReviewers!: number;
  @Field(() => Float, { nullable: true }) negativeMentionRate!: number | null;
  @Field(() => Float, { nullable: true }) positiveMentionRate!: number | null;
}
@ObjectType()
export class FeedbackThemeAnalysis {
  @Field(() => [FeedbackTrustEvidence], { nullable: true })
  trustBreakdown?: FeedbackTrustEvidence[];
  @Field(() => Float, { nullable: true }) trustEvidenceFactor?: number;
  @Field(() => ID) themeId!: string;
  @Field() name!: string;
  @Field(() => [ID]) skillIds!: string[];
  @Field(() => Int) rawObservationCount!: number;
  @Field(() => Int) feedbackCount!: number;
  @Field(() => Int) positiveFeedbackCount!: number;
  @Field(() => Int) negativeFeedbackCount!: number;
  @Field(() => Int) neutralFeedbackCount!: number;
  @Field(() => Int) distinctVerifiedReviewers!: number;
  @Field(() => Int) distinctNegativeReviewers!: number;
  @Field(() => Int) guestFeedbackCount!: number;
  @Field(() => Int) relevantFeedbackCount!: number;
  @Field(() => Int) verifiedReviewerCoverage!: number;
  @Field(() => Int) totalEligibleFeedbackCount!: number;
  @Field() denominatorKind!: string;
  @Field(() => Float, { nullable: true }) negativeMentionRate!: number | null;
  @Field(() => String, { nullable: true }) firstObservedAt!: string | null;
  @Field(() => String, { nullable: true }) lastObservedAt!: string | null;
  @Field(() => String, { nullable: true }) lastNegativeAt!: string | null;
  @Field(() => ThemePeriod) recent!: ThemePeriod;
  @Field(() => ThemePeriod) previous!: ThemePeriod;
  @Field(() => TechniqueTrend) improvement!: TechniqueTrend;
  @Field() explanation!: string;
  @Field(() => EvidenceStatus) evidenceStatus!: EvidenceStatus;
}
@ObjectType()
export class WeaknessComponent {
  @Field() name!: string;
  @Field(() => Float, { nullable: true }) value!: number | null;
  @Field(() => Float) effectiveWeight!: number;
}
@ObjectType()
export class FeedbackWeakness {
  @Field(() => Int, { nullable: true })
  verifiedSupportingFeedbackCount?: number;
  @Field(() => Int, { nullable: true })
  unverifiedSupportingFeedbackCount?: number;
  @Field(() => Float, { nullable: true }) trustEvidenceFactor?: number;
  @Field(() => ID, { nullable: true }) skillId!: string | null;
  @Field(() => ID) themeId!: string;
  @Field(() => Float) priorityScore!: number;
  @Field(() => Int) supportingFeedbackCount!: number;
  @Field(() => Float) negativeMentionRate!: number;
  @Field(() => Int) relevantFeedbackCount!: number;
  @Field(() => Int) distinctVerifiedReviewers!: number;
  @Field(() => Int) relevantRatingCount!: number;
  @Field(() => Float, { nullable: true }) relevantRatingAverage!: number | null;
  @Field(() => EvidenceStatus) evidenceStatus!: EvidenceStatus;
  @Field(() => Float) evidenceFactor!: number;
  @Field(() => [WeaknessComponent]) components!: WeaknessComponent[];
  @Field() explanation!: string;
}
@ObjectType()
export class FeedbackAnalysisProfile {
  @Field(() => Int, { nullable: true }) verifiedFeedbackCount?: number;
  @Field(() => Int, { nullable: true }) awaitingReviewerApprovalCount?: number;
  @Field(() => [FeedbackTrustEvidence], { nullable: true })
  trustBreakdown?: FeedbackTrustEvidence[];
  @Field(() => ID) playerId!: string;
  @Field(() => ID) sportId!: string;
  @Field(() => Int) algorithmVersion!: number;
  @Field() calculatedAt!: string;
  @Field() asOf!: string;
  @Field() expiresAt!: string;
  @Field(() => String, { nullable: true }) latestEligibleFeedbackAt!:
    string | null;
  @Field(() => Int) feedback!: number;
  @Field(() => Int) totalEligibleFeedbackCount!: number;
  @Field(() => Int) writtenFeedbackCount!: number;
  @Field(() => Int) distinctVerifiedReviewers!: number;
  @Field(() => Int) guestFeedbackCount!: number;
  @Field(() => Int) awaiting!: number;
  @Field(() => Int) failed!: number;
  @Field(() => Int) moderated!: number;
  @Field() state!: string;
  @Field(() => EvidenceStatus) evidenceStatus!: EvidenceStatus;
  @Field() evidenceExplanation!: string;
  @Field(() => [FeedbackSkillAnalysis]) skills!: FeedbackSkillAnalysis[];
  @Field(() => [FeedbackThemeAnalysis]) themes!: FeedbackThemeAnalysis[];
  @Field(() => [FeedbackWeakness]) weaknesses!: FeedbackWeakness[];
}
@ObjectType()
export class FeedbackAnalysisResult {
  @Field() state!: string;
  @Field() rebuildQueued!: boolean;
  @Field(() => String, { nullable: true }) lastErrorCode!: string | null;
  @Field(() => FeedbackAnalysisProfile, { nullable: true })
  profile!: FeedbackAnalysisProfile | null;
}
@ObjectType()
export class FeedbackSkillAnalysisResult {
  @Field() state!: string;
  @Field() rebuildQueued!: boolean;
  @Field(() => String, { nullable: true }) lastErrorCode!: string | null;
  @Field(() => [FeedbackSkillAnalysis]) skills!: FeedbackSkillAnalysis[];
}
@ObjectType()
export class FeedbackThemeAnalysisResult {
  @Field() state!: string;
  @Field() rebuildQueued!: boolean;
  @Field(() => String, { nullable: true }) lastErrorCode!: string | null;
  @Field(() => [FeedbackThemeAnalysis]) themes!: FeedbackThemeAnalysis[];
}
@ObjectType()
export class FeedbackWeaknessResult {
  @Field() state!: string;
  @Field() rebuildQueued!: boolean;
  @Field(() => String, { nullable: true }) lastErrorCode!: string | null;
  @Field(() => EvidenceStatus, { nullable: true })
  evidenceStatus!: EvidenceStatus | null;
  @Field(() => String, { nullable: true }) evidenceExplanation!: string | null;
  @Field(() => [FeedbackWeakness]) weaknesses!: FeedbackWeakness[];
}
