import { SignupForm } from "@/components/auth-form";
import { safeReturnTo } from "@/lib/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <SignupForm returnTo={safeReturnTo(params.next)} />;
}
