import { NextRequest, NextResponse } from "next/server";
const cookieName = "courtside_session";
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    // A reverse proxy may expose an internal host/protocol in nextUrl.
    // Trust an explicitly configured public URL rather than forwarded headers.
    const expectedOrigin = process.env.FRONTEND_URL
      ? new URL(process.env.FRONTEND_URL).origin
      : req.nextUrl.origin;
    if (origin && origin !== expectedOrigin)
      return NextResponse.json(
        { errors: [{ message: "Request origin rejected" }] },
        { status: 403 },
      );
    const body = await req.json();
    if (body.action === "logout") {
      const response = NextResponse.json({ data: { logout: true } });
      response.cookies.delete(cookieName);
      return response;
    }
    if (typeof body.query !== "string" || body.query.length > 30000)
      return NextResponse.json(
        { errors: [{ message: "Invalid request" }] },
        { status: 400 },
      );
    const token = req.cookies.get(cookieName)?.value;
    const upstream = await fetch(
      process.env.GRAPHQL_API_URL ?? "http://localhost:3000/graphql",
      {
        method: "POST",
        // Never resend a password-bearing body to a redirected destination.
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
        signal: AbortSignal.timeout(15000),
      },
    );
    const result = await upstream.json();
    const unauthorized = result.errors?.some(
      (e: { extensions?: { code?: string }; message: string }) =>
        e.extensions?.code === "UNAUTHENTICATED" ||
        e.message === "Unauthorized",
    );
    let sessionToken: string | undefined;
    for (const key of Object.keys(result.data ?? {})) {
      const auth = result.data?.[key];
      if (auth?.accessToken) {
        sessionToken = auth.accessToken;
        delete auth.accessToken;
      }
    }
    // Strip every authentication result before serializing, including aliases.
    const response = NextResponse.json(result, {
      status: unauthorized ? 401 : upstream.status,
      headers: { "Cache-Control": "no-store" },
    });
    if (sessionToken && !unauthorized) {
      let maxAge = 900;
      try {
        const payload = JSON.parse(
          Buffer.from(sessionToken.split(".")[1], "base64url").toString(),
        );
        maxAge = Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
      } catch {}
      response.cookies.set(cookieName, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge,
      });
    }
    if (unauthorized && token) response.cookies.delete(cookieName);
    return response;
  } catch {
    return NextResponse.json(
      {
        errors: [
          {
            message:
              "The API is unavailable. Check that the backend is running and try again.",
          },
        ],
      },
      { status: 502 },
    );
  }
}
