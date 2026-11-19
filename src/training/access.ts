import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { isUUID } from "class-validator";
@Injectable()
export class TrainingAccess {
  constructor(private db: PrismaService) {}
  async user(actor?: string) {
    if (
      !actor ||
      !isUUID(actor) ||
      !(await this.db.user.findUnique({
        where: { id: actor },
        select: { id: true },
      }))
    )
      throw new UnauthorizedException();
    return actor;
  }
  isEditor(actor?: string) {
    return (
      !!actor &&
      (process.env.TRAINING_EDITOR_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .includes(actor)
    );
  }
  async editor(actor?: string) {
    await this.user(actor);
    if (!this.isEditor(actor))
      throw new ForbiddenException("Training content editor access required");
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
