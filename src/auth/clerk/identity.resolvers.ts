import { Context, Parent, ResolveField, Resolver } from "@nestjs/graphql";
import {
  MatchParticipantModel,
  MemberModel,
  FeedbackModel,
} from "../../common/models";
import {
  ApprovalPreviewModel,
  PendingApprovalModel,
} from "../../feedback/approval.models";
import { ClerkUserService } from "./users";
@Resolver(() => MatchParticipantModel)
export class ParticipantIdentityResolver {
  constructor(private users: ClerkUserService) {}
  @ResolveField(() => MemberModel, { nullable: true }) user(
    @Parent() p: { userId?: string },
    @Context() ctx: any,
  ) {
    return p.userId ? this.users.loadPublicPlayer(p.userId, ctx) : null;
  }
}
@Resolver(() => FeedbackModel)
export class FeedbackIdentityResolver {
  constructor(private users: ClerkUserService) {}
  @ResolveField(() => String, { nullable: true }) async reviewerUsername(
    @Parent() p: { reviewerId?: string },
    @Context() ctx: any,
  ) {
    return p.reviewerId
      ? ((await this.users.loadPublicPlayer(p.reviewerId, ctx))?.username ??
          "Deleted player")
      : null;
  }
}
@Resolver(() => ApprovalPreviewModel)
export class ApprovalPreviewIdentityResolver {
  constructor(private users: ClerkUserService) {}
  @ResolveField(() => String) async recipientUsername(
    @Parent() p: { recipientId: string },
    @Context() ctx: any,
  ) {
    return (
      (await this.users.loadPublicPlayer(p.recipientId, ctx))?.username ??
      "Deleted player"
    );
  }
}
@Resolver(() => PendingApprovalModel)
export class ApprovalIdentityResolver {
  constructor(private users: ClerkUserService) {}
  @ResolveField(() => String) async recipientUsername(
    @Parent() p: { recipientId: string },
    @Context() ctx: any,
  ) {
    return (
      (await this.users.loadPublicPlayer(p.recipientId, ctx))?.username ??
      "Deleted player"
    );
  }
}
