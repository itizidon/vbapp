import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, MessageSquare, ArrowRight, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/server-session";
import { Brand, ThemeToggle } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
export default async function Home() {
  if (await getCurrentUser()) redirect("/matches");
  return (
    <>
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6">
        <Brand />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-20">
        <section className="max-w-2xl">
          <p className="eyebrow mb-5 text-primary">
            Beach Volleyball · Better together
          </p>
          <h1 className="text-[clamp(40px,6vw,68px)] leading-[1.08] tracking-tight">
            Good games.
            <br />
            Honest feedback.
          </h1>
          <p className="subtle mt-6 max-w-lg text-base leading-8">
            Keep your matches together. Ask the people you play with for their
            perspective, and give them yours.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/players">Search players</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">
                Join bvbtips
                <ArrowRight size={17} />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/login">Go to your matches</Link>
            </Button>
          </div>
        </section>
        <section className="mt-16 grid gap-5 md:grid-cols-3">
          {[
            {
              Icon: CalendarDays,
              title: "Your matches",
              text: "Dates, players, teams, and scores. A simple home for the games you’re part of.",
            },
            {
              Icon: MessageSquare,
              title: "Your feedback",
              text: "Request a perspective on a match, or ask for general feedback about your game.",
            },
            {
              Icon: Users,
              title: "Easy to share",
              text: "Send a personal link. Your teammates can leave ratings and a few words without signing up.",
            },
          ].map(({ Icon, title, text }) => (
            <div key={title} className="panel">
              <Icon className="mb-5 text-primary" size={25} />
              <h2>{title}</h2>
              <p className="subtle mt-3 text-sm leading-7">{text}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="mx-auto max-w-6xl border-t border-border px-4 py-6 text-xs text-muted-foreground sm:px-6">
        © {new Date().getFullYear()} bvbtips. See you on the sand.
      </footer>
    </>
  );
}
