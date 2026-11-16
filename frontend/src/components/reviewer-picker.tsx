"use client";
import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gql } from "@/lib/api";
import type { Member } from "@/lib/types";
import { UserAvatar, ErrorState } from "./common";
import { Button } from "./ui/button";
export function ReviewerPicker({
  recipientId,
  value,
  onChange,
  disabled = false,
  forFeedback = false,
  token,
  label = "Assign feedback giver",
  placeholder = "Search usernames",
  showHint = true,
  locked = false,
}: {
  recipientId: string;
  value: Member | null;
  onChange: (member: Member | null) => void;
  disabled?: boolean;
  forFeedback?: boolean;
  token?: string;
  label?: string;
  placeholder?: string;
  showHint?: boolean;
  locked?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const id = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useQuery({
    queryKey: ["reviewer-search", debounced, recipientId, forFeedback, token],
    enabled:
      !disabled &&
      !locked &&
      !value &&
      debounced.length >= 2 &&
      debounced === search.trim(),
    queryFn: async () => {
      if (forFeedback) {
        const result = await gql<{ feedbackReviewers: Member[] }>(
          `query FeedbackReviewers($search:String!,$token:String,$recipientId:ID){feedbackReviewers(search:$search,token:$token,recipientId:$recipientId){id username}}`,
          { search: debounced, token: token ?? null, recipientId },
        );
        return { members: result.feedbackReviewers };
      }
      return gql<{ members: Member[] }>(
        `query Reviewers($search:String!){members(search:$search){id username}}`,
        { search: debounced },
      );
    },
  });
  const members =
    results.data?.members.filter((member) => member.id !== recipientId) ?? [];
  const open =
    !closed &&
    !value &&
    !locked &&
    debounced.length >= 2 &&
    debounced === search.trim();
  function choose(member: Member) {
    onChange(member);
    setSearch("");
    setClosed(true);
    setActiveIndex(-1);
  }
  return (
    <div className="space-y-2">
      <p className="field" id={`${id}-label`}>
        {label}
        {showHint && <span className="subtle font-normal"> (optional)</span>}
      </p>
      {value ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
          <span className="flex min-w-0 items-center gap-2">
            <UserAvatar name={value.username} />
            <span className="break-anywhere">
              {forFeedback ? "@" : ""}
              {value.username}
            </span>
          </span>
          {!locked && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                onChange(null);
                setSearch("");
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ) : (
        <>
          <input
            id={id}
            value={search}
            disabled={disabled}
            autoComplete="off"
            placeholder={placeholder}
            maxLength={40}
            role={forFeedback ? "combobox" : undefined}
            aria-autocomplete={forFeedback ? "list" : undefined}
            aria-expanded={forFeedback ? open : undefined}
            aria-labelledby={`${id}-label`}
            onChange={(event) => {
              setSearch(event.target.value);
              setClosed(false);
              setActiveIndex(-1);
            }}
            onFocus={() => setClosed(false)}
            onBlur={(event) => {
              if (
                !event.currentTarget.parentElement?.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setClosed(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setClosed(true);
                setActiveIndex(-1);
              }
              if (
                open &&
                members.length &&
                ["ArrowDown", "ArrowUp"].includes(event.key)
              ) {
                event.preventDefault();
                setActiveIndex(
                  (previous) =>
                    (previous +
                      (event.key === "ArrowDown" ? 1 : previous < 0 ? 0 : -1) +
                      members.length) %
                    members.length,
                );
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (open && activeIndex >= 0 && members[activeIndex])
                  choose(members[activeIndex]);
              }
            }}
            aria-activedescendant={
              forFeedback && open && members[activeIndex]
                ? `${id}-option-${activeIndex}`
                : undefined
            }
            aria-describedby={showHint ? `${id}-hint` : undefined}
            aria-controls={open ? `${id}-results` : undefined}
          />
          {open && (
            <div
              id={`${id}-results`}
              className="max-h-56 overflow-y-auto rounded-xl border border-border"
              role={forFeedback ? "listbox" : "group"}
              aria-label="Matching reviewers"
            >
              {results.isFetching ? (
                <p className="subtle p-3 text-sm" role="status">
                  Searching…
                </p>
              ) : results.error ? (
                <ErrorState
                  error={results.error}
                  retry={() => results.refetch()}
                />
              ) : (
                <>
                  {members.map((member, index) => (
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center gap-3 p-3 text-left hover:bg-muted"
                      key={member.id}
                      id={`${id}-option-${index}`}
                      role={forFeedback ? "option" : undefined}
                      aria-selected={
                        forFeedback ? activeIndex === index : undefined
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(member)}
                    >
                      <UserAvatar name={member.username} />
                      <span className="break-anywhere">{member.username}</span>
                    </button>
                  ))}
                  {!members.length && (
                    <p className="subtle p-3 text-sm">No matching reviewers.</p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
      {showHint && (
        <p className="subtle text-xs" id={`${id}-hint`}>
          {value
            ? `${value.username} must sign in and approve this feedback before it is published or affects the player’s ratings.`
            : forFeedback
              ? "Choose the player responsible for this feedback. It will wait in their Account approvals. Leave blank to submit normally."
              : "Leave unassigned for the usual feedback flow. Assigned feedback requires the selected player’s approval."}
        </p>
      )}
    </div>
  );
}
