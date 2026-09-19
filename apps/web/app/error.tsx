"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="empty">
      <h1>We couldn’t open the corpus.</h1>
      <p>Check the connection and try again.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
