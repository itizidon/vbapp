"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  Activity,
  CalendarDays,
  MessageSquare,
  UserRound,
  Moon,
  Sun,
  LogOut,
} from "lucide-react";
import { useUser } from "@/lib/hooks";
import { notifyAuthChanged } from "@/lib/auth-session";
import { ApiError } from "@/lib/api";
import { Button } from "./ui/button";
import { ErrorState, LoadingSkeleton } from "./common";
const tabs = [
  { href: "/matches", label: "Matches", Icon: CalendarDays },
  { href: "/feedback", label: "Feedback", Icon: MessageSquare },
  { href: "/account", label: "Account", Icon: UserRound },
];
export function Brand() {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center gap-2 text-lg font-bold tracking-tight"
    >
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-white">
        <Activity size={23} />
      </span>
      courtside<span className="-ml-2 text-primary">.</span>
    </Link>
  );
}
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      className="size-11 shrink-0 px-0"
      aria-label="Toggle color theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun size={18} className="hidden dark:block" />
      <Moon size={18} className="dark:hidden" />
    </Button>
  );
}
function Navigation({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();
  return (
    <nav
      aria-label={mobile ? "Mobile navigation" : "Main navigation"}
      className={
        mobile
          ? "fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] sm:hidden"
          : "hidden items-center gap-2 sm:flex"
      }
    >
      {tabs.map(({ href, label, Icon }) => {
        const active = path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              mobile
                ? `flex min-h-16 flex-col items-center justify-center gap-1 text-xs ${active ? "text-primary" : "text-muted-foreground"}`
                : `flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${active ? "bg-accent text-primary" : "text-muted-foreground hover:bg-muted"}`
            }
          >
            <Icon size={19} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
export function BottomNavigation() {
  return <Navigation mobile />;
}
export function DesktopNavigation() {
  return <Navigation />;
}
export function AccountMenu() {
  const router = useRouter();
  const client = useQueryClient();
  const { setTheme } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!response.ok) throw new Error("Unable to sign out. Try again.");
      client.clear();
      notifyAuthChanged();
      router.replace("/login");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="panel space-y-5">
      <h2>Settings</h2>
      <div>
        <p className="mb-3 text-sm">Appearance</p>
        <div className="flex flex-wrap gap-2">
          {["light", "dark", "system"].map((theme) => (
            <Button
              key={theme}
              variant="outline"
              onClick={() => setTheme(theme)}
            >
              {theme[0].toUpperCase() + theme.slice(1)}
            </Button>
          ))}
        </div>
      </div>
      <Button variant="outline" onClick={logout} disabled={busy}>
        <LogOut size={17} />
        {busy ? "Signing out…" : "Sign out"}
      </Button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useUser();
  const router = useRouter();
  const path = usePathname();
  const unauthenticated =
    user.error instanceof ApiError && user.error.status === 401;
  useEffect(() => {
    if (unauthenticated)
      router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [unauthenticated, path, router]);
  return (
    <>
      <a href="#main-content" className="skip">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-20 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Brand />
          <DesktopNavigation />
          <ThemeToggle />
        </div>
      </header>
      <main
        id="main-content"
        className="mx-auto max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-7 sm:px-6 sm:pb-12 sm:pt-10"
      >
        {user.isPending || unauthenticated ? (
          <LoadingSkeleton />
        ) : user.error ? (
          <ErrorState error={user.error} retry={() => user.refetch()} />
        ) : (
          children
        )}
      </main>
      <BottomNavigation />
    </>
  );
}
