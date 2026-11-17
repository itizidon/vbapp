import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { rebuildProfiles } from "../feedback-processing/profiles";

// Only SQL aggregation: this worker never extracts text or calls an AI provider.
// Profile rows are the durable queue; database locks/revisions coordinate replicas.
@Injectable()
export class FeedbackProfileWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeedbackProfileWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(private readonly db: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.rebuild().finally(() => {
        this.running = undefined;
      });
    }, 5000);
    this.timer.unref();
  }

  private async rebuild() {
    try {
      await rebuildProfiles(this.db, 20);
    } catch {
      this.logger.warn(
        "PROFILE_REBUILD_UNAVAILABLE: check database migrations and connectivity",
      );
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
