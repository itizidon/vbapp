import { test, expect } from "@playwright/test";
const user = "11111111-1111-4111-8111-111111111111";
test("notifications and independent approvals work with keyboard, mobile sheet and history", async ({
  page,
}) => {
  test.setTimeout(60000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  let calls = 0;
  const decided = new Map<string, string>();
  const cards = [1, 2].map((n) => ({
    id: `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`,
    recipientUsername: `BeachPlayer${n}`,
    status: "PENDING",
    createdAt: "2026-11-16T12:00:00Z",
    overallComment:
      "Review the whole comment before approving. " + "Long-word-".repeat(20),
    guestName: "SubmittedGuest",
    match: null,
    matches:
      n === 1
        ? [1, 2, 3].map((i) => ({
            id: `match${i}`,
            playedAt: "2026-11-16T10:00:00Z",
            description: `Match ${i}`,
          }))
        : [],
    privateAnalyticsAllowed: false,
    privateCoachingAllowed: false,
    publicAnalyticsAllowed: false,
    ratings: [
      {
        skillId: "passing",
        skillName: "Passing",
        rating: 4,
        comment: "Use a stable platform.",
      },
    ],
  }));
  await page.route("**/api/graphql", async (route) => {
    const { query: q, variables: v = {} } = route.request().postDataJSON();
    const pending = cards.filter((c) => !decided.has(c.id));
    let data: object = {};
    if (q.includes("query Me"))
      data = {
        me: {
          id: user,
          username: "Reviewer",
          email: "r@example.test",
          isPublic: false,
          aiCoachingEnabled: true,
          createdAt: "2026-01-01",
        },
      };
    else if (q.includes("PendingApprovalCount"))
      data = { myPendingApprovalCount: pending.length };
    else if (q.includes("RecentPendingApprovals"))
      data = {
        myRecentPendingApprovals: pending.map((c) => ({
          id: c.id,
          recipientUsername: c.recipientUsername,
          status: "PENDING",
          createdAt: c.createdAt,
          matchCount: c.matches.length,
          ratedSkillCount: 1,
          match: c.matches[0] ?? null,
        })),
      };
    else if (q.includes("FeedbackApprovals")) {
      const rows = cards
        .filter((c) =>
          v.status === "PENDING"
            ? !decided.has(c.id)
            : decided.get(c.id) === v.status,
        )
        .map((c) => ({ ...c, status: decided.get(c.id) ?? "PENDING" }));
      data = {
        myFeedbackApprovals: {
          totalCount: rows.length,
          items: rows,
          nextCursor: null,
        },
      };
    } else if (q.includes("mutation Approve")) {
      calls++;
      await new Promise((r) => setTimeout(r, 200));
      decided.set(v.id, "PUBLISHED");
      data = { approveFeedback: { id: v.id, status: "PUBLISHED" } };
    } else if (q.includes("mutation Reject")) {
      calls++;
      decided.set(v.id, "REJECTED");
      data = { rejectFeedback: { id: v.id, status: "REJECTED" } };
    } else if (q.includes("Catalog")) data = { sports: [] };
    else if (q.includes("Submitted")) data = { submittedFeedback: [] };
    await route.fulfill({ json: { data } });
  });
  await page.goto("/approvals");
  const bell = page.getByRole("button", {
    name: "Notifications, 2 pending feedback approvals",
  });
  await expect(bell).toBeVisible();
  await bell.click();
  let panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("article")).toHaveCount(2);
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  if (page.viewportSize()!.width < 768) {
    expect(box!.y + box!.height).toBeGreaterThan(895);
    if (page.viewportSize()!.width === 375) {
      await page.setViewportSize({ width: 430, height: 900 });
      await expect(panel).toBeVisible();
      await page.screenshot({ path: "/tmp/vbapp-approval-sheet-430.png" });
      expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(430);
    }
  }
  await page.keyboard.press("Tab");
  await expect
    .poll(() => panel.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(bell).toBeFocused();
  await bell.click();
  panel = page.getByRole("dialog", { name: "Notifications" });
  await panel.getByRole("button", { name: "Close notifications" }).click();
  await expect(panel).not.toBeVisible();
  await bell.click();
  await page.mouse.click(5, 5);
  await expect(panel).not.toBeVisible();
  await expect(bell).toBeFocused();
  await bell.click();
  await page
    .getByRole("link", { name: "Review details for @BeachPlayer1" })
    .click();
  await expect(panel).not.toBeVisible();
  const first = page.getByRole("article", {
    name: "Feedback for @BeachPlayer1",
  });
  await expect(
    first.getByRole("heading", { name: "Associated match" }),
  ).toHaveCount(0);
  await expect(first.getByText("Use a stable platform.")).toBeVisible();
  await expect(
    first.getByRole("button", { name: "Approve", exact: true }),
  ).toBeDisabled();
  await first.getByRole("checkbox", { name: /I’ve reviewed/ }).check();
  await first.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Notifications, 1 pending feedback approvals",
    }),
  ).toBeVisible();
  expect(calls).toBe(1);
  const second = page.getByRole("article", {
    name: "Feedback for @BeachPlayer2",
  });
  await second.locator("summary").click();
  await second.getByRole("button", { name: "Reject", exact: true }).click();
  await second.getByRole("button", { name: "Confirm rejection" }).click();
  await expect(page.getByText("You’re all caught up!")).toBeVisible();
  expect(calls).toBe(2);
  await page.getByRole("tab", { name: "Approved", exact: true }).click();
  await expect(
    page.getByText("1 approved review · Newest first"),
  ).toBeVisible();
  await page.getByRole("article").locator("summary").click();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Rejected", exact: true }).click();
  await expect(
    page.getByText("1 rejected review · Newest first"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/account");
  await expect(
    page.getByRole("link", { name: "Manage approvals" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});
