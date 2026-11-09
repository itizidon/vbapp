import { notFound } from "next/navigation";
import { z } from "zod";
import { PlayerHistory } from "@/components/player-pages";
export default async function Page({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  if (!z.uuid().safeParse(playerId).success) notFound();
  return <PlayerHistory id={playerId} />;
}
