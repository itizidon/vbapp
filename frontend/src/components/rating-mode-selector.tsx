export type SelectableRatingMode = "internal" | "self";
export function RatingModeSelector({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: SelectableRatingMode;
  disabled: boolean;
  onChange: (mode: SelectableRatingMode) => void;
}) {
  const self = value === "self";
  return (
    <fieldset className="field min-w-0 w-full sm:w-auto sm:min-w-52 sm:flex-1">
      <legend>Rating source</legend>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center text-xs">
        <span className={!self ? "font-semibold text-primary" : "subtle"}>
          Internal rating
        </span>
        <button
          id={id}
          type="button"
          role="switch"
          aria-label="Self-assessment ratings"
          aria-checked={self}
          disabled={disabled}
          onClick={() => onChange(self ? "internal" : "self")}
          className="inline-flex min-h-11 items-center rounded-lg p-1 disabled:opacity-50"
        >
          <span
            className={`inline-flex h-7 w-12 items-center rounded-full p-1 transition-colors ${self ? "bg-primary" : "bg-muted-foreground"}`}
          >
            <span
              className={`size-5 rounded-full bg-white shadow transition-transform ${self ? "translate-x-5" : "translate-x-0"}`}
            />
          </span>
        </button>
        <span className={self ? "font-semibold text-primary" : "subtle"}>
          Self-assessment
        </span>
      </div>
    </fieldset>
  );
}
