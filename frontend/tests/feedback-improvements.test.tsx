import React from "react";
import { expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoryRatingInput } from "../src/components/feedback-form";
import { localDateTimeValue } from "../src/lib/date-time";
import { safeReturnTo, authHref } from "../src/lib/navigation";
it("makes each category explanation available to rating controls", () => {
  render(
    <CategoryRatingInput
      name="Passing"
      description="Control the first touch."
      value={3}
      onChange={() => {}}
    />,
  );
  expect(
    screen.getByRole("group", { name: "Passing" }),
  ).toHaveAccessibleDescription("Control the first touch.");
});
it("formats the date input in local time, not UTC", () => {
  expect(localDateTimeValue(new Date(2026, 10, 8, 13, 5, 49))).toBe(
    "2026-11-08T13:05",
  );
});
it("preserves feedback return destinations for login and signup", () => {
  const path = "/f/a-token?context=match";
  expect(
    new URL(authHref("/signup", path), "https://example.test").searchParams.get(
      "next",
    ),
  ).toBe(path);
  expect(safeReturnTo(path)).toBe(path);
});
it.each(["https://other.test", "//other.test", "/\\other.test", "/bad\npath"])(
  "rejects external or invalid return paths: %s",
  (value) => expect(safeReturnTo(value)).toBe("/matches"),
);

it("provides a separate optional comment field for each rated category", () => {
  const onCommentChange = vi.fn();
  render(
    <CategoryRatingInput
      name="Passing"
      value={4}
      onChange={() => {}}
      comment="Good control"
      onCommentChange={onCommentChange}
    />,
  );
  const input = screen.getByRole("textbox", {
    name: "Passing comment (optional)",
  });
  expect(input).toHaveValue("Good control");
  fireEvent.change(input, { target: { value: "Reliable first touch." } });
  expect(onCommentChange).toHaveBeenCalledWith("Reliable first touch.");
});
