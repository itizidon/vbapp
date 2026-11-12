import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { GqlExecutionContext } from "@nestjs/graphql";
import { GqlAuthGuard } from "./gql-auth.guard";
@Injectable()
export class OptionalGqlAuthGuard extends GqlAuthGuard {
  async canActivate(context: ExecutionContext) {
    const req = GqlExecutionContext.create(context).getContext().req;
    if (!req.headers?.authorization) return true;
    try {
      await super.canActivate(context);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      // A valid invitation still permits an anonymous draft with an expired session.
      // An unverified session must never establish submitter identity.
      delete req.user;
    }
    return true;
  }
}
