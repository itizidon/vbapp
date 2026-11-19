"use client";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import { gql } from "./api";
export type ApprovalStatus = "PENDING" | "PUBLISHED" | "REJECTED";
export interface ApprovalMatch {
  id: string;
  playedAt: string | null;
  description: string | null;
}
export interface ApprovalPreview {
  id: string;
  recipientUsername: string;
  createdAt: string;
  status: ApprovalStatus;
  ratedSkillCount: number;
  matchCount: number;
  match: ApprovalMatch | null;
}
export interface ApprovalCard {
  id: string;
  recipientUsername: string;
  createdAt: string;
  status: ApprovalStatus;
  overallComment: string | null;
  guestName: string | null;
  match: ApprovalMatch | null;
  matches?: ApprovalMatch[];
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  pendingAiAllowed?: boolean;
  privateAnalyticsAllowed?: boolean;
  privateCoachingAllowed?: boolean;
  publicAnalyticsAllowed?: boolean;
  ratings: {
    skillId: string;
    skillName: string;
    rating: number;
    comment: string | null;
  }[];
}
export interface ApprovalQueue {
  totalCount: number;
  items: ApprovalCard[];
  nextCursor: string | null;
}
export const APPROVAL_FIELDS = `id recipientUsername status createdAt overallComment guestName approvedAt rejectedAt rejectionReason pendingAiAllowed privateAnalyticsAllowed privateCoachingAllowed publicAnalyticsAllowed match{id description playedAt} matches{id description playedAt} ratings{skillId skillName rating comment}`;
export const approvalKeys = {
  all: ["approvals"] as const,
  count: (user: string | undefined) => ["approvals", user, "count"] as const,
  preview: (user: string | undefined) =>
    ["approvals", user, "preview"] as const,
  list: (user: string | undefined, status: ApprovalStatus) =>
    ["approvals", user, "list", status] as const,
};
export function usePendingApprovalCount(userId?: string) {
  return useQuery({
    queryKey: approvalKeys.count(userId),
    enabled: !!userId,
    queryFn: () =>
      gql<{ myPendingApprovalCount: number }>(
        `query PendingApprovalCount{myPendingApprovalCount}`,
      ),
    refetchOnWindowFocus: "always",
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    staleTime: 10000,
  });
}
export function useApprovalPreviews(userId: string | undefined, open: boolean) {
  return useQuery({
    queryKey: approvalKeys.preview(userId),
    enabled: !!userId && open,
    queryFn: () =>
      gql<{ myRecentPendingApprovals: ApprovalPreview[] }>(
        `query RecentPendingApprovals{myRecentPendingApprovals{id recipientUsername createdAt status ratedSkillCount matchCount match{id playedAt description}}}`,
      ),
    refetchOnWindowFocus: "always",
    staleTime: 0,
  });
}
export function useApprovals(
  userId: string | undefined,
  status: ApprovalStatus,
) {
  return useInfiniteQuery({
    queryKey: approvalKeys.list(userId, status),
    enabled: !!userId,
    queryFn: ({ pageParam }) =>
      gql<{ myFeedbackApprovals: ApprovalQueue }>(
        `query FeedbackApprovals($status:FeedbackStatus!,$cursor:ID){myFeedbackApprovals(status:$status,cursor:$cursor){totalCount nextCursor items{${APPROVAL_FIELDS}}}}`,
        { status, cursor: pageParam },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) =>
      page.myFeedbackApprovals.nextCursor ?? undefined,
    refetchOnWindowFocus: "always",
  });
}
export function useApprovalDecision(
  userId?: string,
  onNotice?: (message: string) => void,
) {
  const client = useQueryClient();
  const lock = useRef(false);
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["approvals", userId] });
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({
      id,
      approve,
      reason,
    }: {
      id: string;
      approve: boolean;
      reason?: string;
    }) => {
      const result = await gql<{
        approveFeedback?: { id: string; status: string };
        rejectFeedback?: { id: string; status: string };
      }>(
        approve
          ? `mutation Approve($id:ID!){approveFeedback(feedbackId:$id){id status}}`
          : `mutation Reject($id:ID!,$reason:String){rejectFeedback(feedbackId:$id,reason:$reason){id status}}`,
        { id, ...(!approve ? { reason: reason?.trim() || null } : {}) },
      );
      const row = approve ? result.approveFeedback : result.rejectFeedback;
      if (
        !row ||
        row.id !== id ||
        row.status !== (approve ? "PUBLISHED" : "REJECTED")
      )
        throw new Error(
          "Could not confirm the approval status. Refresh and try again.",
        );
      return row;
    },
    onSuccess: (row) => {
      onNotice?.(
        row.status === "PUBLISHED"
          ? "Feedback approved."
          : "Feedback rejected.",
      );
      void refresh();
      for (const prefix of [
        "pending-feedback-approvals",
        "feedback",
        "submitted-feedback",
        "feedback-details",
        "summary",
        "internal-ratings",
        "skill-radar",
        "performance-summary",
        "dashboard",
        "coach-profile",
        "coach-messages",
        "coach-conversations",
      ])
        void client.invalidateQueries({ queryKey: [prefix] });
    },
    onError: (error) => {
      if (/already|not pending|processed|page changed/i.test(error.message))
        onNotice?.(
          "This feedback has already been approved or rejected. Your approvals have been refreshed.",
        );
      void refresh();
    },
    onSettled: () => {
      lock.current = false;
    },
  });
  return {
    ...mutation,
    decide: (action: { id: string; approve: boolean; reason?: string }) => {
      if (lock.current) return;
      lock.current = true;
      mutation.mutate(action);
    },
  };
}
export function approvalMatches(row: Pick<ApprovalCard, "match" | "matches">) {
  return [
    ...new Map(
      (row.matches?.length ? row.matches : row.match ? [row.match] : []).map(
        (m) => [m.id, m],
      ),
    ).values(),
  ];
}
export function approvalDate(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Date not recorded";
}
export function approvalSkill(name: string) {
  return /^(attack|attacking|spiking|spikes)$/i.test(name)
    ? "Attacking"
    : name.charAt(0).toUpperCase() + name.slice(1);
}
