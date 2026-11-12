import { isUUID } from "class-validator";
import { InternalRatingsService } from "../internal-ratings/internal-ratings.service";
import { ratingTransaction } from "../internal-ratings/transaction";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { dateRangeBounds } from "../common/date-range";
import { JwtService } from "@nestjs/jwt";
import { Prisma, FeedbackStatus } from "@prisma/client";
import { randomBytes, createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  SubmitFeedbackInput,
  SubmitGuestFeedbackInput,
  UpdateFeedbackInput,
} from "../common/inputs";
type Invite = {
  kind: "guest-feedback";
  nonce: string;
  recipientId: string;
  sportId: string;
  matchId?: string;
  linkId?: string;
  assignedReviewerId?: string;
};
@Injectable()
export class FeedbackService {
  constructor(
    private db: PrismaService,
    private jwt: JwtService,
    private internal: InternalRatingsService = new InternalRatingsService(db),
  ) {}
  async invite(
    actor: string,
    recipientId: string,
    sportId: string,
    matchId?: string,
    assignedReviewerId?: string,
  ) {
    if (actor !== recipientId)
      throw new ForbiddenException(
        "Users may create invites for feedback about themselves",
      );
    if (!(await this.db.sport.findUnique({ where: { id: sportId } })))
      throw new NotFoundException("Sport not found");
    await this.validateMatch(recipientId, sportId, matchId);
    if (assignedReviewerId) {
      if (!isUUID(assignedReviewerId) || assignedReviewerId === recipientId)
        throw new BadRequestException(
          "Choose a reviewer other than the recipient",
        );
      if (
        !(await this.db.user.findUnique({
          where: { id: assignedReviewerId },
          select: { id: true },
        }))
      )
        throw new NotFoundException("Reviewer not found");
    }
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const link = await this.db.feedbackLink.create({
      data: {
        recipientId,
        sportId,
        matchId,
        assignedReviewerId,
        tokenHash: this.tokenHash(token),
        expiresAt,
      },
    });
    return { token, expiresAt, linkId: link.id };
  }
  private tokenHash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  async revokeLink(actor: string, id: string) {
    return ratingTransaction(this.db, async (tx) => {
      const link = await tx.feedbackLink.findUnique({ where: { id } });
      if (!link) throw new NotFoundException("Feedback link not found");
      if (link.recipientId !== actor) throw new ForbiddenException();
      await tx.feedbackLink.update({
        where: { id },
        data: { revokedAt: link.revokedAt ?? new Date() },
      });
      return true;
    });
  }

