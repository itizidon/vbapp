import { auth } from "@clerk/nextjs/server";
import type { User } from "./types";
export async function getCurrentUser(): Promise<User | null> {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  )
    return null;
  try {
    const token = await (await auth()).getToken();
    if (!token) return null;
    const response = await fetch(
      process.env.GRAPHQL_API_URL ?? "http://localhost:3000/graphql",
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query:
            "{me{id username email createdAt isPublic onboardingComplete}}",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    const result = await response.json();
    return response.ok && !result.errors ? (result.data?.me ?? null) : null;
  } catch {
    return null;
  }
}
