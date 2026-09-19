import Link from "next/link";
export default function NotFound() {
  return (
    <main className="empty">
      <h1>This page is missing.</h1>
      <p>The document may have been removed or the link may be incomplete.</p>
      <Link href="/">Return to your corpora ↗</Link>
    </main>
  );
}
