import { Injectable } from "@nestjs/common";
import { GqlAuthGuard } from "./gql-auth.guard";
@Injectable()
export class OnboardingAuthGuard extends GqlAuthGuard {
  protected allowIncompleteOnboarding = true;
}
