export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("/api/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (!response.ok || result.errors?.length) {
    const error = result.errors?.[0];
    const detail = error?.extensions?.originalError?.message;
    throw new ApiError(
      Array.isArray(detail)
        ? detail.join(". ")
        : typeof detail === "string"
          ? detail
          : (error?.message ?? "Unable to connect. Please try again."),
      response.status,
    );
  }
  return result.data as T;
}
export const USER_FIELDS = "id username email createdAt isPublic";
export const FEEDBACK_FIELDS =
  "id recipientId matchId sportId reviewerId guestName overallComment createdAt status analyticsAllowed evidenceAllowed ratings { skillId rating comment }";
export const CATALOG = `query Catalog { sports { id name slug skills { id name slug sportId active requiredForSelfAssessment description } } }`;
