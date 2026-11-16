import { it, expect, vi, afterEach } from "vitest";
import { gql, ApiError } from "../src/lib/api";
afterEach(() => vi.unstubAllGlobals());
it("passes variables to the same-origin server route", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { me: { id: "u" } } }),
  });
  vi.stubGlobal("fetch", fetch);
  expect(await gql("query Me {me{id}}", {})).toEqual({ me: { id: "u" } });
  expect(fetch.mock.calls[0][0]).toBe("/api/graphql");
});
it("sends login credentials in a noncached JSON POST without following redirects", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { login: { user: { id: "u" } } } }),
  });
  vi.stubGlobal("fetch", fetch);
  const input = { login: "dummy-account", password: "dummy-password" };
  await gql(
    "mutation Login($input:LoginInput!){login(input:$input){user{id}}}",
    { input },
  );
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("/api/graphql");
  expect(options).toMatchObject({
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  expect(JSON.parse(options.body).variables).toEqual({ input });
});
it("surfaces GraphQL errors even with HTTP 200", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "Invalid credentials" }] }),
    }),
  );
  await expect(gql("mutation Login")).rejects.toThrow("Invalid credentials");
});
it("retains unauthorized status for session handling", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ errors: [{ message: "Unauthorized" }] }),
    }),
  );
  await expect(gql("query Me")).rejects.toMatchObject({ status: 401 });
  expect(new ApiError("Expired", 401)).toBeInstanceOf(Error);
});
