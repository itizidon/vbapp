import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RatingStars, EmptyState } from "../src/components/common";
it("offers accessible touch-sized rating controls with a clear action", () => {
  const onChange = vi.fn();
  render(<RatingStars value={3} label="Serve" onChange={onChange} />);
  const selected = screen.getByRole("button", { name: "Serve: 3 out of 5" });
  expect(selected).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(selected);
  expect(onChange).toHaveBeenCalledWith(0);
  fireEvent.click(screen.getByRole("button", { name: "Serve: 5 out of 5" }));
  expect(onChange).toHaveBeenCalledWith(5);
});
it("renders an honest empty state", () => {
  render(<EmptyState title="No ratings yet" />);
  expect(screen.getByText("No ratings yet")).toBeInTheDocument();
});
