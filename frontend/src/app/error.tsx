"use client";
import { ErrorState } from "@/components/common";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl px-5 py-16">
      <ErrorState error={error} retry={reset} />
    </main>
  );
}
