import { PrismaService } from "../../prisma/prisma.service";
import { createClerkClient, type User } from "@clerk/backend";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  isClerkUserId,
  privatePlayer,
  publicPlayer,
  type PlayerMetadata,
  privatePlayerSchema,
  publicPlayerSchema,
} from "./metadata";
@Injectable()
export class ClerkUserService {
  constructor(@Optional() private db?: PrismaService) {}
  private api?: ReturnType<typeof createClerkClient>;
  private readonly cache = new Map<string, { user: User; expires: number }>();
  client() {
    if (!process.env.CLERK_SECRET_KEY)
      throw new ServiceUnavailableException("Clerk is not configured");
    return (this.api ??= createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
      ...(process.env.CLERK_PUBLISHABLE_KEY
        ? { publishableKey: process.env.CLERK_PUBLISHABLE_KEY }
        : {}),
    }));
  }
  invalidate(id: string) {
    this.cache.delete(id);
  }
  private remember(user: User) {
    if (this.cache.size >= 1000)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(user.id, { user, expires: Date.now() + 15000 });
    return user;
  }
  async getUserById(id: string, fresh = false): Promise<User> {
    if (!isClerkUserId(id))
      throw new BadRequestException("Invalid Clerk player ID");
    const cached = this.cache.get(id);
    if (!fresh && cached && cached.expires > Date.now()) return cached.user;
    try {
      const user = await this.client().users.getUser(id);
      if (user.banned || user.locked)
        throw new NotFoundException("Player unavailable");
      return this.remember(user);
    } catch (e: any) {
      if (e instanceof NotFoundException || e instanceof BadRequestException)
        throw e;
      if (e?.status === 404) {
        this.invalidate(id);
        throw new NotFoundException("Player not found");
      }
      throw new ServiceUnavailableException(
        "Player information is temporarily unavailable",
      );
    }
  }
  async getCurrentUser(id: string) {
    return this.getPrivatePlayerProfile(id, id);
  }
  private display(user: User) {
    return {
      id: user.id,
      username:
        user.username ||
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        "Player",
      displayName:
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.username ||
        "Player",
      imageUrl: user.imageUrl,
      isPublic: publicPlayer(user).isPublic,
    };
  }
  async getUsersByIds(
    ids: string[],
    fresh = false,
  ): Promise<Map<string, ReturnType<ClerkUserService["display"]>>> {
    const result = new Map<string, ReturnType<ClerkUserService["display"]>>(),
      missing: string[] = [];
    for (const id of new Set(ids.filter(isClerkUserId))) {
      if (fresh) this.cache.delete(id);
      const c = this.cache.get(id);
      if (c && c.expires > Date.now()) result.set(id, this.display(c.user));
      else missing.push(id);
    }
    for (let offset = 0; offset < missing.length; offset += 100) {
      try {
        const page = await this.client().users.getUserList({
          userId: missing.slice(offset, offset + 100),
          limit: 100,
        });
        for (const user of page.data) {
          if (!user.banned && !user.locked)
            result.set(user.id, this.display(this.remember(user)));
        }
      } catch {
        /* Labels degrade to Deleted/unavailable player; never leak private metadata or emails. */
      }
    }
    return result;
  }
  loadPublicPlayer(
    id: string,
    context: any,
  ): Promise<{ id: string; username: string } | null> {
    const req = context.req ?? context;
    const batch = (req.bvbtipsClerkNames ??= {
      pending: new Map<
        string,
        {
          resolve: (v: any) => void;
          promise: Promise<any>;
          dispatched: boolean;
        }
      >(),
      scheduled: false,
    });
    if (batch.pending.has(id)) return batch.pending.get(id).promise;
    let resolve!: (v: any) => void;
    const promise = new Promise<any>((done) => {
      resolve = done;
    });
    batch.pending.set(id, { resolve, promise, dispatched: false });
    if (!batch.scheduled) {
      batch.scheduled = true;
      queueMicrotask(async () => {
        const entries = [...batch.pending.entries()].filter(
          ([, v]: any) => !v.dispatched,
        ) as [string, { resolve: (v: any) => void; dispatched: boolean }][];
        for (const [, entry] of entries) entry.dispatched = true;
        batch.scheduled = false;
        const names = await this.getUsersByIds(entries.map(([key]) => key));
        for (const [key, value] of entries)
          value.resolve(names.get(key) ?? null);
      });
    }
    return promise;
  }
  async requireUsers(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.some((id) => !isClerkUserId(id)))
      throw new BadRequestException("Invalid Clerk player ID");
    const users = await this.getUsersByIds(unique, true);
    if (users.size !== unique.length)
      throw new BadRequestException("A selected player is unavailable");
    return users;
  }
  async getPublicPlayerProfile(id: string) {
    const user = await this.getUserById(id, true);
    return this.display(user);
  }
  async getPrivatePlayerProfile(actor: string, id: string) {
    if (actor !== id) throw new ForbiddenException("Player profile is private");
    const user = await this.getUserById(id, true),
      profile = privatePlayer(user),
      primary = user.emailAddresses.find(
        (e) => e.id === user.primaryEmailAddressId,
      );
    return {
      ...this.display(user),
      email: primary?.emailAddress ?? "",
      emailVerified: primary?.verification?.status === "verified",
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
      age: profile.age ?? null,
      heightCm: profile.heightCm ?? null,
      onboardingComplete: publicPlayer(user).onboardingComplete,
      aiCoachingEnabled: profile.aiCoachingEnabled,
    };
  }
  async search(query: string, limit = 5, cursor?: string) {
    query = query.trim();
    if (
      query.length > 254 ||
      limit < 1 ||
      limit > 51 ||
      (cursor && !isClerkUserId(cursor))
    )
      throw new BadRequestException("Invalid player search");
    try {
      const page = await this.client().users.getUserList({
        query: query || undefined,
        limit,
        orderBy: "+created_at",
        ...(cursor ? { startingAfter: cursor } : {}),
      });
      return page.data
        .filter((u) => !u.banned && !u.locked)
        .map((u) => this.display(this.remember(u)));
    } catch {
      throw new ServiceUnavailableException(
        "Player search is temporarily unavailable",
      );
    }
  }
  async withPlayerLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (!this.db)
      throw new ServiceUnavailableException(
        "Player metadata writes require the application database context",
      );
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"clerk-metadata:" + id}))`;
        return work();
      },
      { timeout: 20000, maxWait: 5000 },
    );
  }
  async updatePlayerMetadata(
    id: string,
    privatePatch: Partial<Omit<PlayerMetadata, "role" | "version">> = {},
    publicPatch: Partial<{
      isPublic: boolean;
      onboardingComplete: boolean;
    }> = {},
    locked = false,
  ): Promise<User> {
    if (!locked)
      return this.withPlayerLock(id, () =>
        this.updatePlayerMetadata(id, privatePatch, publicPatch, true),
      );
    const current = await this.getUserById(id, true),
      existing = privatePlayer(current);
    const profile = privatePlayerSchema.parse({
        ...existing,
        ...privatePatch,
        role: existing.role,
      }),
      pub = publicPlayerSchema.parse({
        ...publicPlayer(current),
        ...publicPatch,
      });
    if (Buffer.byteLength(JSON.stringify({ profile, pub })) > 6000)
      throw new BadRequestException(
        "Player settings exceed the metadata limit",
      );
    try {
      const user = await this.client().users.updateUserMetadata(id, {
        privateMetadata: { bvbtips: profile },
        publicMetadata: { bvbtips: pub },
      });
      this.invalidate(id);
      return user;
    } catch {
      throw new ServiceUnavailableException("Unable to save player settings");
    }
  }
  async isAdmin(id: string) {
    return privatePlayer(await this.getUserById(id, true)).role === "ADMIN";
  }
  async isCoach(id: string) {
    return ["COACH", "ADMIN"].includes(
      privatePlayer(await this.getUserById(id, true)).role,
    );
  }
  async setRole(
    actor: string,
    target: string,
    role: "PLAYER" | "COACH" | "ADMIN",
  ) {
    if (!(await this.isAdmin(actor)))
      throw new ForbiddenException("Administrator role required");
    if (!["PLAYER", "COACH", "ADMIN"].includes(role))
      throw new BadRequestException("Invalid role");
    return this.withPlayerLock(target, async () => {
      const user = await this.getUserById(target, true);
      await this.client().users.updateUserMetadata(target, {
        privateMetadata: { bvbtips: { ...privatePlayer(user), role } },
      });
      this.invalidate(target);
      return true;
    });
  }
}
