"use client";
import { useId, useState, useSyncExternalStore } from "react";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
  Polygon,
  Dot,
} from "recharts";
import {
  orderRadarSkills,
  RADAR_MODES,
  type RadarMode,
  type SkillRadarData,
} from "@/lib/skill-radar";
import { SkillRatingCard, SKILL_ACCENTS } from "./skill-rating-card";
import {
  RatingModeSelector,
  type SelectableRatingMode,
} from "./rating-mode-selector";
import { LoadingSkeleton } from "./common";
const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  const media = window.matchMedia?.(motionQuery);
  media?.addEventListener("change", callback);
  return () => media?.removeEventListener("change", callback);
}
const motionSnapshot = () =>
  typeof window === "undefined" || !window.matchMedia
    ? true
    : window.matchMedia(motionQuery).matches;
const format = (value: number | null) =>
  value === null ? "Not rated" : `${Number(value.toFixed(8))} / 5`;
type Axis = ReturnType<typeof orderRadarSkills>[number];
interface RadarShapeProps {
  points?: { x: number; y: number; value?: unknown }[];
  stroke?: string;
  fill?: string;
  fillOpacity?: number;
  filter?: string;
}
// Recharts Radar normally places null values at its center. Use its own Polygon
// primitive with gaps instead; a missing value must never look like a low score.
function RatingPolygon({
  points = [],
  stroke,
  fill,
  fillOpacity,
  filter,
}: RadarShapeProps) {
  const complete = points.every((point) => typeof point.value === "number");
  return (
    <Polygon
      points={points.map((point) =>
        typeof point.value === "number" ? point : { x: NaN, y: NaN },
      )}
      stroke={stroke}
      strokeWidth={2.5}
      fill={complete ? fill : "none"}
      fillOpacity={fillOpacity}
      connectNulls={false}
      filter={filter}
    />
  );
}
function RatingDot({
  cx,
  cy,
  value,
  stroke,
  payload,
  colorful = false,
}: {
  payload?: Axis;
  colorful?: boolean;
  cx?: number;
  cy?: number;
  value?: unknown;
  stroke?: string;
}) {
  return (
    <Dot
      cx={cx ?? 0}
      cy={cy ?? 0}
      r={typeof value === "number" ? 3 : 0}
      fill={colorful && payload ? SKILL_ACCENTS[payload.axisKey] : stroke}
      stroke={colorful && payload ? SKILL_ACCENTS[payload.axisKey] : stroke}
    />
  );
}
function SkillDetails({
  point,
  mode,
  compare,
}: {
  point: Axis;
  mode: RadarMode;
  compare: boolean;
}) {
  const difference =
    point.internalRating !== null && point.selfRating !== null
      ? Number((point.internalRating - point.selfRating).toFixed(8))
      : null;
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
      <p className="font-semibold">{point.skillName}</p>
      {compare ? (
        <>
          <p>Self-assessment: {format(point.selfRating)}</p>
          <p>Internal rating: {format(point.internalRating)}</p>
          <p>
            Difference:{" "}
            {difference === null
              ? "Not available"
              : `${difference > 0 ? "+" : ""}${difference}`}
          </p>
        </>
      ) : (
        <p>
          {RADAR_MODES[mode].label}: {format(point[RADAR_MODES[mode].field])}
        </p>
      )}
    </div>
  );
}
export function PlayerSkillRadarChart({
  data,
  mode: fixedMode,
  allowCompare = true,
  loading = false,
  onSkillSelect,
  onModeChange,
  immersive = false,
}: {
  data: SkillRadarData[];
  immersive?: boolean;
  mode?: RadarMode;
  allowCompare?: boolean;
  loading?: boolean;
  onSkillSelect?: (skillId: string) => void;
  onModeChange?: (mode: SelectableRatingMode) => void;
}) {
  const id = useId();
  const gradientId = `skill-spectrum-${id.replace(/:/g, "-")}`;
  const glowId = `skill-glow-${id.replace(/:/g, "-")}`;
  const [chosen, setChosen] = useState<SelectableRatingMode>("internal");
  const [compare, setCompare] = useState(false);
  const [selected, setSelected] = useState("passing");
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    motionSnapshot,
    () => true,
  );
  const points = orderRadarSkills(data);
  const mode = fixedMode ?? chosen;
  const comparing = allowCompare && compare;
  const series: RadarMode[] = comparing ? ["internal", "self"] : [mode];
  const active =
    points.find((point) => point.axisKey === selected) ?? points[0];
  const missing = points.filter((point) =>
    series.some((source) => point[RADAR_MODES[source].field] === null),
  );
  const empty = points.every((point) =>
    series.every((source) => point[RADAR_MODES[source].field] === null),
  );
  if (loading) return <LoadingSkeleton />;
  return (
    <div
      className={`min-w-0 space-y-3 ${immersive ? "radar-immersive" : ""}`}
      role="group"
      aria-label={`${fixedMode ? RADAR_MODES[fixedMode].label : "Player skill"} radar chart`}
    >
      <div className="radar-controls flex flex-wrap items-end gap-3">
        {!fixedMode && (
          <RatingModeSelector
            id={id}
            value={chosen}
            disabled={comparing}
            onChange={(next) => {
              setChosen(next);
              onModeChange?.(next);
            }}
          />
        )}
        {allowCompare && (
          <label className="flex min-h-11 items-center gap-2 text-sm font-normal">
            <input
              type="checkbox"
              checked={comparing}
              onChange={(event) => setCompare(event.target.checked)}
            />
            Compare internal and self ratings
          </label>
        )}
      </div>
      <div className={immersive ? "radar-stage" : ""}>
        <div
          className={`radar-plot mx-auto h-80 min-w-0 w-full max-w-2xl sm:h-96`}
          aria-hidden="true"
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <RadarChart
              data={points}
              outerRadius="85%"
              startAngle={90}
              endAngle={-270}
              margin={{
                top: 28,
                right: immersive ? 44 : 30,
                bottom: 28,
                left: immersive ? 44 : 30,
              }}
            >
              <defs>
                <linearGradient
                  id={gradientId}
                  x1="10%"
                  y1="0%"
                  x2="90%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#e4e66a" />
                  <stop offset="25%" stopColor="#ffb063" />
                  <stop offset="50%" stopColor="#f37cb8" />
                  <stop offset="75%" stopColor="#62d9ef" />
                  <stop offset="100%" stopColor="#74e4aa" />
                </linearGradient>
                <filter
                  id={glowId}
                  x="-25%"
                  y="-25%"
                  width="150%"
                  height="150%"
                >
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <PolarGrid gridType="polygon" stroke="var(--border)" />
              <PolarAngleAxis
                dataKey="skillName"
                tick={{ fill: "var(--foreground)", fontSize: 11 }}
                tickSize={8}
              />
              <PolarRadiusAxis
                domain={immersive ? [0, 5] : [1, 5]}
                ticks={[1, 2, 3, 4, 5]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                angle={90}
              />
              {series.map((source) => (
                <Radar
                  key={source}
                  name={RADAR_MODES[source].label}
                  dataKey={RADAR_MODES[source].field}
                  stroke={
                    immersive && !comparing
                      ? `url(#${gradientId})`
                      : RADAR_MODES[source].color
                  }
                  fill={
                    immersive && !comparing
                      ? `url(#${gradientId})`
                      : RADAR_MODES[source].color
                  }
                  fillOpacity={immersive ? 0.28 : 0.17}
                  strokeWidth={2.5}
                  shape={(props: RadarShapeProps) => (
                    <RatingPolygon
                      {...props}
                      filter={immersive ? `url(#${glowId})` : undefined}
                    />
                  )}
                  dot={(props: {
                    cx?: number;
                    cy?: number;
                    value?: unknown;
                    stroke?: string;
                    payload?: Axis;
                  }) => (
                    <RatingDot {...props} colorful={immersive && !comparing} />
                  )}
                  isAnimationActive={!reducedMotion}
                  animationDuration={350}
                  connectNulls={false}
                />
              ))}
              <Tooltip
                content={({ active: visible, payload }) => {
                  const point = payload?.[0]?.payload as Axis | undefined;
                  return visible && point ? (
                    <SkillDetails
                      point={point}
                      mode={mode}
                      compare={comparing}
                    />
                  ) : null;
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        {immersive && (
          <div className="radar-skill-cards" aria-label="Explore skill ratings">
            {points.map((point) => (
              <SkillRatingCard
                key={point.axisKey}
                name={point.skillName}
                axis={point.axisKey}
                rating={point[RADAR_MODES[comparing ? "internal" : mode].field]}
                selfRating={point.selfRating}
                selected={selected === point.axisKey}
                onSelect={() => {
                  setSelected(point.axisKey);
                  if (point.skillId) onSkillSelect?.(point.skillId);
                }}
              />
            ))}
          </div>
        )}
      </div>
      {comparing && (
        <div className="flex flex-wrap gap-4 text-xs" aria-label="Radar legend">
          {series.map((source) => (
            <span key={source} className="inline-flex items-center gap-2">
              <span
                className="h-1 w-5 rounded"
                style={{ backgroundColor: RADAR_MODES[source].color }}
              />
              {RADAR_MODES[source].label}
            </span>
          ))}
        </div>
      )}
      {empty && (
        <p role="status" className="subtle text-sm">
          No recorded ratings for this view.
        </p>
      )}
      {!!missing.length && (
        <p className="subtle text-xs">
          Missing ratings: {missing.map((point) => point.skillName).join(", ")}.
          Missing points are omitted; incomplete profiles have no filled
          polygon.
        </p>
      )}
      {!immersive && (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          aria-label="Explore skill ratings"
        >
          {points.map((point) => (
            <button
              key={point.axisKey}
              type="button"
              className={`min-h-11 rounded-lg border p-2 text-left text-xs ${selected === point.axisKey ? "border-primary bg-accent" : "border-border"}`}
              aria-pressed={selected === point.axisKey}
              onClick={() => {
                setSelected(point.axisKey);
                if (point.skillId) onSkillSelect?.(point.skillId);
              }}
            >
              <span className="block font-semibold">{point.skillName}</span>
              <span>
                {comparing
                  ? `Self: ${format(point.selfRating)} · Internal: ${format(point.internalRating)}`
                  : format(point[RADAR_MODES[mode].field])}
              </span>
            </button>
          ))}
        </div>
      )}
      {!immersive && (
        <div className="radar-detail" aria-live="polite">
          <SkillDetails point={active} mode={mode} compare={comparing} />
        </div>
      )}
    </div>
  );
}
