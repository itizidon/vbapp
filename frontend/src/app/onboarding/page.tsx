import { PlayerOnboarding } from "@/components/player-onboarding";
import { ClerkAuthPage } from "@/components/clerk-auth";
import { safeReturnTo } from "@/lib/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <PlayerOnboarding returnTo={safeReturnTo(next)} />
  ) : (
    <ClerkAuthPage mode="signup" />
  );
}
