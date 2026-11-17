export interface CoachEvidence {
  factId: string;
  claim: string;
  supportingReviewCount: number;
  feedbackIds: string[];
  metricKey: string | null;
}
export interface CoachAnswer {
  message: string;
  evidence: CoachEvidence[];
  generalSuggestions: string[];
  recommendedDrillIds: string[];
  insufficientEvidence: boolean;
  status: string;
}
export interface CoachMessage {
  id: string;
  conversationId: string;
  question: string;
  startedAt: string;
  sourceAsOf?: string | null;
  status: string;
  response: CoachAnswer;
  model: string | null;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
}
export interface CoachConversation {
  id: string;
  title: string;
  updatedAt: string;
}
export interface CoachPage {
  messages: CoachMessage[];
  nextCursor: string | null;
}
export const COACH_FIELDS = `id conversationId question startedAt sourceAsOf status model promptVersion inputTokens outputTokens response { message status insufficientEvidence generalSuggestions recommendedDrillIds evidence {factId claim supportingReviewCount feedbackIds metricKey} }`;
export const COACH_SUGGESTIONS = [
  "What are my biggest weaknesses?",
  "What am I improving at?",
  "What should I focus on?",
  "How has my defense changed?",
  "What are my strongest skills?",
];
