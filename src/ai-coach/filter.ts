import { Catch, HttpException } from "@nestjs/common";
import type { GqlExceptionFilter } from "@nestjs/graphql";
import { GraphQLError } from "graphql";
@Catch()
export class CoachExceptionFilter implements GqlExceptionFilter {
  catch(error: unknown) {
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const codes: Record<number, string> = {
      400: "BAD_USER_INPUT",
      401: "UNAUTHENTICATED",
      404: "NOT_FOUND",
      409: "CONFLICT",
      429: "TOO_MANY_REQUESTS",
    };
    const message =
      status >= 500
        ? "The coaching service is temporarily unavailable. Please try again."
        : error instanceof HttpException
          ? error.message
          : "Unable to complete this request.";
    return new GraphQLError(message, {
      extensions: { code: codes[status] ?? "SERVICE_UNAVAILABLE" },
    });
  }
}
