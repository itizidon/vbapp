export interface User {
  isPublic: boolean;
  id: string;
  username: string;
  email: string;
  createdAt: string;
}
export interface Skill {
  id: string;
  name: string;
  slug: string;
  sportId: string;
  active: boolean;
  requiredForSelfAssessment: boolean;
  description?: string | null;
}
export interface Sport {
  id: string;
  name: string;
  slug: string;
  skills: Skill[];
}
export interface Rating {
  skillId: string;
  rating: number;
  comment?: string | null;
}
export interface Feedback {
  id: string;
  recipientId: string;
  matchId?: string | null;
  sportId: string;
  reviewerId: string | null;
  guestName: string | null;
  overallComment: string | null;
  createdAt: string;
  status: "PUBLISHED" | "PENDING" | "HIDDEN" | "DELETED";
  ratings: Rating[] | null;
  analyticsAllowed: boolean;
  evidenceAllowed: boolean;
}
export interface SkillAverage {
  skillId: string;
  average: number;
  count: number;
}
export interface TrendPoint {
  skillId: string;
  period: string;
  average: number;
  count: number;
}
export interface Assessment {
  id: string;
  sportId: string;
  overallLevel: string;
  ratings: Rating[];
}
export interface AIAnswer {
  answer: string;
  citations: { feedbackId: string; excerpt: string }[];
}
export interface InsightsAdapter {
  ask(question: string, signal?: AbortSignal): Promise<AIAnswer>;
}

export interface MatchTeam {
  id: string;
  matchId: string;
  teamNumber: number;
  name: string | null;
  score: number | null;
}
export interface Member {
  id: string;
  username: string;
}
export interface MatchParticipant {
  user?: Member | null;
  id: string;
  matchId: string;
  userId: string | null;
  guestName: string | null;
  teamId: string | null;
}
export interface Match {
  id: string;
  createdById: string;
  sportId: string | null;
  playedAt: string | null;
  description: string | null;
  status: "DRAFT" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
  teams: MatchTeam[] | null;
  participants: MatchParticipant[] | null;
}

export interface PlayerProfile {
  id: string;
  username: string;
  isPublic: boolean;
}
