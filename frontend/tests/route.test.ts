// @vitest-environment node
import { it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/graphql/route";
const request = (body: object, origin = "http://localhost:3001") =>
  new NextRequest("http://localhost:3001/api/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllGlobals());
it("rejects cross-origin mutations", async () => {
  expect(
    (await POST(request({ query: "mutation X{x}" }, "https://other.example")))
      .status,
  ).toBe(403);
});
it("stores authentication only in an HttpOnly cookie", async () => {
  const jwt = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900 })).toString("base64url")}.signature`;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        data: { login: { accessToken: jwt, user: { id: "u" } } },
      }),
    }),
  );
  const response = await POST(
    request({ query: "mutation Login {login {accessToken}}" }),
  );
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  expect((await response.json()).data.login.accessToken).toBeUndefined();
});
it("returns actionable API-unavailable errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  expect(
    (await POST(request({ query: "query Catalog{sports{id}}" }))).status,
  ).toBe(502);
});
it("clears session cookies on logout", async () => {
  const response = await POST(request({ action: "logout" }));
  expect(response.headers.get("set-cookie")).toContain("courtside_session=");
});

it("forwards required variables unchanged", async () => {
  const upstream = vi.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ data: { sport: { id: "sport-id" } } }),
  });
  vi.stubGlobal("fetch", upstream);
  await POST(
    request({
      query: "query Sport($id:ID!){sport(id:$id){id}}",
      variables: { id: "sport-id" },
    }),
  );
  expect(JSON.parse(upstream.mock.calls[0][1].body).variables).toEqual({
    id: "sport-id",
  });
});

it("protects tokens returned under an aliased authentication operation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        data: {
          session: {
            accessToken: "header.payload.signature",
            user: { id: "u" },
          },
        },
      }),
    }),
  );
  const response = await POST(
    request({
      query:
        'mutation { session: login(input:{login:"a",password:"b"}){accessToken}}',
    }),
  );
  expect((await response.json()).data.session.accessToken).toBeUndefined();
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
});
