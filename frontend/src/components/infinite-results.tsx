"use client";
import { useEffect, useRef } from "react";
import { Pending } from "./common";
import { Button } from "./ui/button";
export function InfiniteResults({
  hasNextPage,
  isFetchingNextPage,
  error,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  error?: Error | null;
  onLoadMore: () => Promise<unknown>;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const target = sentinel.current;
    if (
      !target ||
      !hasNextPage ||
      isFetchingNextPage ||
      error ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || inFlight.current)
          return;
        inFlight.current = true;
        void onLoadMore()
          .catch(() => {})
          .finally(() => {
            inFlight.current = false;
          });
      },
      { rootMargin: "150px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, error, onLoadMore]);
  if (!hasNextPage && !error && !isFetchingNextPage) return null;
  return (
    <div ref={sentinel} className="mt-6 space-y-3 text-center">
      {error && (
        <p role="alert" className="error">
          Couldn’t load more results. {error.message}
        </p>
      )}
      {isFetchingNextPage ? (
        <p role="status" className="subtle text-sm">
          <Pending label="Loading more results…" />
        </p>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            void onLoadMore();
          }}
        >
          {error ? "Try loading more again" : "Load more results"}
        </Button>
      )}
    </div>
  );
}
