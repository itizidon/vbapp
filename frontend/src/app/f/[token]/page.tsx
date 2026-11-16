import { FeedbackSubmissionForm } from "@/components/feedback-form";
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
      <main className="mx-auto max-w-6xl px-4 pb-12">
        <FeedbackSubmissionForm
          key={`${token}:${guestOnly ? "device" : "link"}`}
          recipientId=""
          sportId=""
          token={token}
          guestOnly={guestOnly}
        />
      </main>
    </div>
  );
}
