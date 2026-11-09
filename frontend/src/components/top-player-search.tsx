"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, X, LockKeyhole } from "lucide-react";
import { gql } from "@/lib/api";
import type { PlayerProfile } from "@/lib/types";
import { UserAvatar } from "./common";
export const PLAYER_SEARCH_DELAY = 500;
export function TopPlayerSearch({ enabled = true }: { enabled?: boolean }) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const router = useRouter();
  const search = text.trim();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), PLAYER_SEARCH_DELAY);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const suggestions = useQuery({
    queryKey: ["player-suggestions", debounced],
    queryFn: () =>
      gql<{ playerSuggestions: PlayerProfile[] }>(
        `query PlayerSuggestions($search:String!){playerSuggestions(search:$search){id username isPublic}}`,
        { search: debounced },
      ),
    enabled: enabled && open && search.length >= 2 && search === debounced,
    staleTime: 0,
    retry: false,
  });
  const expanded = enabled && open && search.length >= 2;
  const waiting =
    search !== debounced || suggestions.isPending || suggestions.isFetching;
  const rows = !waiting
    ? (suggestions.data?.playerSuggestions.slice(0, 5) ?? [])
    : [];
  function choose(player: PlayerProfile) {
    setOpen(false);
    setText("");
    setActive(-1);
    router.push(`/players/${player.id}`);
  }
  return (
    <div
      ref={root}
      className="relative min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <div className="relative">
        <Search
          size={17}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={input}
          role="combobox"
          aria-label="Search players"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={expanded}
          aria-activedescendant={
            expanded && rows[active] ? `${listId}-${active}` : undefined
          }
          value={text}
          maxLength={254}
          autoComplete="off"
          placeholder="Username or email"
          disabled={!enabled}
          className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-background py-2 pl-10 pr-10 text-sm"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setText(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (rows.length)
                setActive((previous) =>
                  event.key === "ArrowDown"
                    ? (previous + 1) % rows.length
                    : previous <= 0
                      ? rows.length - 1
                      : previous - 1,
                );
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (expanded && rows.length)
                choose(rows[Math.max(0, Math.min(active, rows.length - 1))]);
            }
          }}
        />
        {text && (
          <button
            type="button"
            aria-label="Clear player search"
            className="absolute right-0 top-0 grid size-11 place-items-center rounded-xl text-muted-foreground"
            onClick={() => {
              setText("");
              setActive(-1);
              setOpen(false);
              input.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 max-h-96 overflow-auto rounded-xl border border-border bg-card p-2 shadow-xl">
          {waiting ? (
            <p role="status" className="subtle p-3 text-sm">
              Searching players…
            </p>
          ) : suggestions.error ? (
            <div role="alert" className="space-y-2 p-3 text-sm">
              <p className="error">{suggestions.error.message}</p>
              <button
                type="button"
                className="min-h-11 text-primary"
                onClick={() => suggestions.refetch()}
              >
                Try again
              </button>
            </div>
          ) : !rows.length ? (
            <p role="status" className="subtle p-3 text-sm">
              No matching players.
            </p>
          ) : null}
          <ul id={listId} role="listbox" aria-label="Player suggestions">
            {rows.map((player, index) => (
              <li
                key={player.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={active === index}
                className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-lg p-3 ${active === index ? "bg-accent" : "hover:bg-muted"}`}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(player)}
              >
                <UserAvatar name={player.username} />
                <div className="min-w-0">
                  <p className="break-anywhere text-sm font-semibold">
                    {player.username}
                  </p>
                  <p className="subtle flex items-center gap-1 text-xs">
                    {!player.isPublic && <LockKeyhole size={12} />}
                    {player.isPublic ? "Public account" : "Private account"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
