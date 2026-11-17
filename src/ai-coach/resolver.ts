import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";
import { UseFilters, UseGuards } from "@nestjs/common";
import { GqlAuthGuard } from "../common/gql-auth.guard";
import { CurrentUser, AuthUser } from "../common/current-user.decorator";
import { AiCoachService } from "./service";
import {
  AskAiCoachInput,
  CoachMessageModel,
  CoachConversationModel,
  CoachMessagePage,
} from "./models";
import { CoachExceptionFilter } from "./filter";
@UseFilters(CoachExceptionFilter)
@UseGuards(GqlAuthGuard)
@Resolver()
export class AiCoachResolver {
  constructor(private readonly service: AiCoachService) {}
  @Mutation(() => CoachMessageModel) askAiCoach(
    @CurrentUser() actor: AuthUser,
    @Args("input") input: AskAiCoachInput,
  ) {
    return this.service.ask(actor.id, input);
  }
  @Query(() => [CoachConversationModel]) myAiCoachConversations(
    @CurrentUser() actor: AuthUser,
    @Args("sportId", { type: () => ID }) sportId: string,
  ) {
    return this.service.conversations(actor.id, sportId);
  }
  @Query(() => CoachMessagePage) myAiCoachMessages(
    @CurrentUser() actor: AuthUser,
    @Args("conversationId", { type: () => ID }) conversationId: string,
    @Args("cursor", { type: () => ID, nullable: true }) cursor?: string,
  ) {
    return this.service.messages(actor.id, conversationId, cursor);
  }
}
