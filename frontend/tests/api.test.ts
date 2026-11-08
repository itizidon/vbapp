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
