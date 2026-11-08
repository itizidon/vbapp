import { LoginForm } from "@/components/auth-form";
import { safeReturnTo } from "@/lib/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm returnTo={safeReturnTo(params.next)} />;
}
