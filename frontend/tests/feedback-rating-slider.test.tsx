import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FeedbackRatingSlider } from "@/components/feedback-rating-slider";
import { isFeedbackRating } from "@/lib/feedback-rating";
function Example() {
  const [value, setValue] = useState<number | null>(null);
  return (
    <FeedbackRatingSlider
      skillName="Passing"
      value={value}
      onChange={setValue}
    />
  );
}
it("leaves the initial slider position uncommitted until a deliberate interaction, and clears it", () => {
  render(<Example />);
  const slider = screen.getByRole("slider", { name: "Passing rating" });
  expect(screen.getByText("Not rated")).toBeVisible();
  fireEvent.focus(slider);
  expect(screen.getByText("Not rated")).toBeVisible();
  fireEvent.keyDown(slider, { key: "Enter" });
  expect(screen.getByText("3.0 / 5.0")).toBeVisible();
  fireEvent.change(slider, { target: { value: "4.7" } });
  expect(screen.getByText("4.7 / 5.0")).toBeVisible();
  expect(slider).toHaveAttribute("step", "0.1");
  fireEvent.click(screen.getByRole("button", { name: "Clear Passing rating" }));
  expect(screen.getByText("Not rated")).toBeVisible();
});
it("supports exact tenths with keyboard arrows, bounds, Home, End and Page keys", () => {
  render(<Example />);
  const slider = screen.getByRole("slider");
  fireEvent.keyDown(slider, { key: "End" });
  fireEvent.keyDown(slider, { key: "ArrowLeft" });
  expect(slider).toHaveValue("4.9");
  for (let i = 0; i < 7; i++) fireEvent.keyDown(slider, { key: "ArrowLeft" });
  expect(slider).toHaveValue("4.2");
  fireEvent.keyDown(slider, { key: "PageDown" });
  expect(slider).toHaveValue("3.2");
  fireEvent.keyDown(slider, { key: "Home" });
  fireEvent.keyDown(slider, { key: "ArrowLeft" });
  expect(slider).toHaveValue("1");
});
it("commits a pointer release even when the thumb stays at its initial position", () => {
  render(<Example />);
  fireEvent.pointerUp(screen.getByRole("slider"));
  expect(screen.getByText("3.0 / 5.0")).toBeVisible();
});
it("distinguishes Skipped and disables both range and clear controls", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <FeedbackRatingSlider
      skillName="Serving"
      value={null}
      skipped
      onChange={onChange}
    />,
  );
  expect(screen.getByText("Skipped")).toBeVisible();
  rerender(
    <FeedbackRatingSlider
      skillName="Serving"
      value={4.7}
      disabled
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("slider")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Clear Serving rating" }),
  ).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
  expect(onChange).not.toHaveBeenCalled();
});
it.each([1, 2.5, 3.5, 4.2, 4.7, 5])("validates %s on the client", (value) =>
  expect(isFeedbackRating(value)).toBe(true),
);
it.each([0, 5.5, 3.55, NaN, Infinity, 4.199999999999999])(
  "rejects %s instead of rounding",
  (value) => expect(isFeedbackRating(value)).toBe(false),
);
