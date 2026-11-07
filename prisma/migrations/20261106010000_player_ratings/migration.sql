-- Current system-generated ratings are intentionally independent from mutable
-- self-assessments and immutable historical reviewer snapshots.
CREATE TABLE "PlayerSkillRating" (
  "userId" UUID NOT NULL,
  "skillId" UUID NOT NULL,
  "calculatedRating" DECIMAL(4,2),
  "confidence" DECIMAL(5,4),
  "feedbackCount" INTEGER NOT NULL DEFAULT 0,
  "reviewerCount" INTEGER NOT NULL DEFAULT 0,
  "algorithmVersion" TEXT,
  "calculatedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "PlayerSkillRating_pkey" PRIMARY KEY ("userId", "skillId"),
  CONSTRAINT "PlayerSkillRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "PlayerSkillRating_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT,
  CONSTRAINT "PlayerSkillRating_value_check" CHECK ("calculatedRating" IS NULL OR "calculatedRating" BETWEEN 1 AND 5),
  CONSTRAINT "PlayerSkillRating_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1),
  CONSTRAINT "PlayerSkillRating_counts_check" CHECK ("feedbackCount" >= 0 AND "reviewerCount" >= 0)
);

CREATE TABLE "PlayerSportRating" (
  "userId" UUID NOT NULL,
  "sportId" UUID NOT NULL,
  "calculatedRating" DECIMAL(4,2),
  "overallLevel" TEXT,
  "confidence" DECIMAL(5,4),
  "feedbackCount" INTEGER NOT NULL DEFAULT 0,
  "reviewerCount" INTEGER NOT NULL DEFAULT 0,
  "algorithmVersion" TEXT,
  "calculatedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "PlayerSportRating_pkey" PRIMARY KEY ("userId", "sportId"),
  CONSTRAINT "PlayerSportRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "PlayerSportRating_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT,
  CONSTRAINT "PlayerSportRating_value_check" CHECK ("calculatedRating" IS NULL OR "calculatedRating" BETWEEN 1 AND 5),
  CONSTRAINT "PlayerSportRating_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1),
  CONSTRAINT "PlayerSportRating_counts_check" CHECK ("feedbackCount" >= 0 AND "reviewerCount" >= 0)
);

CREATE INDEX "PlayerSkillRating_skillId_idx" ON "PlayerSkillRating"("skillId");
CREATE INDEX "PlayerSportRating_sportId_idx" ON "PlayerSportRating"("sportId");
