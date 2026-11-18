"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/lib/hooks";
import { useApprovals, type ApprovalStatus } from "@/lib/approvals";
import { FeedbackApprovalCard } from "./feedback-approval-card";
import { BeachCourtBackground } from "./beach-court-background";
import { Button } from "./ui/button";
import { Pending } from "./common";
export function ApprovalsPage() {
  const user = useUser(),
    [status, setStatus] = useState<ApprovalStatus>("PENDING"),
    selected = useSearchParams().get("feedback");
  const [notice, setNotice] = useState("");
  const query = useApprovals(user.data?.me.id, status);
  const rows = [
      ...new Map(
        (query.data?.pages ?? [])
          .flatMap((p) => p.myFeedbackApprovals.items)
          .map((r) => [r.id, r]),
      ).values(),
    ],
    count = query.data?.pages[0]?.myFeedbackApprovals.totalCount;
  return (
    <section className="approvals-page" aria-label="Feedback approvals">
      <BeachCourtBackground />
      <div className="approvals-page__content">
        <header className="approvals-heading">
          <p className="approval-eyebrow">BEACH VOLLEYBALL · YOUR REVIEWS</p>
          <h1>Feedback approvals</h1>
          <p>
            Confirm the feedback assigned to you. One decision per review,
            including combined matches.
          </p>
        </header>
        <div
          className="approval-tabs"
          role="tablist"
          aria-label="Approval status"
        >
          {(
            [
              ["PENDING", "Pending"],
              ["PUBLISHED", "Approved"],
              ["REJECTED", "Rejected"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`approval-tab-${value}`}
              aria-controls="approval-panel"
              aria-selected={status === value}
              tabIndex={status === value ? 0 : -1}
              onKeyDown={(event) => {
                const values: ApprovalStatus[] = [
                  "PENDING",
                  "PUBLISHED",
                  "REJECTED",
                ];
                const current = values.indexOf(value);
                const next =
                  event.key === "ArrowRight"
                    ? values[(current + 1) % 3]
                    : event.key === "ArrowLeft"
                      ? values[(current + 2) % 3]
                      : event.key === "Home"
                        ? values[0]
                        : event.key === "End"
                          ? values[2]
                          : null;
                if (next) {
                  event.preventDefault();
                  setStatus(next);
                  document.getElementById(`approval-tab-${next}`)?.focus();
                }
              }}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {notice && (
          <p role="status" className="approval-subtle">
            {notice}
          </p>
        )}
        <div
          id="approval-panel"
          role="tabpanel"
          aria-labelledby={`approval-tab-${status}`}
          className="approval-panel"
          aria-busy={query.isPending}
        >
          {typeof count === "number" && (
            <p className="approval-subtle" role="status">
              {count}{" "}
              {status === "PENDING"
                ? "pending"
                : status === "PUBLISHED"
                  ? "approved"
                  : "rejected"}{" "}
              {count === 1 ? "review" : "reviews"} · Newest first
            </p>
          )}
          {query.isPending ? (
            <Pending label="Loading approvals…" />
          ) : query.error && !query.data ? (
            <div className="approval-empty" role="alert">
              <h2>Couldn’t load approvals.</h2>
              <p>{query.error.message}</p>
              <Button variant="outline" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          ) : null}
          {query.data && !rows.length && !query.isPending && (
            <div className="approval-empty">
              <h2>
                {status === "PENDING"
                  ? "You’re all caught up!"
                  : `No ${status === "PUBLISHED" ? "approved" : "rejected"} feedback yet`}
              </h2>
              <p>
                {status === "PENDING"
                  ? "No feedback is waiting for your approval."
                  : "Your completed decisions will appear here."}
              </p>
            </div>
          )}
          {selected &&
            status === "PENDING" &&
            query.data &&
            !query.hasNextPage &&
            !rows.some((r) => r.id === selected) && (
              <p className="approval-subtle">
                That item may already have been handled. Check Approved or
                Rejected for your completed decisions.
              </p>
            )}
          <div className="approval-card-list">
            {rows.map((row) => (
              <FeedbackApprovalCard
                key={`${row.id}:${row.id === selected ? "requested" : "normal"}`}
                feedback={row}
                initialOpen={row.id === selected}
                onNotice={setNotice}
              />
            ))}
          </div>
          {query.error && query.data && (
            <div role="alert">
              <p>Couldn’t refresh approvals. {query.error.message}</p>
              <Button
                variant="outline"
                onClick={() =>
                  query.isFetchNextPageError
                    ? void query.fetchNextPage()
                    : void query.refetch()
                }
              >
                Retry
              </Button>
            </div>
          )}
          {query.hasNextPage && (
            <Button
              className="approval-load-more"
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? (
                <Pending label="Loading more approvals…" />
              ) : (
                "Load more approvals"
              )}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
