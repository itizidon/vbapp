"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, LoaderCircle, Trash2 } from "lucide-react";
import { gql } from "@/lib/api";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
const field =
  "mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120)
    .replace(/-$/g, "");
type Options = {
  skillTree: { nodes: { id: string; name: string; status: string }[] };
  sports: {
    slug: string;
    skills: { id: string; name: string; active: boolean }[];
  }[];
};
export function CreateDrillDialog() {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [slug, setSlug] = useState(""),
    [slugEdited, setSlugEdited] = useState(false),
    [description, setDescription] = useState(""),
    [objective, setObjective] = useState(""),
    [setup, setSetup] = useState(""),
    [difficulty, setDifficulty] = useState("BEGINNER"),
    [duration, setDuration] = useState("10"),
    [minPlayers, setMinPlayers] = useState("1"),
    [maxPlayers, setMaxPlayers] = useState("2"),
    [skill, setSkill] = useState(""),
    [newSkillName, setNewSkillName] = useState(""),
    [category, setCategory] = useState(""),
    [why, setWhy] = useState(""),
    [steps, setSteps] = useState([{ key: 0, text: "" }]),
    [cues, setCues] = useState(""),
    [equipment, setEquipment] = useState(""),
    [safety, setSafety] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const nextStep = useRef(1),
    locked = useRef(false);
  const router = useRouter(),
    client = useQueryClient();
  const options = useQuery({
    queryKey: ["drill-creation-options"],
    enabled: open,
    staleTime: 0,
    queryFn: () =>
      gql<Options>(
        `query DrillCreationOptions{skillTree{nodes{id name status}}sports{slug skills{id name active}}}`,
      ),
  });
  const publishedSkills =
    options.data?.skillTree.nodes.filter((s) => s.status === "PUBLISHED") ?? [];
  const categories =
    options.data?.sports
      .find((s) => s.slug === "beach-volleyball")
      ?.skills.filter((s) => s.active) ?? [];
  const lines = (s: string) =>
    s
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current) return;
    const instructions = steps.map((s) => s.text.trim());
    if (!skill) {
      setError("Choose a primary skill or create a new skill.");
      return;
    }
    if (instructions.some((s) => !s)) {
      setError("Complete each instruction or remove empty steps.");
      return;
    }
    if (Number(minPlayers) > Number(maxPlayers)) {
      setError("Maximum players must be at least the minimum players.");
      return;
    }
    if (
      skill === "new" &&
      (!categories.some((c) => c.id === category) ||
        !newSkillName.trim() ||
        !why.trim())
    ) {
      setError("Complete the new skill name, category and why it matters.");
      return;
    }
    if (![name, description, objective, setup].every((s) => s.trim())) {
      setError("Complete the drill details.");
      return;
    }
    const cueLines = lines(cues),
      gearLines = lines(equipment);
    if (
      cueLines.length > 50 ||
      gearLines.length > 50 ||
      [...cueLines, ...gearLines].some((s) => s.length > 120)
    ) {
      setError(
        "Use at most 50 equipment items and cues, each no longer than 120 characters.",
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const input = {
        drill: {
          name: name.trim(),
          slug,
          description: description.trim(),
          objective: objective.trim(),
          setup: setup.trim(),
          difficulty,
          durationMinutes: Number(duration),
          minPlayers: Number(minPlayers),
          maxPlayers: Number(maxPlayers),
          coachingCues: cueLines,
          equipment: gearLines,
          ...(safety.trim() ? { safetyNotes: safety.trim() } : {}),
          status: "PUBLISHED",
        },
        steps: instructions.map((instruction) => ({ instruction })),
        ...(skill === "new"
          ? {
              newPrimarySkill: {
                name: newSkillName.trim(),
                slug: `${slugify(newSkillName) || "skill"}-${crypto.randomUUID().slice(0, 8)}`,
                categoryId: category,
                description: description.trim(),
                learningObjective: objective.trim(),
                whyItMatters: why.trim(),
                status: "PUBLISHED",
              },
            }
          : { primarySkillId: skill }),
      };
      const result = await gql<{ createDrillWithContent: { id: string } }>(
        `mutation CreateDrillWithContent($input:CreateDrillWithContentInput!){createDrillWithContent(input:$input){id}}`,
        { input },
      );
      void client.invalidateQueries({ queryKey: ["training-drills"] });
      void client.invalidateQueries({ queryKey: ["training-skills"] });
      void client.invalidateQueries({ queryKey: ["drill-creation-options"] });
      setOpen(false);
      router.push(`/admin/drills/${result.createDrillWithContent.id}/videos`);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not create the drill. Your entries have been kept.",
      );
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!locked.current) {
          setOpen(value);
          setError("");
        }
      }}
    >
      <Button onClick={() => setOpen(true)}>
        <Plus size={18} />
        Create drill
      </Button>
      <DialogContent className="max-w-3xl">
        <DialogTitle className="pr-10 text-2xl font-bold">
          Create a drill
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          Add the goal, setup, instructions and primary skill. Publishing makes
          this drill available in the player training library.
        </DialogDescription>
        <form onSubmit={submit} className="mt-6 space-y-5">
          <fieldset disabled={busy} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Drill name
                <input
                  required
                  maxLength={120}
                  className={field}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slugEdited) setSlug(slugify(e.target.value));
                  }}
                  placeholder="Controlled platform passing"
                />
              </label>
              <label className="text-sm font-medium">
                URL slug
                <input
                  required
                  pattern="[a-z0-9]+(?:(?:-|_)[a-z0-9]+)*"
                  maxLength={120}
                  className={field}
                  value={slug}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlug(e.target.value);
                  }}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  A unique name using lowercase letters, numbers and hyphens.
                </span>
              </label>
            </div>
            <label className="block text-sm font-medium">
              Description
              <textarea
                required
                maxLength={5000}
                className={field}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Learning objective
              <textarea
                required
                maxLength={5000}
                className={field}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="What should the player learn?"
              />
            </label>
            <label className="block text-sm font-medium">
              Setup
              <textarea
                required
                maxLength={5000}
                className={field}
                value={setup}
                onChange={(e) => setSetup(e.target.value)}
                placeholder="Space, equipment and player positions"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm font-medium">
                Difficulty
                <select
                  className={field}
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                >
                  <option value="BEGINNER">Beginner</option>
                  <option value="INTERMEDIATE">Intermediate</option>
                  <option value="ADVANCED">Advanced</option>
                </select>
              </label>
              <label className="text-sm font-medium">
                Duration (minutes)
                <input
                  required
                  type="number"
                  min={1}
                  max={240}
                  className={field}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Minimum players
                <input
                  required
                  type="number"
                  min={1}
                  max={10000}
                  className={field}
                  value={minPlayers}
                  onChange={(e) => setMinPlayers(e.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Maximum players
                <input
                  required
                  type="number"
                  min={1}
                  max={10000}
                  className={field}
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(e.target.value)}
                />
              </label>
            </div>
            <section className="space-y-3 rounded-xl border border-border p-4">
              <h3 className="font-semibold">Primary skill</h3>
              {options.isPending ? (
                <p role="status" className="text-sm">
                  Loading available skills…
                </p>
              ) : options.error ? (
                <div role="alert" className="text-sm">
                  <p>{options.error.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => options.refetch()}
                  >
                    Retry loading skills
                  </Button>
                </div>
              ) : (
                <>
                  <label className="block text-sm font-medium">
                    Skill
                    <select
                      required
                      className={field}
                      value={skill}
                      onChange={(e) => setSkill(e.target.value)}
                    >
                      <option value="">Choose a primary skill</option>
                      {publishedSkills.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value="new">Create a new skill…</option>
                    </select>
                  </label>
                  {!publishedSkills.length && (
                    <p className="text-sm text-muted-foreground">
                      There are no published skills yet. Choose “Create a new
                      skill” to start your library.
                    </p>
                  )}
                  {skill === "new" && (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium">
                        New skill name
                        <input
                          required
                          maxLength={120}
                          className={field}
                          value={newSkillName}
                          onChange={(e) => setNewSkillName(e.target.value)}
                          placeholder="Platform control"
                        />
                      </label>
                      <label className="block text-sm font-medium">
                        Volleyball category
                        <select
                          required
                          className={field}
                          value={category}
                          disabled={options.isFetching || !categories.length}
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          <option value="">Choose a category</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {options.isFetching ? (
                        <p
                          role="status"
                          className="text-sm text-muted-foreground"
                        >
                          Loading volleyball categories…
                        </p>
                      ) : (
                        !categories.length && (
                          <div className="space-y-2 text-sm">
                            <p role="status">
                              No active volleyball categories are available.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => options.refetch()}
                            >
                              Reload categories
                            </Button>
                          </div>
                        )
                      )}
                      <label className="block text-sm font-medium">
                        Why this skill matters
                        <textarea
                          required
                          maxLength={5000}
                          className={field}
                          value={why}
                          onChange={(e) => setWhy(e.target.value)}
                        />
                      </label>
                      <p className="text-xs text-muted-foreground">
                        The new skill is published with this drill and uses its
                        description and learning objective.
                      </p>
                    </div>
                  )}
                </>
              )}
            </section>
            <fieldset className="space-y-3">
              <legend className="mb-2 font-semibold">Instructions</legend>
              {steps.map((step, index) => (
                <div key={step.key} className="flex items-start gap-2">
                  <label className="flex-1 text-sm font-medium">
                    Step {index + 1}
                    <textarea
                      required
                      maxLength={2000}
                      className={field}
                      value={step.text}
                      onChange={(e) =>
                        setSteps((old) =>
                          old.map((s) =>
                            s.key === step.key
                              ? { ...s, text: e.target.value }
                              : s,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    className="mt-6 shrink-0"
                    type="button"
                    variant="ghost"
                    aria-label={`Remove step ${index + 1}`}
                    disabled={steps.length === 1}
                    onClick={() =>
                      setSteps((old) => old.filter((s) => s.key !== step.key))
                    }
                  >
                    <Trash2 size={18} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={steps.length >= 100}
                onClick={() =>
                  setSteps((old) => [
                    ...old,
                    { key: nextStep.current++, text: "" },
                  ])
                }
              >
                <Plus size={16} />
                Add step
              </Button>
            </fieldset>
            <details className="space-y-4">
              <summary className="cursor-pointer font-semibold">
                Equipment, coaching cues and safety notes
              </summary>
              <label className="block text-sm font-medium">
                Equipment (one item per line)
                <textarea
                  className={field}
                  value={equipment}
                  onChange={(e) => setEquipment(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Coaching cues (one per line)
                <textarea
                  className={field}
                  value={cues}
                  onChange={(e) => setCues(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Safety notes
                <textarea
                  maxLength={5000}
                  className={field}
                  value={safety}
                  onChange={(e) => setSafety(e.target.value)}
                />
              </label>
            </details>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                options.isPending ||
                !!options.error ||
                (skill === "new" &&
                  (options.isFetching ||
                    !categories.some((c) => c.id === category)))
              }
            >
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {busy ? "Creating drill…" : "Create and publish"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
