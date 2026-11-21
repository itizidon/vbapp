import { ClerkDeletionService } from "./clerk/deletion";
import { ClerkWebhookController } from "./clerk/webhook";
import {
  ParticipantIdentityResolver,
  FeedbackIdentityResolver,
  ApprovalPreviewIdentityResolver,
  ApprovalIdentityResolver,
} from "./clerk/identity.resolvers";
import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { GqlAuthGuard } from "../common/gql-auth.guard";
import { OnboardingAuthGuard } from "../common/onboarding-auth.guard";
import { OptionalGqlAuthGuard } from "../common/optional-gql-auth.guard";
import { ClerkUserService } from "./clerk/users";
import { ClerkSessions } from "./clerk/sessions";
import { AuthResolver, PlayerDirectoryResolver } from "./auth.resolver";
import { SelfAssessmentsService } from "../self-assessments/self-assessments.service";
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.GUEST_CAPABILITY_SECRET;
        if (!secret || secret.length < 32)
          throw new Error(
            "GUEST_CAPABILITY_SECRET must be at least 32 characters (guest capabilities only)",
          );
        return { secret, signOptions: { expiresIn: "1d" } };
      },
    }),
  ],
  controllers: [ClerkWebhookController],
  providers: [
    ClerkDeletionService,
    ParticipantIdentityResolver,
    FeedbackIdentityResolver,
    ApprovalPreviewIdentityResolver,
    ApprovalIdentityResolver,
    ClerkUserService,
    ClerkSessions,
    GqlAuthGuard,
    OnboardingAuthGuard,
    OptionalGqlAuthGuard,
    AuthResolver,
    PlayerDirectoryResolver,
    SelfAssessmentsService,
  ],
  exports: [
    ClerkUserService,
    ClerkSessions,
    GqlAuthGuard,
    OnboardingAuthGuard,
    OptionalGqlAuthGuard,
    SelfAssessmentsService,
    JwtModule,
  ],
})
export class AuthModule {}
