import { Float, Parent, ResolveField, Resolver } from "@nestjs/graphql";
import { Prisma } from "@prisma/client";
import { FeedbackRatingModel } from "../common/models";
import { ApprovalRatingModel } from "./approval.models";
import { feedbackNumber } from "../common/feedback-rating";
// Prisma Decimal stays exact in storage/algorithms; GraphQL returns JSON numbers.
@Resolver(() => FeedbackRatingModel)
export class FeedbackRatingResolver {
  @ResolveField(() => Float) rating(
    @Parent() row: { rating: number | Prisma.Decimal },
  ) {
    return feedbackNumber(row.rating);
  }
}
@Resolver(() => ApprovalRatingModel)
export class ApprovalRatingResolver {
  @ResolveField(() => Float) rating(
    @Parent() row: { rating: number | Prisma.Decimal },
  ) {
    return feedbackNumber(row.rating);
  }
}
