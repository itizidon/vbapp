import { GUARDS_METADATA } from "@nestjs/common/constants";
import { FeedbackResolver } from "../src/feedback/feedback.resolver";
import { GqlAuthGuard } from "../src/common/gql-auth.guard";
describe("approval query authentication", () => {
  it.each([
    "myPendingApprovalCount",
    "myRecentPendingApprovals",
    "myFeedbackApprovals",
  ] as const)("guards %s with the existing session guard", (method) => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, FeedbackResolver.prototype[method]),
    ).toContain(GqlAuthGuard);
  });
  it("derives reviewer identity exclusively from CurrentUser", () => {
    const service = {
      pendingApprovalCount: jest.fn(),
      recentPendingApprovals: jest.fn(),
      approvals: jest.fn(),
    };
    const resolver = new FeedbackResolver(service as never);
    resolver.myPendingApprovalCount({ id: "reviewer" } as never);
    resolver.myRecentPendingApprovals({ id: "reviewer" } as never);
    resolver.myFeedbackApprovals(
      { id: "reviewer" } as never,
      "PENDING",
      "cursor",
    );
    expect(service.pendingApprovalCount).toHaveBeenCalledWith("reviewer");
    expect(service.recentPendingApprovals).toHaveBeenCalledWith("reviewer");
    expect(service.approvals).toHaveBeenCalledWith(
      "reviewer",
      "PENDING",
      "cursor",
    );
  });
});
