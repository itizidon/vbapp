import { PlayerHeader } from "@/components/player-pages";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlayerHeader />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        {children}
      </main>
    </>
  );
}
