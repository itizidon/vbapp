import {
  Controller,
  Post,
  Req,
  UnauthorizedException,
  HttpCode,
} from "@nestjs/common";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { ClerkDeletionService } from "./deletion";
import { ClerkUserService } from "./users";
import { isClerkUserId } from "./metadata";
@Controller("auth/clerk")
export class ClerkWebhookController {
  constructor(
    private deletion: ClerkDeletionService,
    private users: ClerkUserService,
  ) {}
  @Post("webhooks")
  @HttpCode(200)
  async webhook(@Req() req: any) {
    if (
      !process.env.CLERK_WEBHOOK_SIGNING_SECRET ||
      !Buffer.isBuffer(req.rawBody)
    )
      throw new UnauthorizedException("Invalid webhook");
    let event;
    try {
      const headers = new Headers();
      for (const key of ["svix-id", "svix-timestamp", "svix-signature"])
        if (typeof req.headers[key] === "string")
          headers.set(key, req.headers[key]);
      event = await verifyWebhook(
        new Request("https://bvbtips.invalid/auth/clerk/webhooks", {
          method: "POST",
          headers,
          body: req.rawBody.toString("utf8"),
        }),
        { signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET },
      );
    } catch {
      throw new UnauthorizedException("Invalid webhook signature");
    }
    if (event.type === "user.deleted" && isClerkUserId(event.data.id))
      await this.deletion.enqueue(req.headers["svix-id"], event.data.id);
    else if (event.type === "user.updated" && isClerkUserId(event.data.id))
      this.users.invalidate(event.data.id);
    return { received: true };
  }
}
