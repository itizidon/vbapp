# Clerk cutover dependency map (before schema edits)

## Identity tables to remove

User, UserAuthProvider, OAuthTransaction, AuthEmailChallenge, AuthProviderDeletion

## Player activity to clear for the fresh start

Match, MatchTeam, MatchParticipant, Feedback, FeedbackRating, SelfAssessment, SelfAssessmentRating, FeedbackReviewerSkillSnapshot, PlayerInternalRating, PlayerInternalRatingEvent, SelfAssessmentRatingEvent, InternalRatingContribution, FeedbackLink, FeedbackRequestMatch, FeedbackMatch, FeedbackSubmission, FeedbackAnalysisJob, FeedbackExtractionRun, FeedbackObservation, FeedbackEmbeddingJob, FeedbackObservationEmbedding, PlayerFeedbackAnalysisProfile, AiCoachConversation, AiCoachTurn, AiCoachUsage, FeedbackPrivacyEvent, DrillVideoSubmission, VideoAnalysis, VideoAnalysisReference, PlayerTrainingProfile, PlayerSkillProgress, DrillCompletion, LegacyPlayerSkillRating, LegacyPlayerSportRating

## Independent content to preserve

Sport, Skill, FeedbackTheme, SkillTreeNode, SkillPrerequisite, Drill, DrillStep, DrillSkill, CoachingSituation, DrillRecommendationRule, DrillTechniqueVariant, DrillReferenceVideo, TechniqueCheckpoint, VideoWorkerHeartbeat

## Mixed reference/player media infrastructure

VideoPoseArtifact and VideoProcessingJob: preserve reference-only artifacts/jobs; remove player analyses and submissions. Preserve reusable reference files; clear old creator/uploader attribution to null, then allow a trusted ADMIN/COACH to adopt retained content. Generate a private-media cleanup manifest before reset; do not delete external storage during an unreviewed database cutover.

## Identity scalar references

- Match: createdById
- MatchParticipant: userId
- Feedback: submittedById, approvedById, rejectedById, recipientId, reviewerId
- SelfAssessment: userId
- PlayerInternalRating: userId
- PlayerInternalRatingEvent: userId, reviewerId
- SelfAssessmentRatingEvent: userId
- InternalRatingContribution: userId, reviewerId
- FeedbackLink: recipientId, assignedReviewerId
- PlayerFeedbackAnalysisProfile: userId
- AiCoachConversation: userId
- AiCoachTurn: userId
- AiCoachUsage: userId
- FeedbackPrivacyEvent: actorId
- Drill: createdById
- DrillReferenceVideo: uploadedById
- DrillVideoSubmission: userId
- PlayerTrainingProfile: userId
- PlayerSkillProgress: userId
- DrillCompletion: userId

## Runtime dependencies

- Auth guards/resolvers, current-user context, directory lookups, match roster hydration and public visibility.
- Feedback recipient/reviewer validation, reviewer snapshots, guest link capabilities, approval summaries and feedback list names.
- Current SelfAssessment/SelfAssessmentRating move to Clerk private metadata; append-only self-rating events and internal ratings remain domain history.
- SQL functions/views/triggers currently depend on User preferences, UUID identity types and current self-assessment tables. Replace these explicitly; retain per-feedback privacy/approval/moderation rules.
- Training editor allowlists move to trusted private Clerk roles; user-owned submissions/progress remain domain data.
- AI Coach preference/profile lookup moves to Clerk; domain history/profile aggregates retain scalar Clerk IDs.
- Frontend custom forms/cookies/session proxy, social callbacks, verification pages and account controls are removed in favor of Clerk.
- Seeds/maintenance/backfill scripts and integration fixtures must stop creating User rows.

This inventory was recorded before schema edits. Execution status and backup evidence are reported separately; production changes are never automatic.
