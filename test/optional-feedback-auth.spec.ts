import { JwtService } from "@nestjs/jwt";
import { GqlAuthGuard } from "../src/common/gql-auth.guard";
import { UnauthorizedException } from "@nestjs/common";
import { GqlExecutionContext } from "@nestjs/graphql";
import { OptionalGqlAuthGuard } from "../src/common/optional-gql-auth.guard";
const context = {} as any;
afterEach(() => jest.restoreAllMocks());
it("permits anonymous invitation submissions without assigning a submitter", async () => {
  const req: any = { headers: {} };
  jest
    .spyOn(GqlExecutionContext, "create")
    .mockReturnValue({ getContext: () => ({ req }) } as any);
  const jwt: any = { verifyAsync: jest.fn() };
  expect(await new OptionalGqlAuthGuard(jwt).canActivate(context)).toBe(true);
  expect(req.user).toBeUndefined();
  expect(jwt.verifyAsync).not.toHaveBeenCalled();
});
it("captures a verified session for the actual submitter", async () => {
  const req: any = { headers: { authorization: "Bearer verified" } };
  jest
    .spyOn(GqlExecutionContext, "create")
    .mockReturnValue({ getContext: () => ({ req }) } as any);
  const jwt: any = {
    verifyAsync: jest
      .fn()
      .mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        sub: "11111111-1111-4111-8111-111111111111",
      }),
  };
  await new OptionalGqlAuthGuard(jwt).canActivate(context);
  expect(req.user.id).toBe("11111111-1111-4111-8111-111111111111");
});
it("does not treat an expired session as identity or block a valid anonymous invitation", async () => {
  const req: any = { headers: { authorization: "Bearer expired" } };
  jest
    .spyOn(GqlExecutionContext, "create")
    .mockReturnValue({ getContext: () => ({ req }) } as any);
  const jwt: any = {
    verifyAsync: jest.fn().mockRejectedValue(new UnauthorizedException()),
  };
  expect(await new OptionalGqlAuthGuard(jwt).canActivate(context)).toBe(true);
  expect(req.user).toBeUndefined();
});

it.each(["guest-feedback", "guest-feedback-followup"])(
  "never grants account identity to a signed %s capability",
  async (kind) => {
    const jwt = new JwtService({
      secret: "guest-capability-guard-test-secret-long-enough",
    });
    const token = await jwt.signAsync({
      kind,
      nonce: "11111111-1111-4111-8111-111111111111",
    });
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    jest
      .spyOn(GqlExecutionContext, "create")
      .mockReturnValue({ getContext: () => ({ req }) } as any);
    await expect(new GqlAuthGuard(jwt).canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(await new OptionalGqlAuthGuard(jwt).canActivate(context)).toBe(true);
    expect(req.user).toBeUndefined();
  },
);
it("rejects even a signed capability containing forged account-looking fields", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const jwt: any = {
    verifyAsync: jest
      .fn()
      .mockResolvedValue({ id, sub: id, kind: "guest-feedback-followup" }),
  };
  const req: any = { headers: { authorization: "Bearer capability" } };
  jest
    .spyOn(GqlExecutionContext, "create")
    .mockReturnValue({ getContext: () => ({ req }) } as any);
  await expect(new GqlAuthGuard(jwt).canActivate(context)).rejects.toThrow(
    UnauthorizedException,
  );
});
