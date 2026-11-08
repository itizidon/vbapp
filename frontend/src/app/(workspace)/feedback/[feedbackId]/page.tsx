import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { FeedbackDetails } from "@/components/feedback-pages";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ feedbackId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (token) redirect(`/f/${encodeURIComponent(token)}`);
  const { feedbackId } = await params;
  if (!z.uuid().safeParse(feedbackId).success) notFound();
  return <FeedbackDetails id={feedbackId} />;
}
