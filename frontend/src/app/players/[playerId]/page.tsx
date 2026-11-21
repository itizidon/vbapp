import { notFound } from "next/navigation";
import {isClerkPlayerId}from"@/lib/player-id";
import { PlayerHistory } from "@/components/player-pages";
export default async function Page({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  if (!isClerkPlayerId(playerId)) notFound();
  return <PlayerHistory id={playerId} />;
}
