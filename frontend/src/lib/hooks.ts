"use client";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { nextPageCursor, pageRows } from "./pagination";
import {
  EMPTY_DATE_RANGE,
  matchDateVariables,
  feedbackDateVariables,
  type MatchDateRange,
} from "./match-date-range";
import { MATCH_FIELDS } from "./matches";
import { gql, USER_FIELDS, CATALOG, FEEDBACK_FIELDS, ApiError } from "./api";
import type {
  User,
  Sport,
  Feedback,
  SkillAverage,
  Assessment,
  Match,
} from "./types";
export function useUser(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    enabled,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: () => gql<{ me: User }>(`query Me { me { ${USER_FIELDS} } }`),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 401) && count < 1,
  });
}
export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: () => gql<{ sports: Sport[] }>(CATALOG),
    select: (data) => ({
      ...data,
      sports: data.sports.filter((sport) => sport.slug === "beach-volleyball"),
    }),
    staleTime: 300000,
  });
}
export function useFeedback(
  enabled = true,
  kind = "all",
  range: MatchDateRange = EMPTY_DATE_RANGE,
) {
  const dates = feedbackDateVariables(range);
  const catalog = useCatalog();
  const sportIds = new Set(catalog.data?.sports.map((sport) => sport.id));
  return useInfiniteQuery({
    queryKey: ["feedback", kind, dates.createdFrom, dates.createdBefore],
    queryFn: ({ pageParam }) =>
      gql<{ receivedFeedback: Feedback[] }>(
        `query Received($cursor:String,$matchOnly:Boolean,$createdFrom:DateTime,$createdBefore:DateTime) { receivedFeedback(cursor:$cursor,matchOnly:$matchOnly,createdFrom:$createdFrom,createdBefore:$createdBefore) { ${FEEDBACK_FIELDS} } }`,
        {
          cursor: pageParam,
          matchOnly: kind === "all" ? null : kind === "match",
          ...dates,
        },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => nextPageCursor(last.receivedFeedback),
    enabled,
    select: (data) => ({
      ...data,
      rows: data.pages
        .flatMap((page) => pageRows(page.receivedFeedback))
        .filter((feedback) => sportIds.has(feedback.sportId)),
    }),
  });
}
export function useSummary(userId?: string) {
  const catalog = useCatalog();
  const sportIds = new Set(catalog.data?.sports.map((sport) => sport.id));
  const skillIds = new Set(
    catalog.data?.sports.flatMap((sport) =>
      sport.skills.map((skill) => skill.id),
    ),
  );
  return useQuery({
    queryKey: ["summary", userId],
    queryFn: () =>
      gql<{
        userSkillRatings: SkillAverage[];
        userSportFeedbackSummary: { sportId: string; feedbackCount: number }[];
        mySelfAssessments: Assessment[];
      }>(
        `query Summary($userId:ID!){ userSkillRatings(userId:$userId){skillId average count} userSportFeedbackSummary {sportId feedbackCount} mySelfAssessments {id sportId overallLevel ratings {skillId rating}} }`,
        { userId },
      ),
    select: (data) => ({
      userSkillRatings: data.userSkillRatings.filter((rating) =>
        skillIds.has(rating.skillId),
      ),
      feedbackCount: {
        count: data.userSportFeedbackSummary
          .filter((summary) => sportIds.has(summary.sportId))
          .reduce((total, summary) => total + summary.feedbackCount, 0),
      },
      mySelfAssessments: data.mySelfAssessments.filter((assessment) =>
        sportIds.has(assessment.sportId),
      ),
    }),
    enabled: !!userId,
  });
}

export function useMatches(
  enabled = true,
  range: MatchDateRange = EMPTY_DATE_RANGE,
) {
  const dates = matchDateVariables(range);
  const catalog = useCatalog();
  const ids = new Set(catalog.data?.sports.map((s) => s.id));
  return useInfiniteQuery({
    queryKey: ["matches", dates.playedFrom, dates.playedBefore],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      gql<{ userMatches: Match[] }>(
        `query Matches($cursor:String,$playedFrom:DateTime,$playedBefore:DateTime){userMatches(cursor:$cursor,playedFrom:$playedFrom,playedBefore:$playedBefore){${MATCH_FIELDS}}}`,
        { cursor: pageParam, ...dates },
      ),
    getNextPageParam: (page) => nextPageCursor(page.userMatches),
    enabled,
    select: (data) => ({
      ...data,
      rows: data.pages
        .flatMap((p) => pageRows(p.userMatches))
        .filter((m) => !m.sportId || ids.has(m.sportId)),
    }),
  });
}
export function useMatch(id?: string, enabled = true) {
  return useQuery({
    queryKey: ["match", id],
    queryFn: () =>
      gql<{ match: Match | null }>(
        `query Match($id:ID!){match(id:$id){${MATCH_FIELDS}}}`,
        { id },
      ),
    enabled: !!id && enabled,
  });
}
export function useFeedbackDetails(id: string) {
  return useQuery({
    queryKey: ["feedback-details", id],
    queryFn: () =>
      gql<{ feedback: Feedback }>(
        `query FeedbackDetail($id:ID!){feedback(id:$id){${FEEDBACK_FIELDS}}}`,
        { id },
      ),
  });
}
export function useSubmittedFeedback(enabled = true) {
  const catalog = useCatalog();
  const ids = new Set(catalog.data?.sports.map((s) => s.id));
  return useInfiniteQuery({
    queryKey: ["submitted-feedback"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      gql<{ submittedFeedback: Feedback[] }>(
        `query Submitted($cursor:String){submittedFeedback(cursor:$cursor){${FEEDBACK_FIELDS}}}`,
        { cursor: pageParam },
      ),
    getNextPageParam: (page) => nextPageCursor(page.submittedFeedback),
    enabled,
    select: (data) => ({
      ...data,
      rows: data.pages
        .flatMap((p) => pageRows(p.submittedFeedback))
        .filter((f) => ids.has(f.sportId)),
    }),
  });
}
