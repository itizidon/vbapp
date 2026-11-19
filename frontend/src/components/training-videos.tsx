"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Video, Upload, ChevronDown } from "lucide-react";
import { gql } from "@/lib/api";
import { Button } from "./ui/button";
import { CreateDrillDialog } from "./create-drill-dialog";
import {
  finalizeSavedVideo,
  loadTrainingWorkspace,
  playback,
  referenceState,
  removeVideo,
  requestComparison,
  retryVideo,
  trainingAction,
  uploadVideo,
  type Analysis,
  type Reference,
  type Submission,
  type Workspace,
} from "@/lib/training-video";
const field =
  "w-full min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-sm";
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Unable to complete that action.";
const statusText = (s: string) => s.toLowerCase().replaceAll("_", " ");
export function TrainingLibrary({ admin = false }: { admin?: boolean }) {
  const access = useQuery({
    queryKey: ["training-editor-access"],
    enabled: admin,
    queryFn: () =>
      gql<{ canManageTraining: boolean }>(
        `query TrainingEditorAccess{canManageTraining}`,
      ),
  });
  const skills = useQuery({
    queryKey: ["training-skills"],
    queryFn: () =>
      gql<{ skillTree: { nodes: { id: string; name: string }[] } }>(
        `query{skillTree{nodes{id name}}}`,
      ),
    enabled: !admin,
  });
  const q = useQuery({
    queryKey: ["training-drills"],
    queryFn: () =>
      gql<{
        drills: {
          id: string;
          name: string;
          objective: string;
          difficulty: string;
        }[];
      }>(`query{drills(limit:100){id name objective difficulty}}`),
  });
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-primary">BVBTips training</p>
        <h1 className="text-3xl font-bold">
          {admin ? "Manage demonstrations" : "Practice with purpose"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {admin
            ? "Create a drill, publish its instructions, and add coach demonstrations."
            : "Watch a demonstration, record one attempt, and compare supported movement checkpoints."}
        </p>
      </header>
      <Link
        href={admin ? "/training" : "/admin/drills"}
        className="text-sm text-primary underline"
      >
        {admin ? "Player training library" : "Coach video administration"}
      </Link>
      {admin && (
        <div>
          {access.isPending ? (
            <p role="status" className="text-sm">
              Checking coach permissions…
            </p>
          ) : access.error ? (
            <p role="alert" className="text-sm text-destructive">
              {access.error.message}
            </p>
          ) : access.data?.canManageTraining ? (
            <CreateDrillDialog />
          ) : (
            <p role="alert" className="text-sm">
              Coach permissions are required to create drills.
            </p>
          )}
        </div>
      )}
      {q.isPending ? (
        <p role="status">Loading drills…</p>
      ) : q.error ? (
        <p role="alert">{q.error.message}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {q.data?.drills.map((d) => (
            <Link
              key={d.id}
              href={admin ? `/admin/drills/${d.id}/videos` : `/drills/${d.id}`}
              className="panel block space-y-3 hover:border-primary"
            >
              <Video className="text-primary" />
              <h2 className="text-lg font-semibold">{d.name}</h2>
              <p className="text-sm text-muted-foreground">{d.objective}</p>
              <span className="text-xs capitalize">
                {statusText(d.difficulty)}
              </span>
            </Link>
          ))}
        </div>
      )}
      {!admin && skills.data && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Explore skills</h2>
          <div className="flex flex-wrap gap-2">
            {skills.data.skillTree.nodes.map((n) => (
              <Link
                className="rounded-xl border border-border px-4 py-3 text-sm"
                key={n.id}
                href={`/skills/${n.id}`}
              >
                {n.name}
              </Link>
            ))}
          </div>
        </section>
      )}
      {q.data && !q.data.drills.length && (
        <p className="panel">
          {admin && access.data?.canManageTraining
            ? "No drills yet. Use Create drill to publish your first drill."
            : "No published drills yet. Check back after a coach adds one."}
        </p>
      )}
    </div>
  );
}
export function VideoPlayer({
  id,
  reference = false,
  analysisId,
  videoRef,
}: {
  id: string;
  reference?: boolean;
  analysisId?: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const [value, setValue] = useState<{ url: string; expiresAt: string }>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setValue(await playback(id, reference, analysisId));
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }, [id, reference, analysisId]);
  useEffect(() => {
    let stopped = false;
    playback(id, reference, analysisId)
      .then((v) => {
        if (!stopped) setValue(v);
      })
      .catch((e) => {
        if (!stopped) setError(errorText(e));
      });
    return () => {
      stopped = true;
    };
  }, [id, reference, analysisId]);
  return (
    <div className="space-y-2">
      {value && (
        <video
          key={value.url}
          ref={videoRef}
          controls
          preload="metadata"
          playsInline
          className="aspect-video w-full rounded-xl bg-black"
          src={value.url}
        />
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button variant="ghost" onClick={refresh}>
        {value ? "Refresh playback link" : "Load private video"}
      </Button>
    </div>
  );
}
function Demonstration({
  reference: r,
  variants,
}: {
  reference: Reference;
  variants: Workspace["variants"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">
        {r.title}
        <span className="mt-1 block text-xs font-normal capitalize text-muted-foreground">
          {statusText(r.cameraAngle)} ·{" "}
          {statusText(r.handedness ?? "unspecified")} ·{" "}
          {variants.find((v) => v.id === r.techniqueVariantId)?.name ??
            "General drill"}
        </span>
      </summary>
      {open && (
        <div className="mt-4 space-y-2">
          <VideoPlayer id={r.id} reference />
          <p className="text-sm">{r.description}</p>
        </div>
      )}
    </details>
  );
}
function QualityView({ reference }: { reference: Reference }) {
  const q = reference.pose?.quality;
  if (!q) return null;
  return (
    <details className="rounded-xl bg-muted p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Extraction quality · {Math.round(q.validRatio * 100)}% usable frames
      </summary>
      <div className="mt-2 space-y-2">
        <p>
          {q.validFrames} / {q.processedFrames} frames. Visibility quality is a
          tracking signal, not a calibrated probability.
        </p>
        {q.errorCode && <p role="alert">{qualityMessage(q.errorCode)}</p>}
        {q.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        <p className="break-all text-xs">{reference.pose?.modelVersion}</p>
      </div>
    </details>
  );
}
export function qualityMessage(code: string) {
  const messages: Record<string, string> = {
    LOW_LANDMARK_COVERAGE:
      "Too many joints were obscured. Record with your whole body and feet visible, good lighting, and no obstructions.",
    BODY_OUT_OF_FRAME:
      "Your body leaves the frame. Move the camera farther away and keep your feet visible.",
    MULTIPLE_PEOPLE:
      "More than one person was detected. Record one athlete at a time.",
    NO_PERSON_DETECTED:
      "No athlete could be tracked. Check lighting and camera placement.",
    ATHLETE_TOO_SMALL: "Move closer while keeping your whole body in frame.",
    INCOMPLETE_ATTEMPT:
      "No complete movement interval could be found. Trim the clip to one clear repetition.",
    NO_COMPATIBLE_REFERENCES:
      "No matching demonstration is ready. Choose the demonstrated variant, camera angle and handedness.",
    DRILL_ANALYSIS_NOT_ENABLED:
      "Automated comparison is not enabled for this drill.",
    MEDIA_VALIDATOR_NOT_CONFIGURED:
      "The video worker is offline. Your upload is saved and can resume when it starts.",
    PROCESSING_FAILED:
      "Processing failed. Retry, or record a shorter clip with your full body visible.",
  };
  return messages[code] ?? statusText(code);
}
function Jobs({ jobs, worker }: { jobs: Submission["jobs"]; worker: boolean }) {
  return (
    <div className="space-y-1 text-sm">
      {!worker && (
        <p className="text-amber-600 dark:text-amber-400">
          Video worker offline. Processing will resume when it starts.
        </p>
      )}
      {jobs
        .filter((j) => j.type !== "CLEANUP_MEDIA")
        .map((j) => (
          <div key={j.id} className="flex flex-wrap items-center gap-2">
            {worker && j.status === "PROCESSING" && (
              <LoaderCircle className="size-4 animate-spin" />
            )}
            <span className="capitalize">
              {statusText(j.type)}: {statusText(j.status)}
            </span>
            {j.errorCode && (
              <span className="text-muted-foreground">
                {qualityMessage(j.errorCode)}
              </span>
            )}
          </div>
        ))}
    </div>
  );
}
function UploadForm({
  data,
  admin,
  onDone,
}: {
  data: Workspace;
  admin: boolean;
  onDone: () => Promise<unknown>;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [variant, setVariant] = useState(data.variants[0]?.id ?? ""),
    [camera, setCamera] = useState("SIDE"),
    [hand, setHand] = useState("RIGHT"),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [coverage, setCoverage] = useState<string[]>([]),
    [mirror, setMirror] = useState(false),
    [ai, setAi] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) return;
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      for (const file of files) {
        setProgress(0);
        const id = await uploadVideo(
          file,
          {
            drillId: data.drill.id,
            ...(variant ? { techniqueVariantId: variant } : {}),
            cameraAngle: camera,
            handedness: hand,
            ...(admin
              ? { title: title || file.name, description }
              : { allowMirroring: mirror, aiExplanationAllowed: ai }),
          },
          admin,
          setProgress,
          abort.current.signal,
        );
        if (admin)
          await trainingAction("configureReferenceCoverage", id, {
            checkpointIds: coverage,
            acknowledge: false,
          });
      }
      setFiles([]);
      await onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="panel space-y-4">
      <h2 className="text-xl font-semibold">
        {admin ? "Upload coach demonstrations" : "Record your attempt"}
      </h2>
      <p className="text-sm text-muted-foreground">
        Record one athlete and one repetition, 1–30 seconds. Keep your entire
        body, hands and feet visible. Use the same camera angle as the
        demonstration; trim setup and extra repetitions.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          Technique variant
          <select
            className={field}
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
          >
            <option value="">General drill</option>
            {data.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          Camera angle
          <select
            className={field}
            value={camera}
            onChange={(e) => setCamera(e.target.value)}
          >
            {["SIDE", "FRONT", "REAR", "OBLIQUE"].map((x) => (
              <option key={x} value={x}>
                {statusText(x)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          Handedness
          <select
            className={field}
            value={hand}
            onChange={(e) => setHand(e.target.value)}
          >
            {["RIGHT", "LEFT", "BOTH"].map((x) => (
              <option key={x} value={x}>
                {statusText(x)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {admin ? (
        <>
          <label className="block text-sm">
            Title
            <input
              className={field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Coach demonstration"
            />
          </label>
          <label className="block text-sm">
            Coaching explanation
            <textarea
              className={field}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              Demonstrated checkpoints
            </legend>
            {data.checkpoints
              .filter(
                (c) =>
                  !c.techniqueVariantId || c.techniqueVariantId === variant,
              )
              .map((c) => (
                <label className="flex gap-2 text-sm" key={c.id}>
                  <input
                    type="checkbox"
                    checked={coverage.includes(c.id)}
                    onChange={(e) =>
                      setCoverage((old) =>
                        e.target.checked
                          ? [...old, c.id]
                          : old.filter((x) => x !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
          </fieldset>
        </>
      ) : (
        <>
          <p className="text-sm">
            Your video and pose data stay private. Comparison does not change
            your player ratings.
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={mirror}
              onChange={(e) => setMirror(e.target.checked)}
            />
            Allow left/right mirroring when this drill permits it.
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={ai}
              onChange={(e) => setAi(e.target.checked)}
            />
            Allow the existing AI Coach to receive measured differences and
            curated drill text to select coaching priorities. No video, frames,
            or landmarks are sent. Optional; a local explanation is always
            available.
          </label>
        </>
      )}
      <label className="block text-sm">
        {admin ? "Videos" : "Video"}
        <input
          className={`${field} mt-1`}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mov"
          multiple={admin}
          disabled={busy}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </label>
      {busy && (
        <div role="status">
          <p className="mb-2 text-sm">Uploading · {progress}%</p>
          <progress className="h-2 w-full" max={100} value={progress} />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button disabled={busy || !files.length} type="submit">
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4" />
        )}
        {admin ? "Upload demonstrations" : "Upload and analyze"}
      </Button>
      {busy && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => abort.current?.abort()}
        >
          Cancel upload
        </Button>
      )}
    </form>
  );
}
function ReferenceEditor({
  reference: r,
  data,
  run,
}: {
  reference: Reference;
  data: Workspace;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [covered, setCovered] = useState(r.checkpointIds),
    [ack, setAck] = useState(!!r.qualityAcknowledgedAt),
    [preview, setPreview] = useState(false);
  return (
    <article className="panel space-y-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-semibold">{r.title}</h3>
        <span className="text-xs capitalize">
          {statusText(r.status)} · {statusText(r.uploadStatus)}
        </span>
      </div>
      <p className="text-sm">
        {statusText(r.cameraAngle)} ·{" "}
        {statusText(r.handedness ?? "unspecified")} · revision{" "}
        {r.referenceVersion}
      </p>
      <Jobs jobs={r.jobs} worker={data.worker.available} />
      {r.uploadStatus === "PENDING_UPLOAD" && (
        <Button
          variant="outline"
          onClick={() => run(() => finalizeSavedVideo(r.id, true))}
        >
          Finish uploaded video
        </Button>
      )}
      <QualityView reference={r} />
      {r.uploadStatus === "READY_FOR_ANALYSIS" && (
        <>
          <Button variant="outline" onClick={() => setPreview(!preview)}>
            Preview demonstration
          </Button>
          {preview && <VideoPlayer id={r.id} reference />}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Checkpoint coverage</legend>
            {data.checkpoints
              .filter(
                (c) =>
                  !c.techniqueVariantId ||
                  c.techniqueVariantId === r.techniqueVariantId,
              )
              .map((c) => (
                <label className="flex gap-2 text-sm" key={c.id}>
                  <input
                    type="checkbox"
                    checked={covered.includes(c.id)}
                    onChange={(e) =>
                      setCovered((old) =>
                        e.target.checked
                          ? [...old, c.id]
                          : old.filter((x) => x !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
          </fieldset>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I reviewed the demonstration and tracking quality, and acknowledge
            the listed single-view limitations.
          </label>
          <Button
            variant="outline"
            onClick={() =>
              run(() =>
                trainingAction("configureReferenceCoverage", r.id, {
                  checkpointIds: covered,
                  acknowledge: ack,
                }),
              )
            }
          >
            Save coverage and quality review
          </Button>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            !ack || !covered.length || r.uploadStatus !== "READY_FOR_ANALYSIS"
          }
          onClick={() =>
            run(async () => {
              await trainingAction("configureReferenceCoverage", r.id, {
                checkpointIds: covered,
                acknowledge: ack,
              });
              await referenceState(r.id, "PUBLISHED");
            })
          }
        >
          Publish
        </Button>
        <Button
          variant="outline"
          onClick={() => run(() => referenceState(r.id, "ARCHIVED"))}
        >
          Archive
        </Button>
        <Button
          variant="outline"
          disabled={r.status === "PUBLISHED"}
          onClick={() => run(() => retryVideo(r.id, true))}
        >
          Reprocess
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            run(() => referenceState(r.id, r.status, !r.isPrimary))
          }
        >
          {r.isPrimary ? "Unmark primary" : "Mark primary"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            if (
              window.confirm(
                "Delete this reference and its motion data? References used in analyses can only be archived.",
              )
            )
              run(() => removeVideo(r.id, true));
          }}
        >
          Delete
        </Button>
      </div>
    </article>
  );
}
function MotionConfiguration({
  data,
  run,
}: {
  data: Workspace;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const [config, setConfig] = useState(
    JSON.stringify(
      data.drill.motionConfig ?? {
        version: 1,
        enabled: false,
        allowMirroring: false,
        phaseWindows: [],
      },
      null,
      2,
    ),
  );
  const [feature, setFeature] = useState("platform_wrist_height"),
    [name, setName] = useState("Platform height"),
    [tolerance, setTolerance] = useState("0.3"),
    [camera, setCamera] = useState("SIDE");
  async function add() {
    await gql(
      `mutation($input:CreateTechniqueCheckpointInput!){createTechniqueCheckpoint(input:$input){id}}`,
      {
        input: {
          drillId: data.drill.id,
          name,
          description:
            "Projected 2D comparison across the configured movement interval.",
          phaseKey: "whole",
          sortOrder: 0,
          importance: 1,
          coachingExplanation:
            "Review your aligned recording with the demonstration. A difference may be a valid adaptation; use the drill's curated cues when practicing.",
          status: "PUBLISHED",
          measurementConfig: {
            version: 2,
            feature,
            tolerance: Number(tolerance),
            cameras: [camera],
            minConfidence: 0.65,
          },
        },
      },
    );
  }
  return (
    <details className="panel space-y-4">
      <summary className="cursor-pointer font-semibold">
        Measurement configuration <ChevronDown className="inline size-4" />
      </summary>
      <p className="mt-4 text-sm text-muted-foreground">
        Enable only checkpoints reviewed for the drill and camera view.
        Tolerances are experimental engineering settings. Phase windows are
        fractions of the activity envelope; they do not detect ball contact or
        takeoff.
      </p>
      <label className="block text-sm">
        Drill motion configuration
        <textarea
          className={`${field} mt-1 min-h-40 font-mono`}
          value={config}
          onChange={(e) => setConfig(e.target.value)}
        />
      </label>
      <Button
        variant="outline"
        onClick={() =>
          run(() =>
            trainingAction(
              "configureDrillMotion",
              data.drill.id,
              JSON.parse(config),
            ),
          )
        }
      >
        Save configuration
      </Button>
      <h3 className="font-medium">Add an implemented checkpoint</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Name
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Feature
          <select
            className={field}
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
          >
            {[
              "platform_wrist_height",
              "left_elbow_angle",
              "right_elbow_angle",
              "left_knee_angle",
              "right_knee_angle",
              "trunk_inclination",
            ].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Tolerance (
          {feature === "platform_wrist_height" ? "torso lengths" : "degrees"})
          <input
            className={field}
            type="number"
            min="0.01"
            max="180"
            step="0.01"
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Approved camera
          <select
            className={field}
            value={camera}
            onChange={(e) => setCamera(e.target.value)}
          >
            {["SIDE", "FRONT", "REAR", "OBLIQUE"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <Button variant="outline" onClick={() => run(add)}>
        Add checkpoint
      </Button>
      <ul className="space-y-2 text-sm">
        {data.checkpoints.map((c) => (
          <li key={c.id}>
            {c.name} ·{" "}
            {c.measurementConfig?.version === 2
              ? c.measurementConfig.feature
              : "Manual / unsupported"}
          </li>
        ))}
      </ul>
    </details>
  );
}
export function AnalysisResults({
  analysis,
  submission,
}: {
  analysis: Analysis;
  submission: Submission;
}) {
  const c = analysis.result?.comparison,
    coach = analysis.result?.coaching;
  const [reference, setReference] = useState(
    c?.references[0]?.referenceVideoId ?? "",
  );
  const playerRef = useRef<HTMLVideoElement>(null),
    coachRef = useRef<HTMLVideoElement>(null);
  if (analysis.status !== "COMPLETED")
    return (
      <div className="rounded-xl bg-muted p-4 text-sm">
        <p className="capitalize">Analysis: {statusText(analysis.status)}</p>
        {analysis.errorCode && <p>{qualityMessage(analysis.errorCode)}</p>}
      </div>
    );
  if (!c)
    return (
      <p className="text-sm">
        This historical analysis has no motion-comparison result.
      </p>
    );
  return (
    <section className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Experimental movement similarity
        </p>
        <h3 className="mt-1 text-3xl font-bold">
          {c.overallSimilarity === null
            ? "Not enough information"
            : `${Math.round(c.overallSimilarity)} / 100`}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Measures selected projected movements under matching conditions. It is
          not a correctness percentage or a player rating.
        </p>
      </header>
      <label className="block text-sm">
        Compare demonstration
        <select
          className={`${field} mt-1`}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        >
          {c.references.map((r, i) => (
            <option key={r.referenceVideoId} value={r.referenceVideoId}>
              Reference {i + 1} · revision {r.referenceVersion} ·{" "}
              {r.similarity === null
                ? "insufficient data"
                : `${r.similarity}/100`}
              {r.mirrored ? " · mirrored" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold">Your attempt</h4>
          <VideoPlayer id={submission.id} videoRef={playerRef} />
        </div>
        {reference && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Coach demonstration</h4>
            <VideoPlayer
              id={reference}
              reference
              analysisId={analysis.id}
              videoRef={coachRef}
            />
          </div>
        )}
      </div>
      <div className="space-y-3">
        {c.checkpoints.map((cp) => (
          <details
            key={cp.checkpointId}
            className="rounded-xl border border-border p-4"
            open={cp.status === "EVALUATED"}
          >
            <summary className="cursor-pointer font-semibold">
              {cp.name}{" "}
              <span className="float-right text-primary">
                {cp.similarity === null
                  ? "Not evaluated"
                  : `${Math.round(cp.similarity)} / 100`}
              </span>
            </summary>
            <div className="mt-3 space-y-3 text-sm">
              {cp.limitations.map((l) => (
                <p key={l} className="text-muted-foreground">
                  {l}
                </p>
              ))}
              {cp.evidence
                .filter((e) => e.referenceVideoId === reference)
                .map((e, i) => (
                  <div key={i} className="rounded-lg bg-muted p-3">
                    <p>
                      You: {e.playerValue.toFixed(1)} · reference:{" "}
                      {e.referenceValue.toFixed(1)} {e.unit}
                    </p>
                    <p>
                      Difference: {e.difference.toFixed(1)} {e.unit} · tracking
                      quality {Math.round(e.quality * 100)}%
                    </p>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (playerRef.current)
                          playerRef.current.currentTime = e.playerMs / 1000;
                        if (coachRef.current)
                          coachRef.current.currentTime = e.referenceMs / 1000;
                      }}
                    >
                      View aligned moments · {(e.playerMs / 1000).toFixed(1)}s /{" "}
                      {(e.referenceMs / 1000).toFixed(1)}s
                    </Button>
                  </div>
                ))}
              {cp.perReference.map((r) => (
                <p key={r.referenceVideoId} className="text-xs">
                  Reference{" "}
                  {c.references.findIndex(
                    (x) => x.referenceVideoId === r.referenceVideoId,
                  ) + 1}
                  : {r.sampleCount} aligned samples · median absolute difference{" "}
                  {r.medianAbsoluteDifference.toFixed(2)} {r.unit}
                </p>
              ))}
            </div>
          </details>
        ))}
      </div>
      {coach && (
        <div className="rounded-xl bg-accent p-4 space-y-4">
          <h3 className="font-semibold">Technique review</h3>
          <p className="text-sm">{coach.summary}</p>
          {coach.consistent.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">What looks consistent</h4>
              {coach.consistent.map((x) => (
                <p className="mt-2 text-sm" key={x.checkpointId}>
                  {x.text}
                </p>
              ))}
            </div>
          )}
          {coach.improve.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">Review next</h4>
              {coach.improve.map((x) => (
                <div key={x.checkpointId} className="mt-2 text-sm">
                  <p>{x.text}</p>
                  <p className="text-muted-foreground">{x.why}</p>
                </div>
              ))}
            </div>
          )}
          {coach.practice.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">Practice cues</h4>
              <ul className="mt-2 list-inside list-disc text-sm">
                {coach.practice.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {coach.source === "DETERMINISTIC"
              ? "Local explanation from measured evidence and curated coaching cues."
              : "AI Coach selected priorities from measured evidence and curated coaching cues."}
          </p>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer">
          Method, reference compatibility and limitations
        </summary>
        <p className="mt-2">{c.aggregation}</p>
        {c.limitations.map((l) => (
          <p className="mt-2 text-muted-foreground" key={l}>
            {l}
          </p>
        ))}
        {analysis.result?.selection
          ?.filter((r) => !r.compatible)
          .map((r) => (
            <p key={r.referenceVideoId} className="mt-2">
              Excluded reference: {r.reason}
            </p>
          ))}
        <p className="mt-2 break-all text-xs">
          Version: {analysis.analysisVersion}
        </p>
      </details>
    </section>
  );
}
function SelectedAnalysis({
  analysis,
  submission,
}: {
  analysis: Analysis;
  submission: Submission;
}) {
  const q = useQuery({
    queryKey: ["training-analysis", analysis.id],
    queryFn: () =>
      gql<{ videoAnalysis: Analysis }>(
        `query($id:ID!){videoAnalysis(id:$id){id status analysisVersion errorCode result}}`,
        { id: analysis.id },
      ),
    refetchInterval: analysis.status === "COMPLETED" ? false : 5000,
  });
  if (q.isPending) return <p role="status">Loading results…</p>;
  if (q.error) return <p role="alert">{q.error.message}</p>;
  return (
    <AnalysisResults analysis={q.data!.videoAnalysis} submission={submission} />
  );
}
export function DrillVideoPage({
  drillId,
  admin = false,
}: {
  drillId: string;
  admin?: boolean;
}) {
  const client = useQueryClient(),
    key = ["training-workspace", drillId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => loadTrainingWorkspace(drillId),
    refetchInterval: 5000,
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: key });
  async function run(fn: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (q.isPending)
    return (
      <p role="status" className="flex gap-2">
        <LoaderCircle className="size-5 animate-spin" />
        Loading training…
      </p>
    );
  if (q.error) return <p role="alert">{q.error.message}</p>;
  const d = q.data;
  if (!d) return null;
  if (admin && !d.editor)
    return <p role="alert">Coach publishing permissions are required.</p>;
  const chosen = d.submissions
    .flatMap((s) => s.analyses.map((a) => ({ a, s })))
    .find((x) => x.a.id === selected);
  return (
    <div className="space-y-6">
      <Link
        className="text-sm text-primary underline"
        href={admin ? "/admin/drills" : "/training"}
      >
        ← Training library
      </Link>
      <header>
        <p className="text-sm font-semibold text-primary">
          {admin ? "Coach content studio" : "Skill practice"}
        </p>
        <h1 className="mt-1 text-3xl font-bold">{d.drill.name}</h1>
        <p className="mt-2 text-muted-foreground">{d.drill.objective}</p>
        <p className="mt-2 text-sm">{d.drill.setup}</p>
      </header>
      <div
        role="status"
        className="rounded-xl border border-border bg-card p-4 text-sm"
      >
        {d.worker.available
          ? "Local video worker is online."
          : "Video worker is offline. Uploads are saved; processing resumes when it starts."}
        {!d.drill.motionConfig?.enabled && (
          <p className="mt-1">
            Automated comparison is not enabled for this drill.
          </p>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm">
          Saving…
        </p>
      )}
      {admin ? (
        <>
          <MotionConfiguration data={d} run={run} />
          <UploadForm data={d} admin onDone={refresh} />
          <h2 className="text-xl font-semibold">
            Reference demonstrations ({d.references.length})
          </h2>
          {d.references
            .filter((r) => r.uploadStatus !== "DELETED")
            .map((r) => (
              <ReferenceEditor
                key={`${r.id}-${r.qualityAcknowledgedAt}`}
                reference={r}
                data={d}
                run={run}
              />
            ))}
        </>
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              Watch the coach demonstration
            </h2>
            {!d.references.length && (
              <p className="text-sm text-muted-foreground">
                No published demonstration is ready yet.
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              {d.references.map((r) => (
                <Demonstration key={r.id} reference={r} variants={d.variants} />
              ))}
            </div>
          </section>
          <UploadForm data={d} admin={false} onDone={refresh} />
          {chosen && (
            <div className="panel">
              <SelectedAnalysis
                key={chosen.a.id}
                analysis={chosen.a}
                submission={chosen.s}
              />
            </div>
          )}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Your previous attempts</h2>
            <p className="text-sm text-muted-foreground">
              Compare attempts using the same drill, camera, variant and
              analysis version. A score across different conditions is not a
              reliable progress measure.
            </p>
            {d.submissions.map((s) => (
              <article key={s.id} className="panel space-y-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-medium">
                    {new Date(s.createdAt).toLocaleString()}
                  </h3>
                  <span className="text-xs capitalize">
                    {statusText(s.status)} · {statusText(s.cameraAngle)}
                  </span>
                </div>
                <Jobs jobs={s.jobs} worker={d.worker.available} />
                {s.pose?.quality.errorCode && (
                  <p className="text-sm text-destructive">
                    {qualityMessage(s.pose.quality.errorCode)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {s.status === "PENDING_UPLOAD" && (
                    <Button
                      variant="outline"
                      onClick={() => run(() => finalizeSavedVideo(s.id, false))}
                    >
                      Finish uploaded video
                    </Button>
                  )}
                  {s.analyses.map((a) => (
                    <Button
                      key={a.id}
                      variant="outline"
                      onClick={() => setSelected(a.id)}
                    >
                      {a.status === "COMPLETED"
                        ? `View results${a.result?.comparison?.overallSimilarity != null ? ` · ${a.result.comparison.overallSimilarity}/100` : ""}`
                        : statusText(a.status)}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    disabled={!d.worker.available}
                    onClick={() => run(() => requestComparison(s.id))}
                  >
                    Compare again
                  </Button>
                  {s.status === "FAILED" && (
                    <Button
                      variant="ghost"
                      onClick={() => run(() => retryVideo(s.id, false))}
                    >
                      Retry extraction
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete your private video, results and derived pose data?",
                        )
                      )
                        run(() => removeVideo(s.id, false));
                    }}
                  >
                    Delete attempt
                  </Button>
                </div>
              </article>
            ))}
          </section>
          {d.editor && (
            <Link
              href={`/admin/drills/${drillId}/videos`}
              className="text-sm text-primary underline"
            >
              Manage coach demonstrations
            </Link>
          )}
        </>
      )}
    </div>
  );
}

export function TrainingSkillPage({ skillId }: { skillId: string }) {
  const q = useQuery({
    queryKey: ["training-skill", skillId],
    queryFn: () =>
      gql<{
        skillTreeNode: {
          name: string;
          description: string;
          learningObjective: string;
        };
        drillsForSkill: { id: string; name: string; objective: string }[];
      }>(
        `query($id:ID!){skillTreeNode(id:$id){name description learningObjective}drillsForSkill(id:$id){id name objective}}`,
        { id: skillId },
      ),
  });
  if (q.isPending) return <p role="status">Loading skill…</p>;
  if (q.error) return <p role="alert">{q.error.message}</p>;
  const data = q.data!;
  return (
    <div className="space-y-6">
      <Link href="/training" className="text-sm text-primary underline">
        ← Training library
      </Link>
      <header>
        <h1 className="text-3xl font-bold">{data.skillTreeNode.name}</h1>
        <p className="mt-3 text-muted-foreground">
          {data.skillTreeNode.learningObjective}
        </p>
        <p className="mt-3 text-sm">{data.skillTreeNode.description}</p>
      </header>
      <h2 className="text-xl font-semibold">
        Practice drills and demonstrations
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.drillsForSkill.map((d) => (
          <Link key={d.id} href={`/drills/${d.id}`} className="panel block">
            <h3 className="font-semibold">{d.name}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{d.objective}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
