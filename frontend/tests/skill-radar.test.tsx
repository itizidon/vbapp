import React from "react";
import { expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PlayerSkillRadarChart } from "../src/components/player-skill-radar-chart";
import {
  orderRadarSkills,
  validRadarRating,
  radarSnapshotTime,
  type SkillRadarData,
} from "../src/lib/skill-radar";
const data: SkillRadarData[] = [
  "Defense",
  "Serving",
  "Attacking",
  "Setting",
  "Passing",
].map((name, i) => ({
  skillId: `real-${i}`,
  skillName: name,
  skillSlug: name.toLowerCase(),
  selfRating: 4,
  internalRating: 3.5,
  averageFeedbackRating: 4.25,
}));
it("maps backend IDs and aliases to a consistent five-axis order", () => {
  expect(orderRadarSkills(data).map((row) => row.axisKey)).toEqual([
    "passing",
    "setting",
    "attack",
    "serving",
    "defense",
  ]);
  expect(orderRadarSkills(data)[2].skillId).toBe("real-2");
  expect(orderRadarSkills([]).map((row) => row.internalRating)).toEqual([
    null,
    null,
    null,
    null,
    null,
  ]);
});
it("treats missing and out-of-bounds values as unavailable rather than zero", () => {
  for (const value of [null, undefined, 0, 6, Infinity, NaN])
    expect(validRadarRating(value)).toBeNull();
  expect(validRadarRating(1)).toBe(1);
  expect(validRadarRating(5)).toBe(5);
});
it("defaults to internal and switches between internal and self with comparison", () => {
  render(<PlayerSkillRadarChart data={data} />);
  expect(
    screen.getByRole("switch", { name: "Self-assessment ratings" }),
  ).not.toBeChecked();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByText("Average feedback")).not.toBeInTheDocument();
  const controls = within(screen.getByLabelText("Explore skill ratings"));
  expect(controls.getAllByRole("button")).toHaveLength(5);
  expect(controls.getByRole("button", { name: /Passing/ })).toHaveTextContent(
    "3.5 / 5",
  );
  fireEvent.click(screen.getByRole("switch"));
  expect(controls.getByRole("button", { name: /Passing/ })).toHaveTextContent(
    "4 / 5",
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Compare internal and self ratings" }),
  );
  expect(screen.getByText("Difference: -0.5")).toBeVisible();
  expect(screen.getByLabelText("Radar legend")).toBeVisible();
  expect(screen.getByRole("switch")).toBeDisabled();
});
it("defaults to internal even when missing and allows switching to self-assessment", () => {
  render(
    <PlayerSkillRadarChart
      data={data.map((row) => ({ ...row, internalRating: null }))}
    />,
  );
  expect(screen.getByRole("switch")).not.toBeChecked();
  expect(screen.getByText("No recorded ratings for this view.")).toBeVisible();
  expect(screen.getByText(/Missing ratings:/)).toBeVisible();
  expect(
    within(screen.getByLabelText("Explore skill ratings")).getAllByText(
      "Not rated",
    ),
  ).toHaveLength(5);
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByRole("switch")).toBeChecked();
  expect(
    screen.queryByText("No recorded ratings for this view."),
  ).not.toBeInTheDocument();
});
it("supports fixed card modes and selecting skills without navigation", () => {
  let selected = "";
  render(
    <PlayerSkillRadarChart
      data={data}
      mode="self"
      allowCompare={false}
      onSkillSelect={(id) => {
        selected = id;
      }}
    />,
  );
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Defense/ }));
  expect(selected).toBe("real-0");
});
it("creates UTC end-of-day snapshots and clamps today to a stable supplied now", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  expect(radarSnapshotTime("2026-11-01", now)).toBe("2026-11-01T23:59:59.999Z");
  expect(radarSnapshotTime("2026-11-11", now)).toBe(now.toISOString());
  expect(radarSnapshotTime("invalid", now)).toBeNull();
});
it("shows a loading state before chart data is available", () => {
  render(<PlayerSkillRadarChart data={[]} loading />);
  expect(
    screen.queryByLabelText("Explore skill ratings"),
  ).not.toBeInTheDocument();
});
