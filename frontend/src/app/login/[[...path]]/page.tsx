import { ClerkAuthPage } from "@/components/clerk-auth";
import { safeReturnTo } from "@/lib/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <ClerkAuthPage
      mode="login"
      returnTo={next ? safeReturnTo(next) : undefined}
    />
  );
}
