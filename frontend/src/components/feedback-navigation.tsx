"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useUser } from "@/lib/hooks";
import { feedbackReturnDestination } from "@/lib/navigation";
import { Brand, ThemeToggle } from "./app-shell";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

export function FeedbackNavigation({
  dirty,
  publicHeader,
  children,
}: {
  dirty: boolean;
  publicHeader: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const user = useUser();
  const params = useSearchParams();
  const authenticated = !!user.data && !user.error;
  const home = authenticated ? "/matches" : "/";
  const back = feedbackReturnDestination(params.get("returnTo"), authenticated);
  const [destination, setDestination] = useState<string | null>(null);
  const leaving = useRef(false);
  const exitTrigger = useRef<HTMLElement | null>(null);
  function leave(href: string) {
    leaving.current = true;
    setDestination(null);
    router.push(href);
  }
  // Capture links across the form and surrounding app shell. New-tab actions
  // retain this draft, and category/match buttons are not navigation links.
  useEffect(() => {
    leaving.current = false;
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (leaving.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function linkClick(event: MouseEvent) {
      if (
        leaving.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      const url = new URL(anchor.href, window.location.href);
      if (!["http:", "https:"].includes(url.protocol)) return;
      // In-page anchors do not discard the form.
      if (
        url.origin === location.origin &&
        url.pathname === location.pathname &&
        url.search === location.search
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      exitTrigger.current = anchor;
      setDestination(
        url.origin === location.origin
          ? `${url.pathname}${url.search}${url.hash}`
          : url.href,
      );
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", linkClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", linkClick, true);
    };
  }, [dirty]);
  return (
    <>
      <header
        className={
          publicHeader
            ? "mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4"
            : "mb-5 flex items-center justify-between gap-3"
        }
      >
        <nav
          className="flex min-w-0 items-center gap-2 sm:gap-4"
          aria-label="Feedback navigation"
        >
          <Link
            href={back}
            aria-label="Back from feedback"
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          >
            <ArrowLeft size={19} aria-hidden="true" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          {publicHeader && <Brand href={home} />}
        </nav>
        {publicHeader && <ThemeToggle />}
      </header>
      {children}
      <Dialog
        open={destination !== null}
        onOpenChange={(open) => {
          if (!open) setDestination(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!leaving.current) exitTrigger.current?.focus();
          }}
        >
          <DialogTitle className="pr-10 text-xl font-semibold">
            Leave feedback?
          </DialogTitle>
          <DialogDescription className="subtle mt-3">
            You have feedback that hasn’t been submitted. Leaving now may
            discard your answers.
          </DialogDescription>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDestination(null)}
            >
              Keep reviewing
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (destination) leave(destination);
              }}
            >
              Leave without saving
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
