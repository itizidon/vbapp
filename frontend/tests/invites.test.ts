import { it, expect } from "vitest";
import { decodeInviteToken } from "../src/lib/invites";
const claims = {
  kind: "guest-feedback",
  recipientId: "11111111-1111-4111-8111-111111111111",
  sportId: "22222222-2222-4222-8222-222222222222",
  exp: 2000000000,
};
const encode = (data: object) =>
  `header.${Buffer.from(JSON.stringify(data)).toString("base64url")}.signature`;
it("decodes recipient and optional match routing without claiming signature verification", () => {
  expect(decodeInviteToken(encode(claims), 0)).toEqual(claims);
  expect(
    decodeInviteToken(
      encode({ ...claims, matchId: "33333333-3333-4333-8333-333333333333" }),
      0,
    )?.matchId,
  ).toBe("33333333-3333-4333-8333-333333333333");
});
it("rejects expired, malformed, oversized, and other-purpose tokens", () => {
  expect(decodeInviteToken(encode(claims), claims.exp * 1000)).toBeNull();
  for (const token of [
    "invalid",
    encode({ ...claims, kind: "access" }),
    encode({ ...claims, recipientId: "bad" }),
    "x".repeat(9000),
  ])
    expect(decodeInviteToken(token, 0)).toBeNull();
});

it("accepts explicit null match scopes in real general-feedback tokens", () => {
  expect(
    decodeInviteToken(encode({ ...claims, matchId: null }), 0)?.matchId,
  ).toBeUndefined();
  expect(
    decodeInviteToken(encode({ ...claims, matchId: null }), 0)?.recipientId,
  ).toBe(claims.recipientId);
});
