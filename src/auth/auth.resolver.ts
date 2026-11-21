import {
  Args,
  ID,
  Int,
  InputType,
  Field,
  Mutation,
  Query,
  Resolver,
} from "@nestjs/graphql";
import { UseGuards, BadRequestException } from "@nestjs/common";
import { UserModel, MemberModel, PlayerDirectoryModel } from "../common/models";
import { GqlAuthGuard } from "../common/gql-auth.guard";
import { OnboardingAuthGuard } from "../common/onboarding-auth.guard";
import { AuthUser, CurrentUser } from "../common/current-user.decorator";
import { ClerkUserService } from "./clerk/users";
import { SelfAssessmentsService } from "../self-assessments/self-assessments.service";
import { CreateSelfAssessmentInput } from "../common/inputs";
import { IsInt, Min, Max } from "class-validator";
@InputType()
export class PlayerOnboardingInput extends CreateSelfAssessmentInput {
  @Field(() => Int) @IsInt() @Min(13) @Max(120) age!: number;
  @Field(() => Int) @IsInt() @Min(50) @Max(300) heightCm!: number;
}
@Resolver()
export class AuthResolver {
  constructor(
    private users: ClerkUserService,
    private assessments: SelfAssessmentsService,
  ) {}
  @UseGuards(OnboardingAuthGuard) @Query(() => UserModel) me(
    @CurrentUser() u: AuthUser,
  ) {
    return this.users.getCurrentUser(u.id);
  }
  @UseGuards(OnboardingAuthGuard)
  @Mutation(() => UserModel)
  async completePlayerOnboarding(
    @CurrentUser() u: AuthUser,
    @Args("input") input: PlayerOnboardingInput,
  ) {
    await this.assessments.onboard(u.id, input);
    return this.users.getCurrentUser(u.id);
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => [MemberModel])
  async members(@CurrentUser() u: AuthUser, @Args("search") search: string) {
    if (search.trim().length < 2) return [];
    return (await this.users.search(search, 11))
      .filter((p) => p.id !== u.id)
      .slice(0, 10);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  setPlayerRole(
    @CurrentUser() u: AuthUser,
    @Args("userId", { type: () => ID }) id: string,
    @Args("role") role: string,
  ) {
    if (!["PLAYER", "COACH", "ADMIN"].includes(role))
      throw new BadRequestException("Invalid role");
    return this.users.setRole(u.id, id, role as "PLAYER" | "COACH" | "ADMIN");
  }
}
@Resolver()
export class PlayerDirectoryResolver {
  constructor(private users: ClerkUserService) {}
  @UseGuards(GqlAuthGuard)
  @Query(() => [PlayerDirectoryModel])
  playerSuggestions(@Args("search") search: string) {
    return search.trim().length < 2 ? [] : this.users.search(search, 5);
  }
  @Query(() => [PlayerDirectoryModel]) searchPlayers(
    @Args("search", { defaultValue: "" }) search: string,
    @Args("cursor", { nullable: true }) cursor?: string,
  ) {
    return this.users.search(search, 51, cursor);
  }
  @Query(() => PlayerDirectoryModel) playerProfile(
    @Args("id", { type: () => ID }) id: string,
  ) {
    return this.users.getPublicPlayerProfile(id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => UserModel)
  async updateAccountVisibility(
    @CurrentUser() u: AuthUser,
    @Args("isPublic") isPublic: boolean,
  ) {
    await this.users.updatePlayerMetadata(u.id, {}, { isPublic });
    return this.users.getCurrentUser(u.id);
  }
}
