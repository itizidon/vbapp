import { cookies } from "next/headers";
import type { User } from "./types";
export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get("courtside_session")?.value;
  if (!token) return null;
  try {
    const response = await fetch(
      process.env.GRAPHQL_API_URL ?? "http://localhost:3000/graphql",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: "query CurrentUser {me{id username email createdAt}}",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    const result = await response.json();
    return response.ok && !result.errors ? (result.data?.me ?? null) : null;
  } catch {
    return null;
  }
}
