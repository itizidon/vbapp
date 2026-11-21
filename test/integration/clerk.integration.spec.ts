import {
  TestDatabase,
  clerkId,
  clerkToken,
  createFixtureUser,
  fixtureUsers,
  fixtureRole,
} from "../helpers/clerk-fixtures";
import { ClerkUserService } from "../../src/auth/clerk/users";
import { ClerkSessions } from "../../src/auth/clerk/sessions";
import { SelfAssessmentsService } from "../../src/self-assessments/self-assessments.service";
import { MatchesService } from "../../src/matches/matches.service";
import { FeedbackService } from "../../src/feedback/feedback.service";
import { TrainingAccess } from "../../src/training/access";
import { ClerkDeletionService } from "../../src/auth/clerk/deletion";
import { ClerkWebhookController } from "../../src/auth/clerk/webhook";
import { TrainingVideoJobs } from "../../src/training/jobs.service";
import { JwtService } from "@nestjs/jwt";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "Clerk-only identities and domain persistence",
  () => {
    let db: TestDatabase,
      users: ClerkUserService,
      self: SelfAssessmentsService,
      matches: MatchesService,
      feedback: FeedbackService,
      sportId: string,
      skillId: string;
    beforeAll(async () => {
      db = new TestDatabase({ datasources: { db: { url } } });
      users = new ClerkUserService(db as never);
      self = new SelfAssessmentsService(db as never, users);
      matches = new MatchesService(db as never, users);
      feedback = new FeedbackService(
        db as never,
        new JwtService({ secret: process.env.GUEST_CAPABILITY_SECRET }),
        undefined,
        undefined,
        users,
      );
      const sport = await db.sport.create({
        data: {
          name: "Clerk profile fixture",
          slug: "clerk-" + randomUUID(),
          skills: {
            create: {
              name: "Passing",
              slug: "passing",
              requiredForSelfAssessment: true,
            },
          },
        },
        include: { skills: true },
      });
      sportId = sport.id;
      skillId = sport.skills[0].id;
    });
    afterAll(() => db.$disconnect());
    const input = () => ({
      age: 25,
      heightCm: 180,
      sportId,
      overallLevel: "B",
      ratings: [{ skillId, rating: 3 }],
    });
    async function player() {
      const u = createFixtureUser();
      u.publicMetadata.bvbtips.onboardingComplete = false;
      await self.onboard(u.id, input());
      return u.id;
    }
    it("has no User, identity-provider, verification or current-profile tables", async () => {
      const rows = await db.$queryRaw<
        { table_name: string }[]
      >`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
      const names = rows.map((r) => r.table_name);
      for (const name of [
        "User",
        "UserAuthProvider",
        "AuthEmailChallenge",
        "OAuthTransaction",
        "SelfAssessment",
        "SelfAssessmentRating",
        "PlayerTrainingProfile",
      ])
        expect(names).not.toContain(name);
      const columns = await db.$queryRaw<
        { data_type: string }[]
      >`SELECT data_type FROM information_schema.columns WHERE table_name='Match' AND column_name='createdById'`;
      expect(columns[0].data_type).toBe("text");
    });
    it("stores onboarding privately in Clerk, preserves a PLAYER role and reconciles domain history idempotently", async () => {
      const id = await player(),
        profile = fixtureUsers.get(id).privateMetadata.bvbtips;
      expect(profile).toMatchObject({
        age: 25,
        heightCm: 180,
        role: "PLAYER",
        assessment: { sportId, ratings: [{ skillId, rating: 3 }] },
      });
      expect(fixtureUsers.get(id).publicMetadata.bvbtips).toMatchObject({
        onboardingComplete: true,
        isPublic: false,
      });
      await self.list(id);
      await self.list(id);
      expect(
        await db.selfAssessmentRatingEvent.count({ where: { userId: id } }),
      ).toBe(1);
      expect(
        await db.playerInternalRating.count({ where: { userId: id } }),
      ).toBe(1);
      await users.updatePlayerMetadata(id, { role: "ADMIN" } as never);
      expect(fixtureUsers.get(id).privateMetadata.bvbtips.role).toBe("PLAYER");
    });
    it("edits the current Clerk assessment and appends history without changing established internal baselines", async () => {
      const id = await player(),
        a = (await self.list(id))[0];
      await self.updateRatings(id, {
        id: a.id,
        ratings: [{ skillId, rating: 5 }],
      });
      expect((await self.list(id))[0]).toMatchObject({
        id: a.id,
        ratings: [{ skillId, rating: 5 }],
      });
      expect(
        await db.selfAssessmentRatingEvent.count({ where: { userId: id } }),
      ).toBe(2);
      expect(
        (
          await db.playerInternalRating.findFirstOrThrow({
            where: { userId: id },
          })
        ).currentRating.toNumber(),
      ).toBe(3);
    });
    it("stores the authenticated Clerk creator and validates registered players, preserving guests", async () => {
      const owner = await player(),
        member = await player();
      const m = await matches.create(owner, {
        teams: [
          { memberIds: [owner], score: 21 },
          { memberIds: [member], guestNames: ["Teammate"], score: 18 },
        ],
        createdById: member,
      } as never);
      expect(m.createdById).toBe(owner);
      expect(m.participants.map((p) => p.userId).filter(Boolean)).toEqual(
        expect.arrayContaining([owner, member]),
      );
      await expect(
        matches.update(member, { id: m.id, description: "forged" }),
      ).rejects.toThrow("organizer");
      await expect(
        matches.create(owner, { memberIds: [randomUUID()] }),
      ).rejects.toThrow("Clerk");
    });
    it("keeps anonymous feedback and reviewer approval as separate authorities", async () => {
      const recipient = await player(),
        reviewer = await player(),
        stranger = await player();
      const match = await matches.create(recipient, {
        sportId,
        memberIds: [recipient, reviewer],
      });
      const guestLink = await feedback.invite(
        recipient,
        recipient,
        sportId,
        match.id,
      );
      const before = fixtureUsers.size;
      const guest = await feedback.submitGuest({
        recipientId: recipient,
        sportId,
        matchId: match.id,
        token: guestLink.token,
        guestName: "Guest teammate",
        ratings: [{ skillId, rating: 4.2 }],
      });
      expect(guest.reviewerId).toBeNull();
      expect(fixtureUsers.size).toBe(before);
      const assigned = await feedback.invite(
        recipient,
        recipient,
        sportId,
        match.id,
        reviewer,
      );
      const draft = await feedback.submitGuest({
        recipientId: recipient,
        sportId,
        matchId: match.id,
        token: assigned.token,
        ratings: [{ skillId, rating: 4.7 }],
      });
      expect(draft).toMatchObject({
        status: "PENDING",
        reviewerId: reviewer,
        approvalRequired: true,
      });
      await expect(feedback.decide(stranger, draft.id, true)).rejects.toThrow();
      const approved = await feedback.decide(reviewer, draft.id, true);
      expect(approved.status).toBe("PUBLISHED");
    });
    it("rejects privilege escalation and grants coaching only through trusted administrator metadata", async () => {
      const actor = await player(),
        target = await player(),
        access = new TrainingAccess(db as never, users);
      fixtureUsers.get(actor).unsafeMetadata = { bvbtips: { role: "ADMIN" } };
      await expect(users.setRole(actor, target, "COACH")).rejects.toThrow(
        "Administrator",
      );
      await expect(access.editor(actor)).rejects.toThrow("Coach");
      fixtureRole(actor, "ADMIN");
      expect(await users.setRole(actor, target, "COACH")).toBe(true);
      expect(await access.editor(target)).toBe(target);
      expect(await access.isEditor(await player())).toBe(false);
    });
    it("rejects unsigned deletion webhooks and idempotently cleans private data without deleting shared matches", async () => {
      const subject = await player(),
        other = await player(),
        coach = await player();
      fixtureRole(coach, "COACH");
      const match = await matches.create(subject, {
        sportId,
        memberIds: [subject, other],
      });
      const f = await feedback.submit(subject, {
        recipientId: other,
        sportId,
        matchId: match.id,
        overallComment: "Private author detail",
        ratings: [{ skillId, rating: 4, comment: "Private detail" }],
      });
      const drill = await db.drill.create({
        data: {
          slug: "delete-fixture-" + randomUUID(),
          name: "Keep shared drill",
          description: "Shared curriculum",
          objective: "Shared objective",
          setup: "Shared setup",
          createdById: subject,
        },
      });
      const sid = randomUUID(),
        key = `training/players/${subject}/${sid}/original`;
      await db.drillVideoSubmission.create({
        data: {
          id: sid,
          userId: subject,
          drillId: drill.id,
          storageKey: key,
          mimeType: "video/mp4",
          fileSizeBytes: 100,
          cameraAngle: "SIDE",
          uploadExpiresAt: new Date(Date.now() + 60000),
          retentionExpiresAt: new Date(Date.now() + 86400000),
        },
      });
      const deletion = new ClerkDeletionService(db as never, users),
        controller = new ClerkWebhookController(deletion, users);
      const secret = randomBytes(32),
        saved = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
      process.env.CLERK_WEBHOOK_SIGNING_SECRET =
        "whsec_" + secret.toString("base64");
      const eventId = "msg_" + randomUUID().replace(/-/g, ""),
        timestamp = String(Math.floor(Date.now() / 1000)),
        raw = Buffer.from(
          JSON.stringify({
            type: "user.deleted",
            data: { id: subject, deleted: true, object: "user" },
            object: "event",
            timestamp: Date.now(),
          }),
        );
      try {
        await expect(
          controller.webhook({ rawBody: raw, headers: {} }),
        ).rejects.toThrow();
        expect(
          await db.clerkDeletionJob.count({ where: { id: eventId } }),
        ).toBe(0);
        const signature = createHmac("sha256", secret)
            .update(`${eventId}.${timestamp}.${raw.toString()}`)
            .digest("base64"),
          req = {
            rawBody: raw,
            headers: {
              "svix-id": eventId,
              "svix-timestamp": timestamp,
              "svix-signature": "v1," + signature,
            },
          };
        fixtureUsers.delete(subject);
        await controller.webhook(req);
        await controller.webhook(req);
        expect(
          await db.clerkDeletionJob.count({ where: { id: eventId } }),
        ).toBe(1);
        await deletion.processOne();
        expect(
          await db.clerkDeletionJob.findUnique({ where: { id: eventId } }),
        ).toMatchObject({ status: "COMPLETED", userId: null });
        expect((await matches.get(match.id, other))?.id).toBe(match.id);
        expect(
          await db.drill.findUnique({ where: { id: drill.id } }),
        ).toMatchObject({ createdById: null });
        const kept = await db.feedback.findUniqueOrThrow({
          where: { id: f.id },
          include: { ratings: true },
        });
        expect(kept.recipientId).toBe(other);
        expect(kept.reviewerId).toMatch(/^deleted_/);
        expect(kept.overallComment).toBeNull();
        expect(kept.ratings[0].comment).toBeNull();
        expect(kept.ratings[0].rating.toNumber()).toBe(4);
        expect(
          await db.drillVideoSubmission.count({ where: { userId: subject } }),
        ).toBe(0);
        const storage = { delete: jest.fn().mockResolvedValue(undefined) };
        await new TrainingVideoJobs(db as never, storage as never).cleanupBatch(
          10,
        );
        expect(storage.delete).toHaveBeenCalledWith(key);
        await expect(
          new ClerkSessions(users).authenticate(
            "Bearer " + clerkToken(subject),
          ),
        ).rejects.toThrow();
      } finally {
        if (saved) process.env.CLERK_WEBHOOK_SIGNING_SECRET = saved;
        else delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
      }
    });
  },
);
