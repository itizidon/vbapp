import {
  Field,
  ID,
  Int,
  ObjectType,
  GraphQLISODateTime,
} from "@nestjs/graphql";
import { FeedbackModel, FeedbackRatingModel } from "../common/models";
@ObjectType()
export class ApprovalRatingModel extends FeedbackRatingModel {
  @Field() skillName!: string;
}
@ObjectType()
export class ApprovalMatchModel {
  @Field(() => ID) id!: string;
  @Field(() => GraphQLISODateTime, { nullable: true }) playedAt?: Date;
  @Field({ nullable: true }) description?: string;
}
@ObjectType()
export class PendingApprovalModel extends FeedbackModel {
  @Field() recipientUsername!: string;
  @Field(() => ApprovalMatchModel, { nullable: true })
  match?: ApprovalMatchModel;
  @Field(() => [ApprovalRatingModel]) declare ratings: ApprovalRatingModel[];
}
@ObjectType()
export class PendingApprovalsPage {
  @Field(() => Int) totalCount!: number;
  @Field(() => [PendingApprovalModel]) items!: PendingApprovalModel[];
  @Field(() => ID, { nullable: true }) nextCursor?: string;
}
