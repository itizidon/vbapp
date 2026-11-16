import { test, expect } from "@playwright/test";

for (const path of ["/login", "/signup"]) {
  test(`${path} cannot put credentials in the URL before hydration`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
    });
    try {
      const page = await context.newPage();
      await page.goto(path);
      const form = page.locator("form");
      await expect(form).toHaveAttribute("method", "post");
      await expect(form).toHaveAttribute("action", "/api/auth/form");
      await expect(
        form.locator('button[type="submit"], button:not([type])').last(),
      ).toBeDisabled();
      await form
        .locator('input[type="password"]')
        .fill("dummy-not-a-real-password");
      const identity = form.locator(
        'input[name="login"], input[name="username"]',
      );
      await identity.fill("dummy-account");
      const nativeRequest = page.waitForRequest(
        (request) => new URL(request.url()).pathname === "/api/auth/form",
      );
      // Force native submission as an autofill/browser extension could do, bypassing
      // the disabled control and every React event handler.
      await form.evaluate((node) =>
        HTMLFormElement.prototype.submit.call(node),
      );
      const request = await nativeRequest;
      expect(request.method()).toBe("POST");
      expect(request.postData()).toContain("dummy-not-a-real-password");
      await expect(page).toHaveURL(/\/api\/auth\/form$/);
      expect(new URL(page.url()).search).toBe("");
      await expect(page.locator("body")).toContainText("require JavaScript");
      await expect(page.locator("body")).not.toContainText(
        "dummy-not-a-real-password",
      );
    } finally {
      await context.close();
    }
  });
}

test("hydrated login sends credentials only in the JSON POST body", async ({
  page,
}) => {
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "dummy-account",
    email: "dummy@example.test",
    createdAt: "2026-11-01",
    isPublic: false,
  };
  await page.route("**/api/graphql", (route) =>
    route.fulfill({
      json: {
        data: {
          login: { user },
          me: user,
          sports: [
            {
              id: "beach",
              name: "Beach Volleyball",
              slug: "beach-volleyball",
              skills: [],
            },
          ],
          userMatches: [],
        },
      },
    }),
  );
  await page.goto("/login");
  await page.getByLabel("Email or username").fill("dummy-account");
  await page
    .getByLabel("Password", { exact: true })
    .fill("dummy-not-a-real-password");
  const submitted = page.waitForRequest(
    (request) =>
      request.url().includes("/api/graphql") &&
      request.postDataJSON()?.query?.includes("mutation Login"),
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const request = await submitted;
  expect(request.method()).toBe("POST");
  expect(request.postDataJSON().variables.input).toEqual({
    login: "dummy-account",
    password: "dummy-not-a-real-password",
  });
  await expect(page).toHaveURL(/\/matches$/);
  expect(page.url()).not.toContain("dummy");
});
