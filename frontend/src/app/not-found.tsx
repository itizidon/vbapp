import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <h1>That page isn’t here.</h1>
      <p className="subtle my-5">Check your link or head back to bvbtips.</p>
      <Link href="/" className="text-primary">
        Back to home →
      </Link>
    </main>
  );
}
