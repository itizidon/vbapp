import {
  Field,
  ID,
  Int,
  ObjectType,
  GraphQLISODateTime,
} from "@nestjs/graphql";
import { SportModel, MemberModel } from "../common/models";
@ObjectType()
export class InvitedTeamModel {
  @Field(() => Int) teamNumber!: number;
  @Field(() => Int, { nullable: true }) score?: number;
  @Field(() => [String]) players!: string[];
}
@ObjectType()
export class InvitedMatchModel {
  @Field(() => ID) id!: string;
  @Field(() => GraphQLISODateTime, { nullable: true }) playedAt?: Date;
  @Field(() => [InvitedTeamModel]) teams!: InvitedTeamModel[];
  @Field(() => [String]) unassignedPlayers!: string[];
}
@ObjectType()
export class FeedbackInvitationModel {
  @Field(() => MemberModel, { nullable: true }) assignedReviewer?: {
    id: string;
    username: string;
  };
  @Field() approvalRequired!: boolean;
  @Field(() => ID) recipientId!: string;
  @Field() recipientUsername!: string;
  @Field(() => SportModel) sport!: SportModel;
  @Field(() => InvitedMatchModel, { nullable: true }) match?: InvitedMatchModel;
}
