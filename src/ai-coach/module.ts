import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { CoachOpenAI } from "./provider";
import { CoachTools } from "./tools";
import { CoachEngine } from "./engine";
import { AiCoachService } from "./service";
import { AiCoachResolver } from "./resolver";
@Module({
  imports: [AuthModule, AnalyticsModule],
  providers: [
    CoachOpenAI,
    CoachTools,
    CoachEngine,
    AiCoachService,
    AiCoachResolver,
  ],
})
export class AiCoachModule {}
