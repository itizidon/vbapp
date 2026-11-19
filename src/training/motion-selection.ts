export interface MotionSource {
  drillId: string;
  techniqueVariantId: string | null;
  cameraAngle: string;
  handedness: string | null;
  allowMirroring: boolean;
}
export function motionReferenceCompatibility(
  player: MotionSource,
  ref: {
    drillId: string;
    techniqueVariantId: string | null;
    cameraAngle: string;
    handedness: string | null;
    status: string;
    uploadStatus: string;
    qualityAcknowledgedAt: Date | null;
    checkpointIds: string[];
    poseArtifacts: {
      modelVersion: string;
      extractionVersion: string;
      featureVersion: string;
    }[];
  },
  artifact: {
    modelVersion: string;
    extractionVersion: string;
    featureVersion: string;
  },
  allowMirroring: boolean,
  checkpointIds: string[],
) {
  const pose = ref.poseArtifacts[0];
  const opposite =
    (player.handedness === "LEFT" && ref.handedness === "RIGHT") ||
    (player.handedness === "RIGHT" && ref.handedness === "LEFT");
  let reason = "Compatible";
  if (ref.drillId !== player.drillId) reason = "Different drill";
  else if (ref.techniqueVariantId !== player.techniqueVariantId)
    reason = "Different technique variant";
  else if (
    ref.cameraAngle !== player.cameraAngle ||
    player.cameraAngle === "UNKNOWN"
  )
    reason = "Different or unknown camera angle";
  else if (
    ref.status !== "PUBLISHED" ||
    ref.uploadStatus !== "READY_FOR_ANALYSIS" ||
    !pose
  )
    reason = "Published pose extraction not ready";
  else if (
    pose.featureVersion !== artifact.featureVersion ||
    pose.modelVersion !== artifact.modelVersion ||
    pose.extractionVersion !== artifact.extractionVersion
  )
    reason = "Incompatible extraction/model version; reprocess this reference";
  else if (!ref.qualityAcknowledgedAt)
    reason = "Coach has not acknowledged extraction limitations";
  else if (
    ref.handedness &&
    ref.handedness !== "BOTH" &&
    (!player.handedness || player.handedness === "BOTH")
  )
    reason = "Choose the handedness used in this attempt";
  else if (opposite && !(player.allowMirroring && allowMirroring))
    reason = "Handedness differs; mirroring is not authorized";
  else if (!checkpointIds.some((id) => ref.checkpointIds.includes(id)))
    reason = "No declared checkpoint coverage";
  return {
    reason,
    compatible: reason === "Compatible",
    mirrored: reason === "Compatible" && opposite,
  };
}
