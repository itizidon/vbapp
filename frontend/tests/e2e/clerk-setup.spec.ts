import { test, expect } from "@playwright/test";
// Run against an explicitly unconfigured isolated frontend; no real Clerk account or credentials.
test("missing Clerk configuration fails closed and old cookies grant no access", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    {
      name: "courtside_session",
      value: "retired-account-token",
      url: baseURL!,
    },
  ]);
  await page.goto("/matches");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Authentication needs configuration" }),
  ).toContainText("Authentication needs configuration");
  await expect(page.locator("input[type=password]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("sign-up setup and privacy remain reachable without a local account", async ({
  page,
}) => {
  await page.goto("/signup");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Authentication needs configuration" }),
  ).toContainText("Clerk development keys");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
