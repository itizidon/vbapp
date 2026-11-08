import { notFound } from "next/navigation";
import { z } from "zod";
import { MatchDetails } from "@/components/match-pages";
export default async function Page({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  if (!z.uuid().safeParse(matchId).success) notFound();
  return <MatchDetails id={matchId} />;
}
