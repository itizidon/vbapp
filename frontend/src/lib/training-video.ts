import { gql } from "./api";
export type Quality = {
  validRatio: number;
  processedFrames: number;
  validFrames: number;
  warnings: string[];
  errorCode: string | null;
};
export type Job = {
  id: string;
  type: string;
  status: string;
  errorCode: string | null;
  attempts: number;
};
export type Checkpoint = {
  id: string;
  name: string;
  phaseKey: string;
  importance: number;
  coachingExplanation: string;
  measurementConfig?: {
    version: number;
    feature?: string;
    tolerance?: number;
    cameras?: string[];
  };
  techniqueVariantId?: string | null;
};
export type Evidence = {
  playerMs: number;
  referenceMs: number;
  playerValue: number;
  referenceValue: number;
  difference: number;
  quality: number;
  referenceVideoId: string;
  feature: string;
  unit: string;
};
export type Comparison = {
  overallSimilarity: number | null;
  scoreLabel: string;
  aggregation: string;
  limitations: string[];
  references: {
    referenceVideoId: string;
    similarity: number | null;
    referenceVersion: number;
    poseArtifactId: string;
    mirrored: boolean;
  }[];
  checkpoints: {
    checkpointId: string;
    name: string;
    status: string;
    similarity: number | null;
    quality: number | null;
    limitations: string[];
    evidence: Evidence[];
    perReference: {
      referenceVideoId: string;
      similarity: number | null;
      sampleCount: number;
      medianAbsoluteDifference: number;
      unit: string;
    }[];
  }[];
};
export type Result = {
  comparison?: Comparison;
  coaching?: {
    summary: string;
    source: string;
    consistent: { checkpointId: string; text: string }[];
    improve: { checkpointId: string; text: string; why: string }[];
    practice: string[];
  };
  selection?: {
    referenceVideoId: string;
    reason: string;
    compatible: boolean;
  }[];
};
export type Analysis = {
  id: string;
  status: string;
  analysisVersion: string;
  errorCode: string | null;
  result?: Result | null;
  createdAt: string;
};
export type Reference = {
  id: string;
  title: string;
  description?: string;
  status: string;
  uploadStatus: string;
  cameraAngle: string;
  handedness: string | null;
  techniqueVariantId: string | null;
  isPrimary: boolean;
  referenceVersion: number;
  checkpointIds: string[];
  qualityAcknowledgedAt: string | null;
  pose?: { quality: Quality; modelVersion: string; status: string };
  jobs: Job[];
};
export type Submission = {
  id: string;
  drillId: string;
  status: string;
  cameraAngle: string;
  handedness?: string;
  createdAt: string;
  pose?: { quality: Quality };
  jobs: Job[];
  analyses: Analysis[];
};
export type Workspace = {
  editor: boolean;
  worker: { available: boolean };
  drill: {
    id: string;
    name: string;
    objective: string;
    description: string;
    setup: string;
    coachingCues: string[];
    motionConfig?: {
      version: number;
      enabled: boolean;
      allowMirroring: boolean;
      phaseWindows: { key: string; startRatio: number; endRatio: number }[];
    };
  };
  variants: { id: string; name: string; status: string }[];
  checkpoints: Checkpoint[];
  references: Reference[];
  submissions: Submission[];
};
export async function loadTrainingWorkspace(drillId: string) {
  return (
    await gql<{ trainingVideoWorkspace: Workspace }>(
      `query($id:ID!){trainingVideoWorkspace(drillId:$id)}`,
      { id: drillId },
    )
  ).trainingVideoWorkspace;
}
export async function trainingAction(
  operation: "configureDrillMotion" | "configureReferenceCoverage",
  id: string,
  config: unknown,
) {
  const arg = operation === "configureDrillMotion" ? "drillId" : "id";
  return gql(
    `mutation($id:ID!,$config:TrainingJSON!){${operation}(${arg}:$id,config:$config)}`,
    { id, config },
  );
}
export async function referenceState(
  id: string,
  status: string,
  isPrimary?: boolean,
) {
  return gql(
    `mutation($id:ID!,$input:UpdateReferenceVideoInput!){updateReferenceVideo(id:$id,input:$input){id}}`,
    {
      id,
      input: { status, ...(isPrimary === undefined ? {} : { isPrimary }) },
    },
  );
}
export async function retryVideo(id: string, reference: boolean) {
  return gql(
    `mutation($id:ID!,$reference:Boolean!){retryTrainingVideo(id:$id,reference:$reference)}`,
    { id, reference },
  );
}
export async function removeVideo(id: string, reference: boolean) {
  return gql(
    `mutation($id:ID!){${reference ? "deleteReferenceVideo" : "deleteMyDrillVideoSubmission"}(id:$id)}`,
    { id },
  );
}
export async function requestComparison(id: string) {
  return gql(
    `mutation($id:ID!,$requestId:ID!){requestDrillVideoAnalysis(id:$id,requestId:$requestId){id status}}`,
    { id, requestId: crypto.randomUUID() },
  );
}
export async function playback(
  id: string,
  reference: boolean,
  analysisId?: string,
) {
  const query = analysisId
    ? `query($id:ID!,$analysisId:ID!){analysisReferencePlayback(analysisId:$analysisId,referenceVideoId:$id){url expiresAt}}`
    : `query($id:ID!){${reference ? "referenceVideoPlayback" : "myDrillVideoPlayback"}(id:$id){url expiresAt}}`;
  const value = await gql<Record<string, { url: string; expiresAt: string }>>(
    query,
    { id, ...(analysisId ? { analysisId } : {}) },
  );
  return Object.values(value)[0];
}
export async function uploadVideo(
  file: File,
  input: Record<string, unknown>,
  reference: boolean,
  onProgress: (v: number) => void,
  signal?: AbortSignal,
) {
  if (file.size > 100 * 1024 * 1024 || !file.size)
    throw new Error("Choose a video under 100 MB.");
  const mimeType =
    file.type ||
    (/\.mov$/i.test(file.name)
      ? "video/quicktime"
      : /\.webm$/i.test(file.name)
        ? "video/webm"
        : "video/mp4");
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(mimeType))
    throw new Error("Use an MP4, MOV or WebM video.");
  const name = reference
      ? "createReferenceVideoUpload"
      : "requestDrillVideoUpload",
    type = reference ? "ReferenceVideoUploadInput" : "TrainingVideoUploadInput";
  const data = await gql<
    Record<string, { id: string; url: string; headers: Record<string, string> }>
  >(`mutation($input:${type}!){${name}(input:$input){id url headers}}`, {
    input: {
      ...input,
      mimeType,
      fileSizeBytes: file.size,
      ...(reference ? { originalFilename: file.name } : {}),
    },
  });
  const signed = data[name];
  if (signal?.aborted) throw new Error("Upload cancelled.");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signed.url);
    xhr.timeout = 180000;
    for (const [key, value] of Object.entries(signed.headers))
      if (key.toLowerCase() !== "content-length")
        xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", abort);
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(
          new Error("Upload failed. Check private storage CORS and try again."),
        );
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Upload connection failed."));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      cleanup();
      reject(new Error("Upload cancelled."));
    };
    xhr.send(file);
  });
  const finalize = reference
    ? "finalizeReferenceVideoUpload"
    : "finalizeDrillVideoUpload";
  await gql(`mutation($id:ID!){${finalize}(id:$id){id}}`, { id: signed.id });
  return signed.id;
}

export async function finalizeSavedVideo(id: string, reference: boolean) {
  const op = reference
    ? "finalizeReferenceVideoUpload"
    : "finalizeDrillVideoUpload";
  return gql(`mutation($id:ID!){${op}(id:$id){id}}`, { id });
}
