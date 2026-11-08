import { NextRequest, NextResponse } from "next/server";
const cookieName = "courtside_session";
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin)
    return NextResponse.json(
      { errors: [{ message: "Request origin rejected" }] },
      { status: 403 },
    );
  try {
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
    const response = NextResponse.json(result, {
      status: unauthorized ? 401 : upstream.status,
      headers: { "Cache-Control": "no-store" },
    });
    for (const key of Object.keys(result.data ?? {})) {
      const auth = result.data?.[key];
      if (auth?.accessToken) {
        const jwt = auth.accessToken;
        delete auth.accessToken;
        let maxAge = 900;
        try {
          const payload = JSON.parse(
            Buffer.from(jwt.split(".")[1], "base64url").toString(),
          );
          maxAge = Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
        } catch {}
        const secured = NextResponse.json(result, {
          headers: { "Cache-Control": "no-store" },
        });
        secured.cookies.set(cookieName, jwt, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge,
        });
        return secured;
      }
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
