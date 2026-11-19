import { MotionAdmin } from "./motion-admin";
import { MotionRuntime } from "./motion-runtime";
import { TRAINING_VIDEO_PROVIDERS } from "./providers";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TrainingAccess } from "./access";
import { TrainingLibraryService } from "./library.service";
import { TrainingRecommendations } from "./recommendations.service";
import { TrainingVideoService } from "./video.service";
import { S3VideoStorage } from "./storage";
import { TrainingVideoJobs, TrainingReferenceSelection } from "./jobs.service";
import { TrainingCoachContext } from "./context.service";
import { TrainingResolver } from "./resolver";
import { TrainingJSON } from "./dto";
@Module({
  imports: [AuthModule],
  providers: [
    MotionRuntime,
    MotionAdmin,
    {
      provide: TRAINING_VIDEO_PROVIDERS,
      useValue: {
        preprocessor: {
          processingLocation: "LOCAL",
          version: "pose-video-extraction-v1",
        },
        orchestrator: {
          processingLocation: "LOCAL",
          analysisVersion: "confidence-dtw-v1",
          providerName: "local-mediapipe-cpu",
        },
      },
    },
    TrainingAccess,
    TrainingLibraryService,
    TrainingRecommendations,
    TrainingVideoService,
    S3VideoStorage,
    TrainingVideoJobs,
    TrainingReferenceSelection,
    TrainingCoachContext,
    TrainingResolver,
    TrainingJSON,
  ],
  exports: [
    TrainingLibraryService,
    TrainingRecommendations,
    TrainingVideoService,
    TrainingVideoJobs,
    TrainingReferenceSelection,
    TrainingCoachContext,
  ],
})
export class TrainingModule {}
