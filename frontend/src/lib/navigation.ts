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
