import { BadRequestException, Injectable } from "@nestjs/common";
import { isUUID } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { PROFILE_ALGORITHM_VERSION } from "./config";
import { cachedProfileReady } from "../feedback-processing/profiles";
import { FeedbackAnalysisProfile, FeedbackAnalysisResult } from "./models";
export type ProfileRequestCache = Map<string, Promise<FeedbackAnalysisResult>>;
@Injectable()
export class FeedbackAnalysisService {
  constructor(private readonly db: PrismaService) {}
  get(
    actorId: string,
    sportId: string,
    cache?: ProfileRequestCache,
  ): Promise<FeedbackAnalysisResult> {
    if (!isUUID(sportId)) throw new BadRequestException("Invalid sport ID");
    const key = actorId + ":" + sportId;
    const existing = cache?.get(key);
    if (existing) return existing;
    const pending = this.read(actorId, sportId);
    cache?.set(key, pending);
    return pending;
  }
  private async read(
    actorId: string,
    sportId: string,
  ): Promise<FeedbackAnalysisResult> {
    const sport = await this.db.sport.findFirst({
      where: { id: sportId, slug: { in: ["volleyball", "beach-volleyball"] } },
      select: { id: true },
    });
    if (!sport) throw new BadRequestException("Volleyball sport not found");
    // A first read durably queues a profile only. Interactive queries never aggregate or call providers.
    const row = await this.db.playerFeedbackAnalysisProfile.upsert({
      where: { userId_sportId: { userId: actorId, sportId } },
      create: { userId: actorId, sportId },
      update: {},
    });
    if (!cachedProfileReady(row))
      return {
        state: "STALE",
        rebuildQueued: true,
        lastErrorCode: row.rebuildError,
        profile: null,
      };
    const profile = row.data as unknown as FeedbackAnalysisProfile;
    if (
      !profile ||
      profile.playerId !== actorId ||
      profile.sportId !== sportId ||
      profile.algorithmVersion !== PROFILE_ALGORITHM_VERSION
    ) {
      await this.db.playerFeedbackAnalysisProfile.updateMany({
        where: { userId: actorId, sportId },
        data: { stale: true },
      });
      return {
        state: "STALE",
        rebuildQueued: true,
        lastErrorCode: "PROFILE_CACHE_INVALID",
        profile: null,
      };
    }
    return {
      state: "READY",
      rebuildQueued: false,
      lastErrorCode: null,
      profile,
    };
  }
}
