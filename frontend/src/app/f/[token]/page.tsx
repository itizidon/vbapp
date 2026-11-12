import { FeedbackSubmissionForm } from "@/components/feedback-form";
import { Brand, ThemeToggle } from "@/components/app-shell";
export const metadata = {
  title: "Leave feedback",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const { token } = await params;
  const guestOnly = (await searchParams).mode === "device";
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
        {guestOnly ? (
          <span className="text-xl font-bold">bvbtips.</span>
        ) : (
          <Brand />
        )}
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-12 pt-4">
        <FeedbackSubmissionForm
          recipientId=""
          sportId=""
          token={token}
          guestOnly={guestOnly}
        />
      </main>
    </div>
  );
}
