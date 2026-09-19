import Link from "next/link";
import { loadGoldenCorpus, fixturesEnabled } from "@/lib/fixtures";

// Landing: one sentence and a demo-corpus button (B6 polishes this).
export default async function Home() {
  const docs = fixturesEnabled() ? loadGoldenCorpus().docs : [];
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Cairn</h1>
      <p className="mt-3 text-neutral-400">
        A textbook is a dependency graph flattened into a line. Cairn unflattens it.
      </p>
      <ul className="mt-10 space-y-2">
        {docs.map((d) => (
          <li key={d.id}>
            <Link className="underline underline-offset-4 hover:text-white" href={`/read/${d.id}`}>
              {d.title}
            </Link>
            <span className="ml-2 text-xs text-neutral-500">{d.page_count} pages</span>
          </li>
        ))}
        {docs.length === 0 && (
          <li className="text-sm text-neutral-500">
            No documents. Set USE_FIXTURES=1 once fixtures/golden has landed, or upload a corpus.
          </li>
        )}
      </ul>
    </main>
  );
}
