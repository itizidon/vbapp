import { JwtService } from "@nestjs/jwt";
import { FeedbackService } from "../src/feedback/feedback.service";
const recipientId = "11111111-1111-4111-8111-111111111111",
  sportId = "22222222-2222-4222-8222-222222222222",
  matchId = "33333333-3333-4333-8333-333333333333",
  nonce = "44444444-4444-4444-8444-444444444444";
const jwt = new JwtService({
  secret: "feedback-preview-test-only-secret-at-least-32",
});
function fixture() {
  const db: any = {
    sport: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: sportId,
          name: "Beach Volleyball",
          slug: "beach-volleyball",
          skills: ["Attack", "Defense", "Passing", "Setting", "Serving"].map(
            (name) => ({ name, active: true }),
          ),
        }),
    },
    match: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: matchId,
          sportId,
          participants: [{ id: "participant" }],
        }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: matchId,
        playedAt: new Date("2026-11-11T18:00:00Z"),
        teams: [
          {
            teamNumber: 1,
            score: 21,
            participants: [
              { guestName: null, user: { username: "Alex" } },
              { guestName: "Sam", user: null },
            ],
          },
          {
            teamNumber: 2,
            score: 0,
            participants: [{ guestName: null, user: { username: "Blair" } }],
          },
        ],
        participants: [],
      }),
    },
  };
  return { db, service: new FeedbackService(db, jwt) };
}
const sign = (
  scopedMatch: string | null = matchId,
  expiresIn: number | string = "24h",
) =>
  jwt.signAsync(
    {
      kind: "guest-feedback",
      recipientId,
      sportId,
      matchId: scopedMatch,
      nonce,
    },
    { expiresIn: expiresIn as any },
  );
it("returns all active categories and only the signed match preview", async () => {
  const { db, service } = fixture();
  const result = await service.invitation(await sign());
  expect(result.sport.skills.map((s) => s.name)).toEqual([
    "Attack",
    "Defense",
    "Passing",
    "Setting",
    "Serving",
  ]);
  expect(result.match).toEqual({
    id: matchId,
    playedAt: expect.any(Date),
    teams: [
      { teamNumber: 1, score: 21, players: ["Alex", "Sam"] },
      { teamNumber: 2, score: 0, players: ["Blair"] },
    ],
    unassignedPlayers: [],
  });
  expect(db.match.findUniqueOrThrow).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: matchId } }),
  );
  expect(result.match).not.toHaveProperty("createdById");
  expect(db.sport.findUnique).toHaveBeenCalledWith({
    where: { id: sportId },
    include: { skills: { where: { active: true }, orderBy: { name: "asc" } } },
  });
});
it("does not read private matches for a general feedback link", async () => {
  const { db, service } = fixture();
  expect((await service.invitation(await sign(null))).match).toBeNull();
  expect(db.match.findUnique).not.toHaveBeenCalled();
  expect(db.match.findUniqueOrThrow).not.toHaveBeenCalled();
});
it("rejects expired, tampered, and ordinary login tokens before reading data", async () => {
  const { db, service } = fixture();
  for (const token of [
    await sign(matchId, -1),
    (await sign()) + "tampered",
    await jwt.signAsync({ sub: recipientId }, { expiresIn: "15m" }),
  ])
    await expect(service.invitation(token)).rejects.toThrow(
      "Invalid or expired",
    );
  expect(db.sport.findUnique).not.toHaveBeenCalled();
});
it("does not reveal a match after its recipient was removed", async () => {
  const { db, service } = fixture();
  db.match.findUnique.mockResolvedValue({
    id: matchId,
    sportId,
    participants: [],
  });
  await expect(service.invitation(await sign())).rejects.toThrow(
    "Recipient is not a match participant",
  );
  expect(db.match.findUniqueOrThrow).not.toHaveBeenCalled();
});
it("does not reveal a match with a different sport", async () => {
  const { db, service } = fixture();
  db.match.findUnique.mockResolvedValue({
    id: matchId,
    sportId: "other",
    participants: [{ id: "participant" }],
  });
  await expect(service.invitation(await sign())).rejects.toThrow(
    "Match sport differs",
  );
  expect(db.match.findUniqueOrThrow).not.toHaveBeenCalled();
});
