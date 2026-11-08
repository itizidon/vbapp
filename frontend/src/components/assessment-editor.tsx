"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "@/lib/api";
import type { Assessment, Sport } from "@/lib/types";
import { validateRatings } from "@/lib/validation";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Pending, RatingStars } from "./common";
export function AssessmentEditor({
  sport,
  assessment,
}: {
  sport: Sport;
  assessment?: Assessment;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>(
    Object.fromEntries(
      assessment?.ratings.map((r) => [r.skillId, r.rating]) ?? [],
    ),
  );
  const [level, setLevel] = useState(assessment?.overallLevel ?? "B");
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      const values = Object.entries(ratings)
        .filter(([, v]) => v > 0)
        .map(([skillId, rating]) => ({ skillId, rating }));
      if (
        !validateRatings(values) ||
        sport.skills.some(
          (s) => s.active && s.requiredForSelfAssessment && !ratings[s.id],
        )
      )
        throw new Error("Rate all required skills and at least one category.");
      if (!level.trim()) throw new Error("Enter an overall level.");
      if (assessment) {
        await gql(
          `mutation UpdateLevel($input:UpdateSelfAssessmentInput!){updateSelfAssessment(input:$input){id}}`,
          { input: { id: assessment.id, overallLevel: level } },
        );
        await gql(
          `mutation UpdateRatings($input:UpdateSelfAssessmentRatingsInput!){updateSelfAssessmentRatings(input:$input){id}}`,
          { input: { id: assessment.id, ratings: values } },
        );
      } else
        await gql(
          `mutation CreateAssessment($input:CreateSelfAssessmentInput!){createSelfAssessment(input:$input){id}}`,
          {
            input: { sportId: sport.id, overallLevel: level, ratings: values },
          },
        );
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["summary"] });
      setMessage("Self-assessment saved.");
      setOpen(false);
    },
    onError: () => client.invalidateQueries({ queryKey: ["summary"] }),
  });
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setRatings(
            Object.fromEntries(
              assessment?.ratings.map((r) => [r.skillId, r.rating]) ?? [],
            ),
          );
          setLevel(assessment?.overallLevel ?? "B");
          setOpen(true);
        }}
      >
        {assessment ? "Edit assessment" : "Add assessment"}
      </Button>
      {message && (
        <p role="status" className="mt-2 text-xs text-primary">
          {message}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="pr-8 text-xl font-bold">
            Your {sport.name} perspective
          </DialogTitle>
          <DialogDescription className="subtle mb-5 mt-2 text-sm">
            Your self-assessment stays separate from peer and system ratings.
            Existing ratings can be changed, but the API does not support
            removing them.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            className="space-y-5"
          >
            <label className="field">
              Overall level
              {["volleyball", "beach-volleyball"].includes(sport.slug) ? (
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                >
                  {["B", "BB", "A", "AA", "OPEN"].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  required
                />
              )}
            </label>
            {sport.skills
              .filter((s) => s.active)
              .map((s) => (
                <div key={s.id}>
                  <label>
                    {s.name}
                    {s.requiredForSelfAssessment ? " *" : " (optional)"}
                  </label>
                  <RatingStars
                    value={ratings[s.id] ?? 0}
                    label={s.name}
                    onChange={(n) =>
                      setRatings((r) => ({
                        ...r,
                        [s.id]:
                          n ||
                          (assessment?.ratings.some(
                            (previous) => previous.skillId === s.id,
                          )
                            ? r[s.id]
                            : 0),
                      }))
                    }
                  />
                </div>
              ))}
            {mutation.error && (
              <p role="alert" className="error">
                {mutation.error.message} If one step saved, reopen this form to
                reload your current values.
              </p>
            )}
            <Button disabled={mutation.isPending} className="w-full">
              {mutation.isPending ? <Pending /> : "Save self-assessment"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
