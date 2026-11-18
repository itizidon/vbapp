export function safeReturnTo(value: unknown, fallback = "/matches") {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/.test(value)
  )
    return fallback;
  return value;
}
export function authHref(route: "/login" | "/signup", returnTo: string) {
  return `${route}?${new URLSearchParams({ next: safeReturnTo(returnTo) })}`;
}

// Return context is limited to existing app pages, never auth or review routes.
export function feedbackReturnDestination(
  value: unknown,
  authenticated: boolean,
) {
  const fallback = authenticated ? "/matches" : "/";
  const safe = safeReturnTo(value, "");
  if (!safe || /[\u0000-\u0020\u007f]/.test(safe)) return fallback;
  const url = new URL(safe, "https://bvbtips.invalid");
  if (url.origin !== "https://bvbtips.invalid") return fallback;
  const publicPage = /^\/(?:players(?:\/[^/]+)?\/?)?$/.test(url.pathname);
  const privatePage =
    /^\/(?:matches|feedback)(?:\/[^/]+)?\/?$/.test(url.pathname) ||
    /^\/(?:account|analytics|approvals)\/?$/.test(url.pathname);
  return publicPage || (authenticated && privatePage)
    ? `${url.pathname}${url.search}${url.hash}`
    : fallback;
}
