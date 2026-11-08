"use client";
import {
  Star,
  MessageSquare,
  AlertCircle,
  Loader2,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "./ui/button";
export function UserAvatar({
  name,
  size = "normal",
}: {
  name: string;
  size?: "normal" | "large";
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-bold text-primary ${size === "large" ? "size-20 text-2xl" : "size-10 text-sm"}`}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
export function LoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="grid gap-5">
      <div className="h-10 w-52 animate-pulse rounded-lg bg-muted" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <div role="alert" className="panel flex flex-col items-start gap-3">
      <AlertCircle className="text-red-500" />
      <h2>Something needs attention</h2>
      <p className="subtle break-anywhere">{error.message}</p>
      {retry && (
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function EmptyState({
  title = "Your next chapter starts here",
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-accent text-primary">
        <MessageSquare size={22} />
      </div>
      <h3>{title}</h3>
      <div className="subtle max-w-sm text-sm">
        {children ??
          "Request feedback from someone you play with to start seeing your progress."}
      </div>
    </div>
  );
}
export function RatingStars({
  value,
  onChange,
  label = "Rating",
  descriptionId,
}: {
  value: number;
  onChange?: (n: number) => void;
  label?: string;
  descriptionId?: string;
}) {
  if (!onChange)
    return (
      <span
        aria-label={`${value.toFixed(1)} out of 5`}
        className="inline-flex gap-0.5 text-amber-500"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            size={14}
            fill={n <= Math.round(value) ? "currentColor" : "none"}
          />
        ))}
      </span>
    );
  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={descriptionId}
      className="flex flex-wrap items-center"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${label}: ${n} out of 5`}
          aria-pressed={value === n}
          onClick={() => onChange(value === n ? 0 : n)}
          className="grid size-11 place-items-center rounded-lg text-amber-500 hover:bg-muted"
        >
          <Star size={26} fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
      <span className="subtle ml-2 text-xs">
        {value ? `${value}/5` : "Not rated"}
      </span>
    </div>
  );
}
export function SummaryStatCard({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string | number;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="panel">
      <div className="flex items-center justify-between gap-2">
        <span className="subtle text-sm">{label}</span>
        <span className="text-primary">{icon}</span>
      </div>
      <div className="mb-2 mt-4 text-3xl font-bold tracking-tight">{value}</div>
      <p className="subtle text-xs">{note}</p>
    </div>
  );
}
export function Pending({ label = "Saving…" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </span>
  );
}
export { ArrowUpRight };
