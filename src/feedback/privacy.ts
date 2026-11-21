import { ClerkUserService } from "../auth/clerk/users";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Field,
  ID,
  InputType,
  ObjectType,
  Resolver,
  Mutation,
  Args,
  Query,
} from "@nestjs/graphql";
import { UseGuards } from "@nestjs/common";
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
import { Prisma, Feedback } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { GqlAuthGuard } from "../common/gql-auth.guard";
import { AuthUser, CurrentUser } from "../common/current-user.decorator";
import { FeedbackModel, UserModel } from "../common/models";

export const PENDING_AI_NOTICE_VERSION = "pending-ai-disclosure-v1";
export const PRIVACY_NOTICE_VERSION = "feedback-privacy-v1";
export type PrivacyChoices = {
  privateAnalyticsAllowed?: boolean;
  privateCoachingAllowed?: boolean;
  publicAnalyticsAllowed?: boolean;
  privacyNoticeVersion?: string;
  pendingAiAllowed?: boolean;
  pendingAiNoticeVersion?: string;
};
@InputType()
export class FeedbackPrivacyInput implements PrivacyChoices {
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  pendingAiAllowed?: boolean;
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  pendingAiNoticeVersion?: string;
  @Field(() => ID) @IsUUID() feedbackId!: string;
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  privateAnalyticsAllowed?: boolean;
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  privateCoachingAllowed?: boolean;
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  publicAnalyticsAllowed?: boolean;
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  privacyNoticeVersion?: string;
}
export function privacyGrant(choices: PrivacyChoices, ownAuthority = true) {
  const wants =
    choices.privateAnalyticsAllowed === true ||
    choices.privateCoachingAllowed === true ||
    choices.publicAnalyticsAllowed === true;
  if (wants && choices.privacyNoticeVersion !== PRIVACY_NOTICE_VERSION)
    throw new BadRequestException(
      "Read the current privacy notice before opting in",
    );
  const now = new Date();
  return {
    privateAnalyticsAllowed:
      ownAuthority && choices.privateAnalyticsAllowed === true,
    privateCoachingAllowed:
      ownAuthority && choices.privateCoachingAllowed === true,
    publicAnalyticsAllowed:
      ownAuthority && choices.publicAnalyticsAllowed === true,
    ...(ownAuthority && wants
      ? { privacyNoticeVersion: PRIVACY_NOTICE_VERSION }
      : {}),
    ...(ownAuthority && choices.privateAnalyticsAllowed === true
      ? { privateAnalyticsConsentAt: now }
      : {}),
    ...(ownAuthority && choices.privateCoachingAllowed === true
      ? { privateCoachingConsentAt: now }
      : {}),
    ...(ownAuthority && choices.publicAnalyticsAllowed === true
      ? { publicConsentAt: now, publicConsentVersion: PRIVACY_NOTICE_VERSION }
      : {}),
  };
}
export async function privacyEvents(
  tx: Prisma.TransactionClient,
  row: Pick<
    Feedback,
    | "id"
    | "privateAnalyticsAllowed"
    | "privateCoachingAllowed"
    | "publicAnalyticsAllowed"
  >,
  actorId: string | null,
  actorRole: string,
  previous?: Pick<
    Feedback,
    | "privateAnalyticsAllowed"
    | "privateCoachingAllowed"
    | "publicAnalyticsAllowed"
  >,
) {
  const purposes = {
    privateAnalyticsAllowed: "PRIVATE_ANALYTICS",
    privateCoachingAllowed: "PRIVATE_COACHING",
    publicAnalyticsAllowed: "PUBLIC_AGGREGATES",
  } as const;
  const data = (Object.keys(purposes) as (keyof typeof purposes)[])
    .filter((k) => (previous ? previous[k] !== row[k] : row[k]))
    .map((k) => ({
      feedbackId: row.id,
      purpose: purposes[k],
      allowed: row[k],
      noticeVersion: PRIVACY_NOTICE_VERSION,
      actorId,
      actorRole,
    }));
  if (data.length) await tx.feedbackPrivacyEvent.createMany({ data });
}
@Injectable()
export class FeedbackPrivacyService {
  constructor(
    private db: PrismaService,
    private jwt: JwtService,
  ) {}
  async update(actor: string, input: FeedbackPrivacyInput) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Feedback" WHERE id=${input.feedbackId}::uuid FOR UPDATE`;
      const old = await tx.feedback.findUnique({
        where: { id: input.feedbackId },
      });
      if (!old) throw new NotFoundException("Feedback not found");
      if (old.reviewerId !== actor)
        throw new ForbiddenException(
          "Only the reviewer can change processing permissions",
        );
      if (
        ["DELETED", "REJECTED"].includes(old.status) &&
        [
          input.privateAnalyticsAllowed,
          input.privateCoachingAllowed,
          input.publicAnalyticsAllowed,
        ].includes(true)
      )
        throw new BadRequestException("Removed feedback cannot be opted in");
      if (
        input.pendingAiAllowed === true &&
        (old.status !== "PENDING" ||
          !old.approvalRequired ||
          !old.submittedAt ||
          input.pendingAiNoticeVersion !== PENDING_AI_NOTICE_VERSION)
      )
        throw new BadRequestException(
          "Read and accept the pending AI disclosure for a submitted assigned review",
        );
      const grant = privacyGrant(input);
      const data: Prisma.FeedbackUpdateInput = {
        ...(input.pendingAiAllowed !== undefined
          ? {
              pendingAiAllowed: input.pendingAiAllowed,
              ...(input.pendingAiAllowed
                ? {
                    pendingAiConsentAt: new Date(),
                    pendingAiNoticeVersion: PENDING_AI_NOTICE_VERSION,
                  }
                : {}),
            }
          : {}),
        ...(input.privateAnalyticsAllowed !== undefined
          ? {
              privateAnalyticsAllowed: grant.privateAnalyticsAllowed,
              ...(input.privateAnalyticsAllowed
                ? { privateAnalyticsConsentAt: grant.privateAnalyticsConsentAt }
                : {}),
            }
          : {}),
        ...(input.privateCoachingAllowed !== undefined
          ? {
              privateCoachingAllowed: grant.privateCoachingAllowed,
              ...(input.privateCoachingAllowed
                ? { privateCoachingConsentAt: grant.privateCoachingConsentAt }
                : {}),
            }
          : {}),
        ...(input.publicAnalyticsAllowed !== undefined
          ? {
              publicAnalyticsAllowed: grant.publicAnalyticsAllowed,
              ...(input.publicAnalyticsAllowed
                ? {
                    publicConsentAt: grant.publicConsentAt,
                    publicConsentVersion: grant.publicConsentVersion,
                  }
                : {}),
            }
          : {}),
        ...([
          input.privateAnalyticsAllowed,
          input.privateCoachingAllowed,
        ].includes(true)
          ? { privacyNoticeVersion: PRIVACY_NOTICE_VERSION }
          : {}),
      };
      const row = await tx.feedback.update({ where: { id: old.id }, data });
      await privacyEvents(tx, row, actor, "REGISTERED_REVIEWER", old);
      if (old.pendingAiAllowed !== row.pendingAiAllowed)
        await tx.feedbackPrivacyEvent.create({
          data: {
            feedbackId: old.id,
            purpose: "PENDING_RECIPIENT_AI_DISCLOSURE",
            allowed: row.pendingAiAllowed,
            noticeVersion: PENDING_AI_NOTICE_VERSION,
            actorId: actor,
            actorRole: "ASSIGNED_REVIEWER",
          },
        });
      return row;
    });
  }
  async guestReceipt<T extends Feedback>(
    row: T,
  ): Promise<T & { privacyWithdrawalToken?: string }> {
    if (row.reviewerId || !row.guestInviteNonce) return row;
    // Purpose-limited receipt: only withdrawal, no permission grants, content reads or account access.
    return {
      ...row,
      privacyWithdrawalToken: await this.jwt.signAsync(
        {
          kind: "feedback-privacy-withdrawal",
          iat: Math.floor(row.createdAt.getTime() / 1000),
          feedbackId: row.id,
          nonce: row.guestInviteNonce,
        },
        { expiresIn: "365d" },
      ),
    };
  }
  async withdrawGuest(token: string) {
    let claims: { kind?: string; feedbackId?: string; nonce?: string };
    try {
      claims = await this.jwt.verifyAsync(token);
    } catch {
      throw new BadRequestException("Invalid or expired privacy receipt");
    }
    if (
      claims.kind !== "feedback-privacy-withdrawal" ||
      !claims.feedbackId ||
      !claims.nonce
    )
      throw new BadRequestException("Invalid privacy receipt");
    return this.db.$transaction(async (tx) => {
      const old = await tx.feedback.findUnique({
        where: { id: claims.feedbackId },
      });
      if (!old || old.reviewerId || old.guestInviteNonce !== claims.nonce)
        throw new BadRequestException("Invalid privacy receipt");
      const row = await tx.feedback.update({
        where: { id: old.id },
        data: {
          privateAnalyticsAllowed: false,
          privateCoachingAllowed: false,
          publicAnalyticsAllowed: false,
        },
      });
      await privacyEvents(tx, row, null, "GUEST_RECEIPT", old);
      return true;
    });
  }
}
@Resolver()
export class FeedbackPrivacyResolver {
  constructor(
    private service: FeedbackPrivacyService,
    private db: PrismaService,
    private users: ClerkUserService,
  ) {}
  @UseGuards(GqlAuthGuard) @Mutation(() => FeedbackModel) updateFeedbackPrivacy(
    @CurrentUser() u: AuthUser,
    @Args("input") input: FeedbackPrivacyInput,
  ) {
    return this.service.update(u.id, input);
  }
  @Mutation(() => Boolean) withdrawGuestFeedbackPrivacy(
    @Args("token") token: string,
  ) {
    if (token.length > 4096)
      throw new BadRequestException("Invalid privacy receipt");
    return this.service.withdrawGuest(token);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => UserModel)
  updatePrivateCoachingPreference(
    @CurrentUser() u: AuthUser,
    @Args("enabled") enabled: boolean,
  ) {
    return this.updateCoachingPreference(u.id, enabled);
  }
  private async updateCoachingPreference(id: string, enabled: boolean) {
    await this.users.updatePlayerMetadata(id, { aiCoachingEnabled: enabled });
    if (!enabled)
      await this.db.$transaction(async (tx) => {
        const sources = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "Feedback" WHERE "recipientId"=${id}::text ORDER BY id FOR UPDATE`;
        await tx.feedbackObservation.deleteMany({
          where: { feedbackId: { in: sources.map((f) => f.id) } },
        });
        await tx.feedbackAnalysisJob.updateMany({
          where: { feedback: { recipientId: id } },
          data: {
            status: "SKIPPED",
            generation: { increment: 1 },
            leaseToken: null,
            leaseUntil: null,
          },
        });
        await tx.playerFeedbackAnalysisProfile.updateMany({
          where: { userId: id },
          data: { data: {}, stale: true, revision: { increment: 1 } },
        });
        await tx.aiCoachTurn.updateMany({
          where: { userId: id },
          data: {
            response: Prisma.DbNull,
            errorCode: "OUTDATED",
            status: "FAILED",
          },
        });
      });
    if (enabled)
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT count(queue_feedback_analysis(f.id))::int FROM "Feedback" f LEFT JOIN "FeedbackAnalysisJob" j ON j."feedbackId"=f.id WHERE f."recipientId"=${id}::text AND feedback_analysis_eligible(f) AND (j.status='SKIPPED' OR j."feedbackId" IS NULL) AND (NULLIF(btrim(f."overallComment"),'') IS NOT NULL OR EXISTS(SELECT 1 FROM "FeedbackRating" r WHERE r."feedbackId"=f.id AND NULLIF(btrim(r.comment),'') IS NOT NULL))`;
        await tx.playerFeedbackAnalysisProfile.updateMany({
          where: { userId: id },
          data: { stale: true, revision: { increment: 1 } },
        });
      });
    return this.users.getCurrentUser(id);
  }
}
