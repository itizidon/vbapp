"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bell, CalendarDays } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/hooks";
import {
  approvalDate,
  approvalKeys,
  useApprovalPreviews,
  usePendingApprovalCount,
} from "@/lib/approvals";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Pending } from "./common";
export function NotificationBell() {
  const user = useUser(),
    client = useQueryClient(),
    userId = user.data?.me.id,
    count = usePendingApprovalCount(userId);
  const [open, setOpen] = useState(false),
    previews = useApprovalPreviews(userId, open),
    trigger = useRef<HTMLButtonElement>(null),
    [anchor, setAnchor] = useState({ top: 88, right: 16 });
  useEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect)
        setAnchor({
          top: Math.max(8, rect.bottom + 8),
          right: Math.max(12, window.innerWidth - rect.right),
        });
    };
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);
  if (!userId) return null;
  const total = count.data?.myPendingApprovalCount;
  const change = (next: boolean) => {
    if (next) {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect)
        setAnchor({
          top: Math.max(8, rect.bottom + 8),
          right: Math.max(12, window.innerWidth - rect.right),
        });
    }
    setOpen(next);
    if (next) {
      void count.refetch();
      void client.invalidateQueries({ queryKey: approvalKeys.preview(userId) });
    }
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          className="notification-bell"
          aria-label={`Notifications${total ? `, ${total} pending feedback approvals` : ""}`}
        >
          <Bell size={20} />
          {!!total && (
            <span aria-hidden="true" className="notification-badge">
              {total > 99 ? "99+" : total}
            </span>
          )}
          {count.error && (
            <span
              className="notification-error-dot"
              aria-label="Approval count unavailable"
            />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="notification-panel"
        placement="custom"
        overlayClassName="notification-overlay"
        closeLabel="Close notifications"
        style={
          {
            "--notification-top": `${anchor.top}px`,
            "--notification-right": `${anchor.right}px`,
          } as CSSProperties
        }
      >
        <div className="notification-sheet-handle" aria-hidden="true" />
        <DialogTitle className="notification-title">Notifications</DialogTitle>
        <DialogDescription className="notification-description">
          {typeof total === "number"
            ? `${total} feedback ${total === 1 ? "approval" : "approvals"} pending`
            : "Feedback assigned to you for approval"}
        </DialogDescription>
        <div className="notification-items">
          {previews.isPending ? (
            <Pending label="Loading notifications…" />
          ) : previews.error ? (
            <div role="alert">
              <p>Couldn’t load approvals.</p>
              <Button
                variant="outline"
                onClick={() => {
                  void previews.refetch();
                  void count.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : !previews.data?.myRecentPendingApprovals.length ? (
            <div className="notification-empty">
              <h3>You’re all caught up!</h3>
              <p>No feedback is waiting for your approval.</p>
            </div>
          ) : (
            previews.data.myRecentPendingApprovals.slice(0, 3).map((item) => (
              <article className="approval-preview" key={item.id}>
                <p className="approval-eyebrow">Feedback approval · Pending</p>
                <h3>For @{item.recipientUsername}</h3>
                <p>
                  <CalendarDays size={14} />
                  {item.matchCount > 1
                    ? `Combined feedback · ${item.matchCount} matches`
                    : item.matchCount
                      ? "Match feedback"
                      : "General feedback"}
                </p>
                {item.match && (
                  <p className="approval-subtle">
                    {item.matchCount > 1 ? "Latest match" : "Match"}:{" "}
                    {approvalDate(item.match.playedAt)}
                  </p>
                )}
                <p>
                  {item.ratedSkillCount}{" "}
                  {item.ratedSkillCount === 1 ? "skill" : "skills"} rated
                </p>
                <p className="approval-subtle">
                  Submitted {approvalDate(item.createdAt)}
                </p>
                <Link
                  className="approval-review-link"
                  href={`/approvals?feedback=${encodeURIComponent(item.id)}#approval-${encodeURIComponent(item.id)}`}
                  onClick={() => setOpen(false)}
                >
                  Review details
                  <span className="sr-only">
                    {" "}
                    for @{item.recipientUsername}
                  </span>
                </Link>
              </article>
            ))
          )}
        </div>
        {count.error && (
          <p role="status" className="approval-subtle">
            The pending count could not be refreshed.
          </p>
        )}
        <Button asChild className="notification-view-all">
          <Link href="/approvals" onClick={() => setOpen(false)}>
            View all approvals
          </Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
