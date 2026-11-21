import { verifyToken } from "@clerk/backend";
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ClerkUserService } from "./users";
import { isClerkUserId, publicPlayer, privatePlayer } from "./metadata";
@Injectable()
export class ClerkSessions {
  constructor(readonly users: ClerkUserService) {}
  async authenticate(authorization?: string) {
    if (!authorization?.startsWith("Bearer ") || authorization.length > 20000)
      throw new UnauthorizedException();
    const issuer = process.env.CLERK_ISSUER,
      parties = (
        process.env.CLERK_AUTHORIZED_PARTIES ??
        process.env.FRONTEND_URL ??
        ""
      )
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (!issuer || !parties.length || !process.env.CLERK_SECRET_KEY)
      throw new ServiceUnavailableException(
        "Clerk authentication is not configured",
      );
    let claims;
    try {
      claims = await verifyToken(authorization.slice(7), {
        secretKey: process.env.CLERK_SECRET_KEY,
        issuer,
        authorizedParties: parties,
        ...(process.env.CLERK_JWT_KEY
          ? { jwtKey: process.env.CLERK_JWT_KEY }
          : {}),
        ...(process.env.CLERK_AUDIENCE
          ? { audience: process.env.CLERK_AUDIENCE }
          : {}),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired Clerk session");
    }
    if (
      !isClerkUserId(claims.sub) ||
      typeof claims.sid !== "string" ||
      !claims.sid.startsWith("sess_") ||
      claims.sts === "pending" ||
      typeof claims.azp !== "string" ||
      !parties.includes(claims.azp)
    )
      throw new UnauthorizedException(
        "A complete Clerk user session is required",
      );
    let user, session;
    try {
      [user, session] = await Promise.all([
        this.users.getUserById(claims.sub, true),
        this.users.client().sessions.getSession(claims.sid),
      ]);
    } catch (e: any) {
      if (e instanceof NotFoundException || e?.status === 404)
        throw new UnauthorizedException(
          "Session unavailable or account deleted",
        );
      throw new ServiceUnavailableException(
        "Clerk is temporarily unavailable. Please try again.",
      );
    }
    if (session.status !== "active" || session.userId !== user.id)
      throw new UnauthorizedException("Session revoked");
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId,
    );
    if (primary?.verification?.status !== "verified")
      throw new ForbiddenException("Verify your email in your Clerk account");
    return {
      id: user.id,
      clerkUserId: user.id,
      username: user.username ?? undefined,
      onboardingComplete: publicPlayer(user).onboardingComplete,
      assessment: privatePlayer(user).assessment,
    };
  }
}
