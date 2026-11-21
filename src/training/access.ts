import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ClerkUserService } from "../auth/clerk/users";
import { isClerkUserId } from "../auth/clerk/metadata";
@Injectable()
export class TrainingAccess {
  constructor(
    private db: PrismaService,
    readonly users: ClerkUserService = new ClerkUserService(db),
  ) {}
  async user(actor?: string) {
    if (!isClerkUserId(actor)) throw new UnauthorizedException();
    await this.users.getUserById(actor, true);
    return actor;
  }
  async isEditor(actor?: string) {
    return actor ? this.users.isCoach(actor) : false;
  }
  async editor(actor?: string) {
    await this.user(actor);
    if (!(await this.isEditor(actor)))
      throw new ForbiddenException(
        "Coach or administrator editor access required",
      );
    return actor!;
  }
  async owner(actor: string, owner: string) {
    await this.user(actor);
    if (actor !== owner)
      throw new ForbiddenException(
        "Private training data belongs to another player",
      );
  }
}