  async submit(reviewerId: string, input: SubmitFeedbackInput) {
    return this.create(input, { reviewerId });
  }
  private async verifyInvitation(
    token: string,
    tx: Prisma.TransactionClient | PrismaService = this.db,
  ): Promise<Invite & { exp: number }> {
    try {
      if (typeof token !== "string" || token.length > 8192) throw new Error();
      if (/^[a-f0-9]{64}$/.test(token)) {
        const link = await tx.feedbackLink.findUnique({
          where: { tokenHash: this.tokenHash(token) },
        });
        if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now())
          throw new Error();
        return {
          kind: "guest-feedback",
          nonce: link.id,
          linkId: link.id,
          recipientId: link.recipientId,
          sportId: link.sportId,
          matchId: link.matchId ?? undefined,
          assignedReviewerId: link.assignedReviewerId ?? undefined,
          exp: Math.floor(link.expiresAt.getTime() / 1000),
        };
      }
      const payload = await this.jwt.verifyAsync<Invite & { exp: number }>(
        token,
      );
      if (
        payload.kind !== "guest-feedback" ||
        !isUUID(payload.nonce) ||
        !isUUID(payload.recipientId) ||
        !isUUID(payload.sportId) ||
        (payload.matchId != null && !isUUID(payload.matchId)) ||
        !Number.isInteger(payload.exp) ||
        payload.exp * 1000 <= Date.now()
      )
        throw new Error();
      return payload;
    } catch {
      throw new UnauthorizedException("Invalid or expired guest invitation");
    }
  }
  async invitation(token: string) {
    const payload = await this.verifyInvitation(token);
    const recipient = await this.db.user.findUnique({
      where: { id: payload.recipientId },
      select: { username: true },
    });
    if (!recipient) throw new NotFoundException("Player not found");
    const sport = await this.db.sport.findUnique({
      where: { id: payload.sportId },
      include: {
        skills: { where: { active: true }, orderBy: { name: "asc" } },
      },
    });
    if (!sport) throw new NotFoundException("Sport not found");
    let match = null;
    if (payload.matchId) {
      await this.validateMatch(
        payload.recipientId,
        payload.sportId,
        payload.matchId,
      );
      const source = await this.db.match.findUniqueOrThrow({
        where: { id: payload.matchId },
        select: {
          id: true,
          playedAt: true,
          teams: {
            orderBy: { teamNumber: "asc" },
            select: {
              teamNumber: true,
              score: true,
              participants: {
                select: {
                  guestName: true,
                  user: { select: { username: true } },
                },
              },
            },
          },
          participants: {
            where: { teamId: null },
            select: { guestName: true, user: { select: { username: true } } },
          },
        },
      });
      const name = (player: {
        guestName: string | null;
        user: { username: string } | null;
      }) => player.user?.username ?? player.guestName ?? "Player";
      match = {
        id: source.id,
        playedAt: source.playedAt,
        teams: source.teams.map((team) => ({
          teamNumber: team.teamNumber,
          score: team.score,
          players: team.participants.map(name),
        })),
        unassignedPlayers: source.participants.map(name),
      };
    }
    return {
      recipientId: payload.recipientId,
      recipientUsername: recipient.username,
      assignedReviewer: payload.assignedReviewerId
        ? await this.db.user.findUnique({
            where: { id: payload.assignedReviewerId },
            select: { id: true, username: true },
          })
        : null,
      approvalRequired: !!payload.assignedReviewerId,
      sport,
      match,
    };
  }
  async submitGuest(input: SubmitGuestFeedbackInput, submittedById?: string) {
    const payload = await this.verifyInvitation(input.token);
    if (
      payload.recipientId !== input.recipientId ||
      payload.sportId !== input.sportId ||
      (payload.matchId ?? null) !== (input.matchId ?? null)
    )
      throw new UnauthorizedException("Invitation does not match submission");
    return this.create(input, {
      linkToken: input.token,
      submittedById,
      guestName: input.guestName?.trim() || "Guest reviewer",
      nonce: payload.nonce,
      expiresAt: new Date(payload.exp * 1000),
    });
  }

  private async create(
    input: SubmitFeedbackInput,
    identity: {
      reviewerId?: string;
      guestName?: string;
      nonce?: string;
      expiresAt?: Date;
      linkToken?: string;
      submittedById?: string;
    },
  ) {
    if (identity.reviewerId === input.recipientId)
      throw new BadRequestException("Self-feedback is not allowed");
    const skillIds = input.ratings.map((r) => r.skillId);
    if (new Set(skillIds).size !== skillIds.length)
      throw new BadRequestException("Duplicate skill rating");
    return ratingTransaction(this.db, async (tx) => {
      const invitation = identity.linkToken
        ? await this.verifyInvitation(identity.linkToken, tx)
        : null;
      if (
        invitation &&
        (invitation.recipientId !== input.recipientId ||
          invitation.sportId !== input.sportId ||
          (invitation.matchId ?? null) !== (input.matchId ?? null))
      )
        throw new UnauthorizedException("Invitation does not match submission");
      const assignedReviewerId = invitation?.assignedReviewerId;
      const approvalRequired = !!assignedReviewerId;
      if (assignedReviewerId === input.recipientId)
        throw new BadRequestException("Self-feedback is not allowed");
      const [recipient, sport, skills] = await Promise.all([
        tx.user.findUnique({
          where: { id: input.recipientId },
          select: { id: true },
        }),
        tx.sport.findUnique({
          where: { id: input.sportId },
          select: { id: true },
        }),
        tx.skill.findMany({
          where: { id: { in: skillIds }, sportId: input.sportId, active: true },
          select: { id: true },
        }),
      ]);
      if (!recipient) throw new NotFoundException("Recipient not found");
      if (!sport) throw new NotFoundException("Sport not found");
      if (skills.length !== skillIds.length)
        throw new BadRequestException(
          "A rating skill is invalid or belongs to another sport",
        );
      await this.validateMatchTx(
        tx,
        input.recipientId,
        input.sportId,
        input.matchId,
      );
      const capturedAt = new Date();
      let assessment: null | {
        id: string;
        overallLevel: string;
        updatedAt: Date;
        ratings: { skillId: string; rating: number; updatedAt: Date }[];
      } = null;
      if (identity.reviewerId && !approvalRequired) {
        // Serialize self-assessment rating writers with snapshot readers. PostgreSQL's row lock plus
        // the SERIALIZABLE transaction prevents a mixed overall/rating version.
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "SelfAssessment" WHERE "userId"=${identity.reviewerId}::uuid AND "sportId"=${input.sportId}::uuid FOR SHARE`;
        if (rows[0])
          assessment = await tx.selfAssessment.findUnique({
            where: { id: rows[0].id },
            include: { ratings: true },
          });
      }
      const feedback = await tx.feedback.create({
        data: {
          recipientId: input.recipientId,
          sportId: input.sportId,
          matchId: input.matchId,
          overallComment: input.overallComment,
          analyticsAllowed: input.analyticsAllowed ?? false,
          evidenceAllowed: input.evidenceAllowed ?? false,
          reviewerId: assignedReviewerId ?? identity.reviewerId,
          guestName: identity.guestName,
          guestInviteNonce: identity.nonce,
          guestInviteExpiresAt: identity.expiresAt,
          feedbackLinkId: invitation?.linkId,
          submittedById: identity.submittedById ?? identity.reviewerId,
          approvalRequired,
          status: approvalRequired ? "PENDING" : "PUBLISHED",
          ...(assessment
            ? {
                reviewerOverallLevelAtSubmission: assessment.overallLevel,
                reviewerSnapshotCapturedAt: capturedAt,
                reviewerSelfAssessmentUpdatedAtAtSubmission:
                  assessment.updatedAt,
                reviewerSelfAssessmentIdAtSubmission: assessment.id,
              }
            : {}),
        },
      });
      await tx.feedbackRating.createMany({
        data: input.ratings.map((r) => ({
          feedbackId: feedback.id,
          skillId: r.skillId,
          rating: r.rating,
          comment: r.comment,
        })),
      });
      if (assessment?.ratings.length)
        await tx.feedbackReviewerSkillSnapshot.createMany({
          data: assessment.ratings.map((r) => ({
            feedbackId: feedback.id,
            skillId: r.skillId,
            ratingAtSubmission: r.rating,
            sourceRatingUpdatedAt: r.updatedAt,
            capturedAt,
          })),
        });
      if (!approvalRequired) await this.internal.syncFeedback(tx, feedback.id);
      return tx.feedback.findUniqueOrThrow({
        where: { id: feedback.id },
        include: { ratings: true, reviewerSkillSnapshots: true },
      });
    });
  }
  private async validateMatch(
    recipientId: string,
    sportId: string,
    matchId?: string,
  ) {
    return this.validateMatchTx(this.db, recipientId, sportId, matchId);
  }
  private async validateMatchTx(
    tx: Prisma.TransactionClient | PrismaService,
    recipientId: string,
    sportId: string,
    matchId?: string,
  ) {
    if (!matchId) return;
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: {
        participants: { where: { userId: recipientId }, select: { id: true } },
      },
    });
    if (!match) throw new NotFoundException("Match not found");
    if (match.sportId && match.sportId !== sportId)
      throw new BadRequestException("Match sport differs from feedback sport");
    if (!match.participants.length)
      throw new BadRequestException("Recipient is not a match participant");
  }
  async pendingApprovals(actor: string, cursor?: string) {
    const where: Prisma.FeedbackWhereInput = {
      reviewerId: actor,
      approvalRequired: true,
      status: "PENDING",
    };
    const [totalCount, rows] = await this.db.$transaction(
      async (tx) =>
        Promise.all([
          tx.feedback.count({ where }),
          tx.feedback.findMany({
            where,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 11,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: {
              recipient: { select: { username: true } },
              match: {
                select: { id: true, playedAt: true, description: true },
              },
              ratings: { include: { skill: { select: { name: true } } } },
            },
          }),
        ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const hasMore = rows.length > 10;
    const items = rows.slice(0, 10).map((row) => ({
      ...row,
      recipientUsername: row.recipient.username,
      ratings: row.ratings.map((r) => ({ ...r, skillName: r.skill.name })),
    }));
    return {
      totalCount,
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }
  async decide(actor: string, id: string, approve: boolean, reason?: string) {
    if (reason && reason.length > 1000)
      throw new BadRequestException("Rejection reason is too long");
    return ratingTransaction(this.db, async (tx) => {
      const feedback = await tx.feedback.findUnique({
        where: { id },
        include: { feedbackLink: true },
      });
      if (!feedback) throw new NotFoundException("Feedback not found");
      const link = feedback.feedbackLink;
      if (feedback.reviewerId !== actor || feedback.recipientId === actor)
        throw new ForbiddenException("Only the designated reviewer may decide");
      if (
        !feedback.approvalRequired ||
        !link ||
        link.assignedReviewerId !== actor ||
        link.recipientId !== feedback.recipientId ||
        link.sportId !== feedback.sportId ||
        link.matchId !== feedback.matchId
      )
        throw new BadRequestException(
          "Feedback has no matching reviewer assignment",
        );
      const target = approve ? "PUBLISHED" : "REJECTED";
      if (
        (approve &&
          feedback.approvedById === actor &&
          feedback.approvedAt &&
          feedback.status === target) ||
        (!approve &&
          feedback.rejectedById === actor &&
          feedback.rejectedAt &&
          feedback.status === target)
      )
        return feedback;
      if (feedback.status !== "PENDING")
        throw new BadRequestException("Feedback has already been processed");
      if (approve && link.revokedAt)
        throw new BadRequestException("This feedback link was revoked");
      if (approve) {
        const activeSkills = await tx.feedbackRating.findMany({
          where: { feedbackId: id, skill: { active: true } },
          select: { skillId: true },
        });
        const initialized = await tx.playerInternalRating.count({
          where: {
            userId: feedback.recipientId,
            skillId: { in: activeSkills.map((row) => row.skillId) },
          },
        });
        if (initialized !== activeSkills.length)
          throw new BadRequestException(
            "The recipient’s internal ratings must be initialized before approval",
          );
      }
      await tx.feedback.update({
        where: { id },
        data: approve
          ? { status: "PUBLISHED", approvedAt: new Date(), approvedById: actor }
          : {
              status: "REJECTED",
              rejectedAt: new Date(),
              rejectedById: actor,
              rejectionReason: reason?.trim() || null,
            },
      });
      if (approve) await this.internal.syncFeedback(tx, id);
      return tx.feedback.findUniqueOrThrow({
        where: { id },
        include: { ratings: true, reviewerSkillSnapshots: true },
      });
    });
  }
  async update(actor: string, input: UpdateFeedbackInput) {
    return ratingTransaction(this.db, async (tx) => {
      const old = await tx.feedback.findUnique({
        where: { id: input.id },
        include: { ratings: true },
      });
      if (!old) throw new NotFoundException();
      if (old.reviewerId !== actor)
        throw new ForbiddenException(
          "Only the registered reviewer can edit feedback",
        );
      if (
        old.approvalRequired &&
        (old.status !== "PUBLISHED" ||
          (input.status && input.status !== old.status))
      )
        throw new BadRequestException(
          "Use approval or rejection to process assigned feedback",
        );
      if (!old.approvalRequired && input.status === "REJECTED")
        throw new BadRequestException(
          "Rejection is only available for assigned feedback",
        );
      const { id, ratings, ...data } = input;
      await tx.feedback.update({ where: { id }, data });
      if (ratings) {
        if (new Set(ratings.map((r) => r.skillId)).size !== ratings.length)
          throw new BadRequestException("Duplicate skill rating");
        const count = await tx.skill.count({
          where: {
            id: { in: ratings.map((r) => r.skillId) },
            sportId: old.sportId,
          },
        });
        if (count !== ratings.length)
          throw new BadRequestException("A skill belongs to another sport");
        await tx.feedbackRating.deleteMany({ where: { feedbackId: id } });
        await tx.feedbackRating.createMany({
          data: ratings.map((r) => ({
            feedbackId: id,
            skillId: r.skillId,
            rating: r.rating,
            comment: r.comment,
          })),
        });
      }
      await this.internal.syncFeedback(tx, id);
      return tx.feedback.findUniqueOrThrow({
        where: { id },
        include: { ratings: true, reviewerSkillSnapshots: true },
      });
    });
  }
  async delete(actor: string, id: string) {
    return ratingTransaction(this.db, async (tx) => {
      const f = await tx.feedback.findUnique({ where: { id } });
      if (!f) throw new NotFoundException();
      if (f.approvalRequired && f.status !== "PUBLISHED")
        throw new BadRequestException(
          "Pending and rejected drafts must be retained for review",
        );
      if (f.reviewerId !== actor && f.recipientId !== actor)
        throw new ForbiddenException();
      await tx.feedback.update({
        where: { id },
        data: { status: FeedbackStatus.DELETED, overallComment: null },
      });
      await this.internal.syncFeedback(tx, id);
      return tx.feedback.findUniqueOrThrow({
        where: { id },
        include: { ratings: true, reviewerSkillSnapshots: true },
      });
    });
  }
  async get(actor: string, id: string) {
    const f = await this.db.feedback.findUnique({
      where: { id },
      include: {
        ratings: true,
        reviewerSkillSnapshots: true,
        reviewer: { select: { username: true } },
      },
    });
    if (!f) throw new NotFoundException();
    if (
      f.approvalRequired &&
      f.status !== "PUBLISHED" &&
      actor !== f.reviewerId
    )
      throw new ForbiddenException();
    if (actor !== f.recipientId && actor !== f.reviewerId)
      throw new ForbiddenException();
    return this.privateView(f, actor);
  }
  received(
    actor: string,
    cursor?: string,
    matchOnly?: boolean,
    createdFrom?: Date,
    createdBefore?: Date,
  ) {
    const bounds = dateRangeBounds(createdFrom, createdBefore);
    return this.list(
      {
        recipientId: actor,
        OR: [{ approvalRequired: false }, { status: "PUBLISHED" }],
        ...(bounds ? { createdAt: bounds } : {}),
        ...(matchOnly == null
          ? {}
          : { matchId: matchOnly ? { not: null } : null }),
      },
      actor,
      cursor,
    );
  }
  submitted(actor: string, cursor?: string) {
    return this.list({ reviewerId: actor }, actor, cursor);
  }
  private async list(
    where: Prisma.FeedbackWhereInput,
    actor: string,
    cursor?: string,
  ) {
    const rows = await this.db.feedback.findMany({
      where: { ...where, status: { not: FeedbackStatus.DELETED } },
      include: {
        ratings: true,
        reviewerSkillSnapshots: true,
        reviewer: { select: { username: true } },
      },
      take: 11,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map((r) => this.privateView(r, actor));
  }
  private privateView<
    T extends {
      reviewerId: string | null;
      reviewer?: { username: string } | null;
      reviewerSkillSnapshots: any[];
      reviewerOverallLevelAtSubmission: string | null;
      reviewerSnapshotCapturedAt: Date | null;
    },
  >(f: T, actor: string): T {
    const view = { ...f, reviewerUsername: f.reviewer?.username ?? null };
    if (f.reviewerId === actor) return view;
    return {
      ...view,
      reviewerSkillSnapshots: [],
      reviewerOverallLevelAtSubmission: null,
      reviewerSnapshotCapturedAt: null,
    };
  }
}
