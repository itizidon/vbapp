import {
  VideoPreprocessor,
  VideoAnalysisOrchestrator,
} from "./analysis.contracts";
export const TRAINING_VIDEO_PROVIDERS = Symbol("TRAINING_VIDEO_PROVIDERS");
// Default registry is empty. A real local worker deployment must explicitly register implementations.
// External video/body-landmark processing is blocked; feedback AI consent is not video consent.
export interface TrainingVideoProviders {
  preprocessor?: VideoPreprocessor & {
    processingLocation: "LOCAL" | "EXTERNAL";
  };
  orchestrator?: VideoAnalysisOrchestrator & {
    processingLocation: "LOCAL" | "EXTERNAL";
    providerName: string;
  };
}
