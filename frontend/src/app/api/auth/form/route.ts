// A native submission must never serialize credentials into the address bar.
// Authentication itself continues through the hydrated JSON GraphQL POST flow.
export function POST() {
  return new Response(
    "Signing in and creating an account require JavaScript. Enable it, return to the form, and try again.",
    {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
