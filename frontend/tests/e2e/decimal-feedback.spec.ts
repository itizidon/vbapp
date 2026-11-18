import { test, expect } from "@playwright/test";
import { setPeerRating } from "./rating-helpers";

test.use({ hasTouch: true });
test("decimal slider supports native mouse, touch, clearing, and exact keyboard tenths", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/graphql", (route) =>
    route.fulfill({
      json: {
        data: {
          feedbackInvitation: {
            recipientId: "recipient",
            recipientUsername: "Player",
            guestSession: true,
            assignedReviewer: null,
            approvalRequired: false,
            matches: [],
            match: null,
            sport: {
              id: "beach",
              name: "Beach Volleyball",
              slug: "beach-volleyball",
              skills: [
                "Attack",
                "Defense",
                "Passing",
                "Setting",
                "Serving",
              ].map((name) => ({
                id: name.toLowerCase(),
                name,
                slug: name.toLowerCase(),
                active: true,
                sportId: "beach",
                description: `${name} technique description.`,
                requiredForSelfAssessment: false,
              })),
            },
          },
        },
      },
    }),
  );
  await page.goto(`/f/${"b".repeat(64)}?mode=device`);
  const slider = page.getByRole("slider", {
    name: "Defense rating",
    exact: true,
  });
  await expect(slider).toHaveAttribute("aria-valuetext", /Not rated/);
  await slider.focus();
  await expect(slider).toHaveAttribute("aria-valuetext", /Not rated/);
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuetext", /out of 5.0/);
  expect(Number(await slider.inputValue()) * 10).toBeCloseTo(
    Math.round(Number(await slider.inputValue()) * 10),
    8,
  );
  await page
    .getByRole("button", { name: "Clear Defense rating", exact: true })
    .click();
  await expect(slider).toHaveAttribute("aria-valuetext", /Not rated/);
  await slider.scrollIntoViewIfNeeded();
  const touchBox = (await slider.boundingBox())!;
  const scrollBefore = await page.evaluate(() => scrollY);
  const cdp = await page.context().newCDPSession(page);
  const y = touchBox.y + touchBox.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchBox.x + touchBox.width / 2, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touchBox.x + touchBox.width * 0.8, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(slider).toHaveAttribute("aria-valuetext", /out of 5.0/);
  expect(await slider.evaluate((el) => getComputedStyle(el).touchAction)).toBe(
    "none",
  );
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
  await setPeerRating(page, "Defense", 4.7);
  await expect(slider).toHaveAttribute("aria-valuetext", "4.7 out of 5.0");
  await page.getByRole("button", { name: "Card Review", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(slider).toHaveValue("4.7");
  await slider.press("ArrowLeft");
  await slider.press("ArrowLeft");
  await page.getByRole("button", { name: "Quick Review", exact: true }).click();
  await expect(slider).toHaveValue("4.5");
  if (info.project.name === "width-375")
    await page.setViewportSize({ width: 430, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/vbapp-decimal-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(slider).toHaveValue("4.5");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/vbapp-decimal-dark-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
