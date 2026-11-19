import { test, expect } from "@playwright/test";
test("coach creates and publishes the first drill without a seed", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  let created: Record<string, unknown> | undefined;
  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON();
    const query = body.query as string;
    let data = {};
    if (query.includes("query Me"))
      data = {
        me: {
          id: "coach",
          username: "Coach",
          email: "coach@example.test",
          isPublic: false,
          aiCoachingEnabled: false,
        },
      };
    else if (query.includes("PendingApprovalCount"))
      data = { myPendingApprovalCount: 0 };
    else if (query.includes("RecentPendingApprovals"))
      data = { myRecentPendingApprovals: [] };
    else if (query.includes("TrainingEditorAccess"))
      data = { canManageTraining: true };
    else if (query.includes("DrillCreationOptions"))
      data = {
        skillTree: { nodes: [] },
        sports: [
          {
            slug: "beach-volleyball",
            skills: [{ id: "passing", name: "Passing", active: true }],
          },
        ],
      };
    else if (query.includes("mutation CreateDrillWithContent")) {
      created = body.variables.input;
      data = { createDrillWithContent: { id: "new-drill" } };
    } else if (query.includes("trainingVideoWorkspace"))
      data = {
        trainingVideoWorkspace: {
          editor: true,
          worker: { available: false },
          drill: {
            id: "new-drill",
            name: "Partner passing",
            objective: "Repeat a controlled platform",
            setup: "Stand on clear sand",
            coachingCues: [],
          },
          variants: [],
          checkpoints: [],
          references: [],
          submissions: [],
        },
      };
    else if (query.includes("drills(")) data = { drills: [] };
    await route.fulfill({ json: { data } });
  });
  await page.goto("/admin/drills");
  await page.getByRole("button", { name: "Create drill", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Drill name", { exact: true })
    .fill("Partner passing");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Pass gently toward a partner and reset.");
  await dialog
    .getByLabel("Learning objective", { exact: true })
    .fill("Repeat a controlled platform");
  await dialog.getByLabel("Setup", { exact: true }).fill("Stand on clear sand");
  await dialog
    .getByRole("combobox", { name: "Skill", exact: true })
    .selectOption("new");
  await dialog
    .getByLabel("New skill name", { exact: true })
    .fill("Platform control");
  await dialog
    .getByRole("combobox", { name: "Volleyball category", exact: true })
    .selectOption("passing");
  await dialog
    .getByLabel("Why this skill matters", { exact: true })
    .fill("Control the pass toward a useful target.");
  await dialog
    .getByLabel("Step 1", { exact: true })
    .fill("Pass and reset your balance.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("create-drill.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Create and publish", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/drills\/new-drill\/videos$/, {
    timeout: 15000,
  });
  expect(created).toMatchObject({
    drill: {
      name: "Partner passing",
      slug: "partner-passing",
      status: "PUBLISHED",
    },
    steps: [{ instruction: "Pass and reset your balance." }],
    newPrimarySkill: {
      name: "Platform control",
      categoryId: "passing",
      status: "PUBLISHED",
    },
  });
  await expect(
    page.getByRole("heading", { name: "Upload coach demonstrations" }),
  ).toBeVisible();
});
