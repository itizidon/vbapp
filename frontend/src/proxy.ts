import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from "next/server";
const protectedRoute = createRouteMatcher([
  "/matches(.*)",
  "/feedback(.*)",
  "/analytics(.*)",
  "/account(.*)",
  "/training(.*)",
  "/admin(.*)",
  "/onboarding(.*)",
  "/give-feedback(.*)",
  "/approvals(.*)",
  "/profile(.*)",
  "/my-feedback(.*)",
  "/insights(.*)",
  "/settings(.*)",
  "/skills(.*)",
]);
const middleware = clerkMiddleware(async (auth, req) => {
  if (protectedRoute(req)) await auth.protect();
});
export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  ) {
    if (protectedRoute(req))
      return NextResponse.redirect(new URL("/login", req.url));
    return NextResponse.next();
  }
  return middleware(req, event);
}
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
