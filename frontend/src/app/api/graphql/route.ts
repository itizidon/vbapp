import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
export async function POST(req: NextRequest) {
  try {
    const expected = process.env.FRONTEND_URL
      ? new URL(process.env.FRONTEND_URL).origin
      : req.nextUrl.origin;
    if (req.headers.get("origin") && req.headers.get("origin") !== expected)
      return NextResponse.json(
        { errors: [{ message: "Request origin rejected" }] },
        { status: 403 },
      );
    const body = await req.json();
    if (typeof body.query !== "string" || body.query.length > 30000)
      return NextResponse.json(
        { errors: [{ message: "Invalid request" }] },
        { status: 400 },
      );
    const token =
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      process.env.CLERK_SECRET_KEY
        ? await (await auth()).getToken()
        : null;
    const upstream = await fetch(
      process.env.GRAPHQL_API_URL ?? "http://localhost:3000/graphql",
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: body.query,
          variables: body.variables ?? {},
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(
          /\baskAiCoach\b/.test(body.query) ? 75000 : 20000,
        ),
      },
    );
    const result = await upstream.json(),
      unauthorized = result.errors?.some(
        (e: { extensions?: { code?: string } }) =>
          e.extensions?.code === "UNAUTHENTICATED",
      );
    return NextResponse.json(result, {
      status: unauthorized ? 401 : upstream.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { errors: [{ message: "The API is unavailable. Please try again." }] },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
