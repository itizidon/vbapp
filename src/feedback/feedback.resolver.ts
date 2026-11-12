import { OptionalGqlAuthGuard } from "../common/optional-gql-auth.guard";
import { PendingApprovalsPage } from "./approval.models";
import { FeedbackInvitationModel } from "./invitation.models";
import {
  Args,
  ID,
  GraphQLISODateTime,
  Mutation,
  Query,
  Resolver,
} from "@nestjs/graphql";
import { UseGuards } from "@nestjs/common";
import { FeedbackService } from "./feedback.service";
import {
  FeedbackModel,
  GuestInvitePayload,
  MemberModel,
} from "../common/models";
import {
  SubmitFeedbackInput,
  SubmitGuestFeedbackInput,
  UpdateFeedbackInput,
} from "../common/inputs";
import { GqlAuthGuard } from "../common/gql-auth.guard";
import { AuthUser, CurrentUser } from "../common/current-user.decorator";
@Resolver()
export class FeedbackResolver {
  constructor(private s: FeedbackService) {}
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => [MemberModel])
  feedbackReviewers(
    @Args("search") search: string,
    @Args("token", { nullable: true }) token?: string,
    @Args("recipientId", { type: () => ID, nullable: true })
    recipientId?: string,
    @CurrentUser() u?: AuthUser,
  ) {
    return this.s.reviewerSuggestions(u?.id, search, token, recipientId);
  }
  @Query(() => FeedbackInvitationModel) feedbackInvitation(
    @Args("token") token: string,
  ) {
    return this.s.invitation(token);
  }
  @UseGuards(GqlAuthGuard) @Mutation(() => FeedbackModel) submitFeedback(
    @CurrentUser() u: AuthUser,
    @Args("input") i: SubmitFeedbackInput,
  ) {
    return this.s.submit(u.id, i);
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Mutation(() => FeedbackModel)
  submitGuestFeedback(
    @Args("input") i: SubmitGuestFeedbackInput,
    @CurrentUser() u?: AuthUser,
  ) {
    return this.s.submitGuest(i, u?.id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => GuestInvitePayload)
  createGuestFeedbackInvite(
    @CurrentUser() u: AuthUser,
    @Args("recipientId", { type: () => ID }) r: string,
    @Args("sportId", { type: () => ID }) s: string,
    @Args("matchId", { type: () => ID, nullable: true }) m?: string,
    @Args("assignedReviewerId", { type: () => ID, nullable: true })
    reviewer?: string,
  ) {
    return this.s.invite(u.id, r, s, m, reviewer);
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => PendingApprovalsPage)
  myPendingFeedbackApprovals(
    @CurrentUser() u: AuthUser,
    @Args("cursor", { type: () => ID, nullable: true }) cursor?: string,
  ) {
    return this.s.pendingApprovals(u.id, cursor);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => FeedbackModel)
  approveFeedback(
    @CurrentUser() u: AuthUser,
    @Args("feedbackId", { type: () => ID }) id: string,
  ) {
    return this.s.decide(u.id, id, true);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => FeedbackModel)
  rejectFeedback(
    @CurrentUser() u: AuthUser,
    @Args("feedbackId", { type: () => ID }) id: string,
    @Args("reason", { nullable: true }) reason?: string,
  ) {
    return this.s.decide(u.id, id, false, reason);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  revokeFeedbackLink(
    @CurrentUser() u: AuthUser,
    @Args("linkId", { type: () => ID }) id: string,
  ) {
    return this.s.revokeLink(u.id, id);
  }
  @UseGuards(GqlAuthGuard) @Mutation(() => FeedbackModel) updateFeedback(
    @CurrentUser() u: AuthUser,
    @Args("input") i: UpdateFeedbackInput,
  ) {
    return this.s.update(u.id, i);
  }
  @UseGuards(GqlAuthGuard) @Mutation(() => FeedbackModel) deleteFeedback(
    @CurrentUser() u: AuthUser,
    @Args("id", { type: () => ID }) id: string,
  ) {
    return this.s.delete(u.id, id);
  }
  @UseGuards(GqlAuthGuard) @Query(() => FeedbackModel) feedback(
    @CurrentUser() u: AuthUser,
    @Args("id", { type: () => ID }) id: string,
  ) {
    return this.s.get(u.id, id);
  }
  @UseGuards(GqlAuthGuard) @Query(() => [FeedbackModel]) receivedFeedback(
    @CurrentUser() u: AuthUser,
    @Args("cursor", { nullable: true }) c?: string,
    @Args("matchOnly", { type: () => Boolean, nullable: true })
    matchOnly?: boolean,
    @Args("createdFrom", { type: () => GraphQLISODateTime, nullable: true })
    from?: Date,
    @Args("createdBefore", { type: () => GraphQLISODateTime, nullable: true })
    before?: Date,
  ) {
    return this.s.received(u.id, c, matchOnly, from, before);
  }
  @UseGuards(GqlAuthGuard) @Query(() => [FeedbackModel]) submittedFeedback(
    @CurrentUser() u: AuthUser,
    @Args("cursor", { nullable: true }) c?: string,
  ) {
    return this.s.submitted(u.id, c);
  }
}
