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
import { Prisma, FeedbackStatus, FeedbackReviewMode } from "@prisma/client";
import { randomBytes, createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  SubmitFeedbackInput,
  SubmitGuestFeedbackInput,
  UpdateFeedbackInput,
} from "../common/inputs";
import { SubmitFeedbackRequestInput } from "./request.models";
type Invite = {
  matchIds?: string[];
  reviewMode?: FeedbackReviewMode;
  kind: "guest-feedback";
  nonce: string;
  recipientId: string;
  sportId: string;
  matchId?: string;
  linkId?: string;
  assignedReviewerId?: string;
  guestSession?: boolean;
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
    matchIds?: string[],
    reviewMode: FeedbackReviewMode = FeedbackReviewMode.INDIVIDUAL_MATCHES,
  ) {
    if (actor !== recipientId)
      throw new ForbiddenException(
        "Users may create invites for feedback about themselves",
      );
    if (!(await this.db.sport.findUnique({ where: { id: sportId } })))
      throw new NotFoundException("Sport not found");
    await this.validateMatch(recipientId, sportId, matchId);
    if (!Object.values(FeedbackReviewMode).includes(reviewMode))
      throw new BadRequestException("Invalid feedback mode");
    if (matchIds) {
      if (
        matchIds.length > 20 ||
        new Set(matchIds).size !== matchIds.length ||
        matchIds.some((id) => !isUUID(id))
      )
        throw new BadRequestException("Select at most 20 distinct matches");
      if (matchId && (matchIds.length !== 1 || matchIds[0] !== matchId))
        throw new BadRequestException("Conflicting match selection");
      await this.validateRequestMatches(
        this.db,
        recipientId,
        sportId,
        matchIds,
      );
      matchId = matchIds.length === 1 ? matchIds[0] : undefined;
    }

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
        mode: reviewMode,
        ...(matchIds?.length
          ? {
              requestMatches: {
                create: matchIds.map((id, displayOrder) => ({
                  matchId: id,
                  displayOrder,
                })),
              },
            }
          : {}),
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

  async reviewerSuggestions(
    actor: string | undefined,
    search: string,
    token?: string,
    recipientId?: string,
  ) {
    const invitation = token ? await this.verifyInvitation(token) : null;
    if (!invitation && !actor)
      throw new UnauthorizedException("Sign in or open a feedback invitation");
    if (invitation?.guestSession) return [];
    const recipient = invitation?.recipientId ?? recipientId;
    if (!recipient || !isUUID(recipient))
      throw new BadRequestException("A valid recipient is required");
    if (invitation && recipientId && recipientId !== invitation.recipientId)
      throw new UnauthorizedException("Invitation does not match recipient");
    const query = search.trim();
    if (query.length > 40)
      throw new BadRequestException("Search must be at most 40 characters");
    if (query.length < 2) return [];
    return this.db.user.findMany({
      where: {
        id: invitation?.assignedReviewerId ?? { not: recipient },
        username: { contains: query, mode: "insensitive" },
      },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
      take: 10,
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
          include: { requestMatches: { orderBy: { displayOrder: "asc" } } },
        });
        if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now())
          throw new Error();
        return {
          kind: "guest-feedback",
          matchIds: link.requestMatches?.map((row) => row.matchId) ?? [],
          reviewMode: link.mode,
          nonce: link.id,
          linkId: link.id,
          recipientId: link.recipientId,
          sportId: link.sportId,
          matchId: link.matchId ?? undefined,
          assignedReviewerId: link.assignedReviewerId ?? undefined,
          exp: Math.floor(link.expiresAt.getTime() / 1000),
        };
      }
      const claims = await this.jwt.verifyAsync<{
        kind: string;
        linkId?: string;
        sourceSubmissionId?: string;
        exp: number;
      }>(token);
      if (claims.kind === "guest-feedback-followup") {
        if (
          !isUUID(claims.linkId) ||
          !isUUID(claims.sourceSubmissionId) ||
          !Number.isInteger(claims.exp)
        )
          throw new Error();
        const link = await tx.feedbackLink.findUnique({
          where: { id: claims.linkId },
          include: { requestMatches: { orderBy: { displayOrder: "asc" } } },
        });
        const source = await tx.feedbackSubmission.findFirst({
          where: {
            id: claims.sourceSubmissionId,
            feedbackLinkId: claims.linkId,
            feedback: { some: {} },
          },
          select: { id: true },
        });
        if (
          !link ||
          !source ||
          link.revokedAt ||
          !link.requestMatches.length ||
          link.expiresAt.getTime() <= Date.now() ||
          claims.exp * 1000 > link.expiresAt.getTime() ||
          claims.exp * 1000 <= Date.now()
        )
          throw new Error();
        return {
          kind: "guest-feedback",
          guestSession: true,
          nonce: source.id,
          linkId: link.id,
          recipientId: link.recipientId,
          sportId: link.sportId,
          matchId: link.matchId ?? undefined,
          matchIds: link.requestMatches.map((row) => row.matchId),
          reviewMode: link.mode,
          exp: claims.exp,
        };
      }
      const payload = claims as Invite & { exp: number };
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
      const stored = await tx.feedbackLink.findUnique({
        where: { tokenHash: this.tokenHash(token) },
      });
      if (
        stored &&
        (stored.revokedAt || stored.expiresAt.getTime() <= Date.now())
      )
        throw new Error();
      return {
        ...payload,
        linkId: stored?.id,
        assignedReviewerId: stored?.assignedReviewerId ?? undefined,
      };
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
    const requestMatches = payload.matchIds?.length
      ? await this.requestMatchPreviews(
          payload.recipientId,
          payload.sportId,
          payload.matchIds,
        )
      : [];
    return {
      guestSession: !!payload.guestSession,
      reviewMode: payload.reviewMode ?? FeedbackReviewMode.INDIVIDUAL_MATCHES,
      matches: requestMatches,
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
      batch?: boolean;
      submissionId?: string;
    },
    transaction?: Prisma.TransactionClient,
  ) {
    if (identity.reviewerId === input.recipientId && !input.assignedReviewerId)
      throw new BadRequestException("Self-feedback is not allowed");
    const skillIds = input.ratings.map((r) => r.skillId);
    if (new Set(skillIds).size !== skillIds.length)
      throw new BadRequestException("Duplicate skill rating");
    const work = async (tx: Prisma.TransactionClient) => {
      const invitation = identity.linkToken
        ? await this.verifyInvitation(identity.linkToken, tx)
        : null;
      if (
        invitation &&
        (invitation.recipientId !== input.recipientId ||
          invitation.sportId !== input.sportId ||
          (identity.batch
            ? invitation.reviewMode === FeedbackReviewMode.INDIVIDUAL_MATCHES
              ? !invitation.matchIds?.includes(input.matchId ?? "")
              : !!input.matchId
            : (invitation.matchId ?? null) !== (input.matchId ?? null)))
      )
        throw new UnauthorizedException("Invitation does not match submission");
      if (invitation?.matchIds?.length && !identity.batch)
        throw new BadRequestException("Submit all request reviews together");
      if (
        invitation?.assignedReviewerId &&
        input.assignedReviewerId &&
        input.assignedReviewerId !== invitation.assignedReviewerId
      )
        throw new BadRequestException(
          "This link already has a designated reviewer",
        );
      const assignedReviewerId =
        invitation?.assignedReviewerId ?? input.assignedReviewerId;
      const approvalRequired = !!assignedReviewerId;
      if (
        assignedReviewerId &&
        (!isUUID(assignedReviewerId) ||
          !(await tx.user.findUnique({
            where: { id: assignedReviewerId },
            select: { id: true },
          })))
      )
        throw new NotFoundException("Reviewer not found");
      if (assignedReviewerId === input.recipientId)
        throw new BadRequestException("Self-feedback is not allowed");
      let feedbackLinkId = invitation?.linkId;
      if (approvalRequired && invitation && !feedbackLinkId) {
        const legacyLink = await tx.feedbackLink.upsert({
          where: { tokenHash: this.tokenHash(identity.linkToken!) },
          update: {},
          create: {
            tokenHash: this.tokenHash(identity.linkToken!),
            recipientId: invitation.recipientId,
            sportId: invitation.sportId,
            matchId: invitation.matchId,
            expiresAt: new Date(invitation.exp * 1000),
          },
        });
        if (legacyLink.revokedAt)
          throw new UnauthorizedException(
            "Invalid or expired guest invitation",
          );
        feedbackLinkId = legacyLink.id;
      }
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
          submissionId: identity.submissionId,
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
          feedbackLinkId,
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
        data: await Promise.all(
          input.ratings.map(async (r) => ({
            feedbackId: feedback.id,
            skillId: r.skillId,
            rating: r.rating,
            comment: r.comment,
            ...(await this.internal.snapshotReviewerInfluence(
              tx,
              assignedReviewerId ?? identity.reviewerId ?? null,
              r.skillId,
            )),
          })),
        ),
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
      if (!approvalRequired && !identity.batch)
        await this.internal.syncFeedback(tx, feedback.id);
      return tx.feedback.findUniqueOrThrow({
        where: { id: feedback.id },
        include: {
          ratings: true,
          reviewerSkillSnapshots: true,
          associatedMatches: {
            include: {
              match: {
                select: { id: true, description: true, playedAt: true },
              },
            },
          },
        },
      });
    };
    return transaction ? work(transaction) : ratingTransaction(this.db, work);
  }
  private async validateRequestMatches(
    tx: Prisma.TransactionClient | PrismaService,
    recipientId: string,
    sportId: string,
    ids: string[],
  ) {
    if (!ids.length) return;
    const rows = await tx.match.findMany({
      where: {
        id: { in: ids },
        sportId,
        participants: { some: { userId: recipientId } },
      },
      select: { id: true },
    });
    if (rows.length !== ids.length)
      throw new BadRequestException(
        "Every selected match must belong to this sport and include the recipient",
      );
  }
  private async requestMatchPreviews(
    recipientId: string,
    sportId: string,
    ids: string[],
  ) {
    const rows = await this.db.match.findMany({
      where: {
        id: { in: ids },
        sportId,
        participants: { some: { userId: recipientId } },
      },
      include: {
        teams: {
          orderBy: { teamNumber: "asc" },
          include: {
            participants: { include: { user: { select: { username: true } } } },
          },
        },
        participants: {
          where: { teamId: null },
          include: { user: { select: { username: true } } },
        },
      },
    });
    if (rows.length !== ids.length)
      throw new BadRequestException(
        "A requested match is no longer available to this recipient",
      );
    const name = (p: {
      guestName: string | null;
      user: { username: string } | null;
    }) => p.user?.username ?? p.guestName ?? "Player";
    return ids.map((id) => {
      const row = rows.find((r) => r.id === id)!;
      return {
        id: row.id,
        playedAt: row.playedAt,
        teams: row.teams.map((t) => ({
          teamNumber: t.teamNumber,
          score: t.score,
          players: t.participants.map(name),
        })),
        unassignedPlayers: row.participants.map(name),
      };
    });
  }
  async startGuestReviewSession(token: string, completedSubmissionId: string) {
    const invitation = await this.verifyInvitation(token);
    if (
      !invitation.linkId ||
      !invitation.matchIds?.length ||
      !isUUID(completedSubmissionId)
    )
      throw new UnauthorizedException("A completed match review is required");
    const source = await this.db.feedbackSubmission.findUnique({
      where: {
        feedbackLinkId_clientSubmissionId: {
          feedbackLinkId: invitation.linkId,
          clientSubmissionId: completedSubmissionId,
        },
      },
      select: {
        id: true,
        createdAt: true,
        feedback: { select: { id: true } },
      },
    });
    if (!source?.feedback.length)
      throw new UnauthorizedException("A completed match review is required");
    // A completed receipt only authorizes a handoff from its own review session.
    // Root reviews use the link nonce; follow-ups use their parent receipt ID.
    const scoped = await this.db.feedback.count({
      where: { submissionId: source.id, guestInviteNonce: invitation.nonce },
    });
    if (scoped !== source.feedback.length)
      throw new UnauthorizedException(
        "This receipt belongs to another review session",
      );
    const issuedAt = Math.floor(source.createdAt.getTime() / 1000);
    const followup = await this.jwt.signAsync(
      {
        kind: "guest-feedback-followup",
        linkId: invitation.linkId,
        sourceSubmissionId: source.id,
        iat: issuedAt,
      },
      // Override the login-token TTL while preserving a deterministic handoff.
      { expiresIn: invitation.exp - issuedAt, noTimestamp: false },
    );
    return { token: followup, expiresAt: new Date(invitation.exp * 1000) };
  }

  async submitRequest(
    input: SubmitFeedbackRequestInput,
    submittedById?: string,
  ) {
    return ratingTransaction(this.db, async (tx) => {
      const invitation = await this.verifyInvitation(input.token, tx);
      const ids = invitation.matchIds ?? [];
      if (!invitation.linkId || !ids.length)
        throw new BadRequestException(
          "Use the original submission flow for this invitation",
        );
      if (
        !isUUID(input.submissionId) ||
        !Array.isArray(input.reviews) ||
        input.reviews.length > 20
      )
        throw new BadRequestException("Invalid request submission");
      const individual =
        invitation.reviewMode === FeedbackReviewMode.INDIVIDUAL_MATCHES;
      if (
        individual
          ? input.reviews.length !== ids.length ||
            new Set(input.reviews.map((r) => r.matchId)).size !== ids.length ||
            input.reviews.some((r) => !ids.includes(r.matchId ?? ""))
          : input.reviews.length !== 1 || !!input.reviews[0].matchId
      )
        throw new BadRequestException(
          "Reviews must exactly match the authorized request",
        );
      for (const review of input.reviews) {
        if (
          !review.ratings?.length ||
          review.ratings.length > 20 ||
          review.ratings.some(
            (r) =>
              !isUUID(r.skillId) ||
              !Number.isInteger(r.rating) ||
              r.rating < 1 ||
              r.rating > 5 ||
              (r.comment?.length ?? 0) > 5000,
          ) ||
          (review.overallComment?.length ?? 0) > 5000
        )
          throw new BadRequestException("Invalid skill ratings or comments");
      }
      if (
        invitation.guestSession &&
        (input.asGuest !== true || input.assignedReviewerId)
      )
        throw new ForbiddenException(
          "This session is for an unverified guest review only",
        );
      const assigned =
        invitation.assignedReviewerId ?? input.assignedReviewerId;
      if (input.asGuest === false && !submittedById)
        throw new UnauthorizedException(
          "Sign in to submit as a registered reviewer",
        );
      const reviewerId =
        !assigned && input.asGuest === false ? submittedById : undefined;
      const canonical = {
        ...input,
        reviews: [...input.reviews].sort((a, b) =>
          (a.matchId ?? "").localeCompare(b.matchId ?? ""),
        ),
        submittedById,
      };
      const payloadHash = createHash("sha256")
        .update(JSON.stringify(canonical))
        .digest("hex");
      const previous = await tx.feedbackSubmission.findUnique({
        where: {
          feedbackLinkId_clientSubmissionId: {
            feedbackLinkId: invitation.linkId,
            clientSubmissionId: input.submissionId,
          },
        },
        include: {
          feedback: {
            include: {
              ratings: true,
              associatedMatches: { include: { match: true } },
            },
          },
        },
      });
      if (previous) {
        if (previous.payloadHash !== payloadHash)
          throw new BadRequestException(
            "Submission ID was already used for different feedback",
          );
        return previous.feedback;
      }
      await this.validateRequestMatches(
        tx,
        invitation.recipientId,
        invitation.sportId,
        ids,
      );
      const batch = await tx.feedbackSubmission.create({
        data: {
          feedbackLinkId: invitation.linkId,
          clientSubmissionId: input.submissionId,
          payloadHash,
        },
      });
      const created = [];
      for (const id of individual ? ids : [null]) {
        const review = individual
          ? input.reviews.find((r) => r.matchId === id)!
          : input.reviews[0];
        const record = await this.create(
          {
            ...review,
            matchId: id ?? undefined,
            recipientId: invitation.recipientId,
            sportId: invitation.sportId,
            assignedReviewerId: input.assignedReviewerId,
          },
          {
            linkToken: input.token,
            submittedById,
            reviewerId,
            guestName: reviewerId
              ? undefined
              : input.guestName?.trim() || "Guest reviewer",
            nonce: invitation.nonce,
            expiresAt: new Date(invitation.exp * 1000),
            batch: true,
            submissionId: batch.id,
          },
          tx,
        );
        if (!individual)
          await tx.feedbackMatch.createMany({
            data: ids.map((matchId) => ({ feedbackId: record.id, matchId })),
          });
        created.push(record);
      }
      for (const record of created)
        if (record.status === "PUBLISHED")
          await this.internal.syncFeedback(tx, record.id);
      await tx.feedbackLink.update({
        where: { id: invitation.linkId },
        data: { lastSubmittedAt: new Date() },
      });
      return tx.feedback.findMany({
        where: { submissionId: batch.id },
        include: {
          ratings: true,
          associatedMatches: { include: { match: true } },
        },
        orderBy: { createdAt: "asc" },
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
              associatedMatches: {
                include: {
                  match: {
                    select: { id: true, description: true, playedAt: true },
                  },
                },
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
      matches: row.match
        ? [row.match]
        : row.associatedMatches.map((r) => r.match),
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
        include: {
          feedbackLink: { include: { requestMatches: true } },
          ratings: true,
          reviewerSkillSnapshots: true,
          match: { select: { id: true, description: true, playedAt: true } },
          associatedMatches: {
            include: {
              match: {
                select: { id: true, description: true, playedAt: true },
              },
            },
          },
        },
      });
      if (!feedback) throw new NotFoundException("Feedback not found");
      const link = feedback.feedbackLink;
      if (feedback.reviewerId !== actor || feedback.recipientId === actor)
        throw new ForbiddenException("Only the designated reviewer may decide");
      if (
        !feedback.approvalRequired ||
        (!link && !feedback.submittedById) ||
        (link &&
          ((link.assignedReviewerId !== null &&
            link.assignedReviewerId !== actor) ||
            link.recipientId !== feedback.recipientId ||
            link.sportId !== feedback.sportId ||
            (link.requestMatches?.length
              ? link.mode === "INDIVIDUAL_MATCHES"
                ? !link.requestMatches.some(
                    (row) => row.matchId === feedback.matchId,
                  ) || feedback.associatedMatches.length > 0
                : feedback.matchId !== null ||
                  link.requestMatches.length !==
                    feedback.associatedMatches.length ||
                  feedback.associatedMatches.some(
                    (row) =>
                      !link.requestMatches.some(
                        (scope) => scope.matchId === row.matchId,
                      ),
                  )
              : link.matchId !== feedback.matchId)))
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
      if (approve && link?.revokedAt)
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
        include: {
          ratings: true,
          reviewerSkillSnapshots: true,
          associatedMatches: {
            include: {
              match: {
                select: { id: true, description: true, playedAt: true },
              },
            },
          },
        },
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
        await tx.feedbackRating.deleteMany({
          where: {
            feedbackId: id,
            skillId: { notIn: ratings.map((r) => r.skillId) },
          },
        });
        for (const r of ratings) {
          const where = {
            feedbackId_skillId: { feedbackId: id, skillId: r.skillId },
          };
          if (old.ratings.some((saved) => saved.skillId === r.skillId)) {
            // Editing scores/comments must not replace the submission snapshot.
            await tx.feedbackRating.update({
              where,
              data: { rating: r.rating, comment: r.comment },
            });
          } else {
            await tx.feedbackRating.create({
              data: {
                feedbackId: id,
                skillId: r.skillId,
                rating: r.rating,
                comment: r.comment,
                ...(await this.internal.snapshotReviewerInfluence(
                  tx,
                  old.reviewerId,
                  r.skillId,
                )),
              },
            });
          }
        }
      }
      await this.internal.syncFeedback(tx, id);
      return tx.feedback.findUniqueOrThrow({
        where: { id },
        include: {
          ratings: true,
          reviewerSkillSnapshots: true,
          associatedMatches: {
            include: {
              match: {
                select: { id: true, description: true, playedAt: true },
              },
            },
          },
        },
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
        include: {
          ratings: true,
          reviewerSkillSnapshots: true,
          associatedMatches: {
            include: {
              match: {
                select: { id: true, description: true, playedAt: true },
              },
            },
          },
        },
      });
    });
  }
  async get(actor: string, id: string) {
    const f = await this.db.feedback.findUnique({
      where: { id },
      include: {
        ratings: true,
        reviewerSkillSnapshots: true,
        match: { select: { id: true, description: true, playedAt: true } },
        associatedMatches: {
          include: {
            match: { select: { id: true, description: true, playedAt: true } },
          },
        },
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
    matchId?: string,
  ) {
    const bounds = dateRangeBounds(createdFrom, createdBefore);
    return this.list(
      {
        recipientId: actor,
        OR: [{ approvalRequired: false }, { status: "PUBLISHED" }],
        ...(bounds ? { createdAt: bounds } : {}),
        AND: [
          ...(matchId
            ? [
                {
                  OR: [
                    { matchId },
                    { associatedMatches: { some: { matchId } } },
                  ],
                },
              ]
            : []),
          ...(matchOnly == null
            ? []
            : [
                matchOnly
                  ? {
                      OR: [
                        { matchId: { not: null } },
                        { associatedMatches: { some: {} } },
                      ],
                    }
                  : { matchId: null, associatedMatches: { none: {} } },
              ]),
        ],
      },
      actor,
      cursor,
    );
  }
  submitted(actor: string, cursor?: string, matchId?: string) {
    return this.list(
      {
        reviewerId: actor,
        ...(matchId
          ? { OR: [{ matchId }, { associatedMatches: { some: { matchId } } }] }
          : {}),
      },
      actor,
      cursor,
    );
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
        match: { select: { id: true, description: true, playedAt: true } },
        associatedMatches: {
          include: {
            match: { select: { id: true, description: true, playedAt: true } },
          },
        },
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
