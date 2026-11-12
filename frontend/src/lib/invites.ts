import { z } from "zod";
const inviteSchema = z.object({
  kind: z.literal("guest-feedback"),
  recipientId: z.uuid(),
  sportId: z.uuid(),
  matchId: z
    .uuid()
    .nullish()
    .transform((value) => value ?? undefined),
  exp: z.number().int().positive(),
});
export type InviteClaims = z.infer<typeof inviteSchema>;
// Decoding supplies routing hints only. The backend must verify the signature,
// scope, expiration, and nonce before invitation reads and submission.
// Decoded claims alone grant no read access.
export function decodeInviteToken(
  token: string,
  now = Date.now(),
): InviteClaims | null {
  try {
    if (token.length > 8192) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const claims = inviteSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    return claims.exp * 1000 > now ? claims : null;
  } catch {
    return null;
  }
}

export interface InvitedMatch {
  id: string;
  playedAt: string | null;
  teams: { teamNumber: number; score: number | null; players: string[] }[];
  unassignedPlayers: string[];
}
