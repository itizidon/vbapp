-- Preserve the legacy placeholder tables outside the application's active models.
-- This pending migration archives them instead of deleting existing data.
ALTER TABLE "PlayerSkillRating" RENAME TO "LegacyPlayerSkillRating";
ALTER TABLE "PlayerSportRating" RENAME TO "LegacyPlayerSportRating";
