-- AlterTable
ALTER TABLE "Drill" ADD COLUMN     "motionConfig" JSONB;

-- AlterTable
ALTER TABLE "DrillReferenceVideo" ADD COLUMN     "checkpointIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "qualityAcknowledgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DrillVideoSubmission" ADD COLUMN     "aiExplanationAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowMirroring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handedness" TEXT;

-- AlterTable
ALTER TABLE "VideoAnalysisReference" ADD COLUMN     "checkpointIdsSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mirrored" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "poseArtifactId" UUID;

-- CreateTable
CREATE TABLE "VideoPoseArtifact" (
    "id" UUID NOT NULL,
    "referenceVideoId" UUID,
    "submissionId" UUID,
    "fingerprint" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "extractionVersion" TEXT NOT NULL,
    "featureVersion" TEXT NOT NULL,
    "samplingFps" INTEGER NOT NULL,
    "quality" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoPoseArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoWorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "versions" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoWorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoPoseArtifact_storageKey_key" ON "VideoPoseArtifact"("storageKey");

-- CreateIndex
CREATE INDEX "VideoPoseArtifact_submissionId_createdAt_idx" ON "VideoPoseArtifact"("submissionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoPoseArtifact_referenceVideoId_fingerprint_key" ON "VideoPoseArtifact"("referenceVideoId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "VideoPoseArtifact_submissionId_fingerprint_key" ON "VideoPoseArtifact"("submissionId", "fingerprint");

-- AddForeignKey
ALTER TABLE "VideoAnalysisReference" ADD CONSTRAINT "VideoAnalysisReference_poseArtifactId_fkey" FOREIGN KEY ("poseArtifactId") REFERENCES "VideoPoseArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoPoseArtifact" ADD CONSTRAINT "VideoPoseArtifact_referenceVideoId_fkey" FOREIGN KEY ("referenceVideoId") REFERENCES "DrillReferenceVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoPoseArtifact" ADD CONSTRAINT "VideoPoseArtifact_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "DrillVideoSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VideoPoseArtifact" ADD CONSTRAINT "pose_one_source" CHECK (("referenceVideoId" IS NOT NULL)::int + ("submissionId" IS NOT NULL)::int = 1);
ALTER TABLE "VideoPoseArtifact" ADD CONSTRAINT "pose_status" CHECK (status IN ('READY','REJECTED','DELETED'));
