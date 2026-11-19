import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
// Render real measured results exported by the isolated CPU/API smoke, without reusing its expired storage server.
const fixturePath = process.env.VIDEO_SMOKE_UI_FIXTURE;
const fixture = fixturePath
  ? JSON.parse(readFileSync(fixturePath, "utf8"))
  : null;
test("renders actual measured video results and coach controls responsively", async ({
  page,
}, info) => {
  test.skip(
    !fixture,
    "Run the actual CPU/API smoke with VIDEO_SMOKE_EXPORT_PATH, then set VIDEO_SMOKE_UI_FIXTURE",
  );
  const ws = fixture.workspace;
  await page.route("**/api/graphql", async (route) => {
    const { query } = route.request().postDataJSON();
    let data = {};
    if (query.includes("trainingVideoWorkspace"))
      data = { trainingVideoWorkspace: ws };
    else if (query.includes("videoAnalysis("))
      data = { videoAnalysis: fixture.analysis };
    else if (query.includes("Playback("))
      data = {
        referenceVideoPlayback: {
          url: "/test-no-media",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      };
    else if (query.includes("PendingApprovalCount"))
      data = { myPendingApprovalCount: 0 };
    else if (query.includes("RecentPendingApprovals"))
      data = { myRecentPendingApprovals: [] };
    else if (query.includes("query Me"))
      data = {
        me: {
          id: ws.submissions[0].userId,
          username: "Motion test player",
          email: "motion@example.test",
          isPublic: false,
          aiCoachingEnabled: false,
        },
      };
    await route.fulfill({ json: { data } });
  });
  await page.goto(`/drills/${ws.drill.id}`);
  await expect(
    page.getByRole("heading", { name: ws.drill.name, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /View results/ })
    .first()
    .click();
  await expect(
    page.getByText("Experimental movement similarity", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/not a correctness percentage/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /View aligned moments/ }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("player-results.png"),
    fullPage: true,
  });
  await page.goto(`/admin/drills/${ws.drill.id}/videos`);
  await expect(
    page.getByRole("heading", { name: "Upload coach demonstrations" }),
  ).toBeVisible();
  await expect(
    page.getByText("Extraction quality", { exact: false }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("coach-videos.png"),
    fullPage: true,
  });
});
