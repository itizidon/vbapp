import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RegisteredFeedbackPage } from "@/components/feedback-form";
import { LoadingSkeleton } from "@/components/common";
export default async function Page({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  if (!z.uuid().safeParse(userId).success) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <RegisteredFeedbackPage recipientId={userId} />
    </Suspense>
  );
}
