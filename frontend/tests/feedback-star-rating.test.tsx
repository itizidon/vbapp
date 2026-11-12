import React, { useState } from "react";
import { expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FeedbackStarRating } from "../src/components/feedback-star-rating";
function Rating() {
  const [value, setValue] = useState<number | null>(null);
  return (
    <FeedbackStarRating label="Passing" value={value} onChange={setValue} />
  );
}
it("previews hover without selection and selects or clears a nullable rating", () => {
  render(<Rating />);
  const four = screen.getByRole("radio", { name: "Passing: 4 out of 5" });
  fireEvent.mouseEnter(four);
  expect(four.querySelector("svg")).toHaveAttribute("fill", "currentColor");
  expect(four).not.toBeChecked();
  expect(screen.getByText("Not rated yet")).toBeVisible();
  fireEvent.mouseLeave(screen.getByRole("radiogroup"));
  expect(four.querySelector("svg")).toHaveAttribute("fill", "none");
  fireEvent.click(four);
  expect(four).toBeChecked();
  expect(screen.getByText("Rating: 4/5")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Clear rating" }));
  expect(screen.getByText("Not rated yet")).toBeVisible();
  expect(
    screen
      .getAllByRole("radio")
      .every((r) => r.getAttribute("aria-checked") === "false"),
  ).toBe(true);
});
it("supports keyboard arrows, Home and End with roving radio focus", () => {
  render(<Rating />);
  const one = screen.getByRole("radio", { name: "Passing: 1 out of 5" });
  one.focus();
  fireEvent.keyDown(one, { key: "ArrowRight" });
  const two = screen.getByRole("radio", { name: "Passing: 2 out of 5" });
  expect(two).toHaveFocus();
  expect(two).toBeChecked();
  fireEvent.keyDown(two, { key: "End" });
  const five = screen.getByRole("radio", { name: "Passing: 5 out of 5" });
  expect(five).toBeChecked();
  fireEvent.keyDown(five, { key: "Home" });
  expect(one).toBeChecked();
  fireEvent.keyDown(one, { key: "ArrowLeft" });
  expect(five).toBeChecked();
  expect(five).toHaveAttribute("tabIndex", "0");
  expect(one).toHaveAttribute("tabIndex", "-1");
});
