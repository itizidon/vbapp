"use client";
import { useAuth } from "@clerk/nextjs";
import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { watchAuthChanges } from "@/lib/auth-session";
import { ThemeProvider } from "next-themes";
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60000, retry: 1, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );
  useEffect(
    () =>
      watchAuthChanges(() => {
        void client.resetQueries({
          predicate: (query) => query.queryKey[0] !== "catalog",
        });
      }),
    [client],
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

/** Remount the query cache on Clerk account changes, including sign-out in another tab. */
export function ClerkProviders({ children }: { children: React.ReactNode }) {
  const { isLoaded, userId } = useAuth();
  if (!isLoaded)
    return (
      <p role="status" className="p-6 text-center">
        Loading your session…
      </p>
    );
  return <Providers key={userId ?? "anonymous"}>{children}</Providers>;
}
