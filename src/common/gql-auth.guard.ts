import { SelfAssessmentsService } from "../self-assessments/self-assessments.service";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { GqlExecutionContext } from "@nestjs/graphql";
import { ClerkSessions } from "../auth/clerk/sessions";
const clerkSessionKey = Symbol("verifiedClerkSession");
@Injectable()
export class GqlAuthGuard implements CanActivate {
  protected allowIncompleteOnboarding = false;
  constructor(
    readonly sessions: ClerkSessions,
    readonly assessments: SelfAssessmentsService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = GqlExecutionContext.create(context).getContext().req;
    delete req.user;
    delete req.clerkUserId;
    const user = await (req[clerkSessionKey] ??= this.sessions.authenticate(
      req.headers?.authorization,
    ));
    if (!this.allowIncompleteOnboarding && !user.onboardingComplete)
      throw new ForbiddenException("Complete your player onboarding");
    if (!this.allowIncompleteOnboarding && user.assessment)
      await this.assessments.reconcile(user.id, user.assessment);
    req.user = user;
    req.clerkUserId = user.id;
    return true;
  }
}
