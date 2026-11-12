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
}: {
  recipientId: string;
  value: Member | null;
  onChange: (member: Member | null) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const id = useId();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useQuery({
    queryKey: ["reviewer-search", debounced, recipientId],
    enabled:
      !disabled &&
      !value &&
      debounced.length >= 2 &&
      debounced === search.trim(),
    queryFn: () =>
      gql<{ members: Member[] }>(
        `query Reviewers($search:String!){members(search:$search){id username}}`,
        { search: debounced },
      ),
  });
  return (
    <div className="space-y-2">
      <label className="field" htmlFor={id}>
        Assign feedback giver{" "}
        <span className="subtle font-normal">(optional)</span>
      </label>
      {value ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
          <span className="flex min-w-0 items-center gap-2">
            <UserAvatar name={value.username} />
            <span className="break-anywhere">{value.username}</span>
          </span>
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
        </div>
      ) : (
        <>
          <input
            id={id}
            value={search}
            disabled={disabled}
            autoComplete="off"
            placeholder="Search usernames"
            onChange={(event) => setSearch(event.target.value)}
            aria-describedby={`${id}-hint`}
            aria-controls={`${id}-results`}
          />
          {debounced.length >= 2 && debounced === search.trim() && (
            <div
              id={`${id}-results`}
              className="max-h-56 overflow-y-auto rounded-xl border border-border"
              role="group"
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
                  {results.data?.members
                    .filter((member) => member.id !== recipientId)
                    .map((member) => (
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center gap-3 p-3 text-left hover:bg-muted"
                        key={member.id}
                        onClick={() => onChange(member)}
                      >
                        <UserAvatar name={member.username} />
                        <span className="break-anywhere">
                          {member.username}
                        </span>
                      </button>
                    ))}
                  {!results.data?.members.some(
                    (member) => member.id !== recipientId,
                  ) && (
                    <p className="subtle p-3 text-sm">No matching reviewers.</p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
      <p className="subtle text-xs" id={`${id}-hint`}>
        {value
          ? `${value.username} must sign in and approve each submission before it is published or affects your ratings.`
          : "Leave unassigned for the usual feedback flow. Assigned feedback requires the selected player’s approval."}
      </p>
    </div>
  );
}
