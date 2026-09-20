import Link from "next/link";
import type { Doc } from "@cairn/contracts";
import { corpora, dataset } from "@/lib/data";
export const dynamic = "force-dynamic";
/** Open on the source text, not the problem set that references it. */
const entryDoc = (docs: Doc[]) =>
  docs.find((d) => !/problem|pset/i.test(d.title)) ?? docs[0];
export default async function Home() {
  const [data, courses] = await Promise.all([dataset(), corpora()]);
  const demo = entryDoc(data.docs);
  return (
    <main className="landing">
      <header>
        <Link href="/" className="wordmark">
          cairn<span> / </span>
        </Link>
        <span className="eyebrow">A READER FOR CONNECTED THINKING</span>
        <Link href="/upload">Add a corpus ↗</Link>
      </header>
      <section className="landing-intro">
        <span className="eyebrow">THE REFERENCE IS A BEGINNING</span>
        <h1>
          Keep the proof in view.
          <br />
          <em>Bring its foundations closer.</em>
        </h1>
        <p>
          Your textbook, notes, and problem sets — connected at the results they
          share.
        </p>
        <div className="landing-actions">
          {demo && (
            <Link className="primary" href={`/read/${demo.id}`}>
              Open the demo corpus <span>↗</span>
            </Link>
          )}
          <Link href="/upload">Start with your own PDFs</Link>
        </div>
        <div className="corpus-preview">
          <span>Problem set 4</span>
          <span className="connector">the dimension theorem ───↗</span>
          <span>Textbook · Rank-Nullity</span>
        </div>
      </section>
      <section className="corpora">
        <div className="section-heading">
          <span className="eyebrow">YOUR CORPORA</span>
          <span>{courses.length.toString().padStart(2, "0")}</span>
        </div>
        {courses.map((c, i) => {
          const docs = data.docs.filter((d) => d.corpus_id === c.id);
          const first = entryDoc(docs);
          return (
            <Link
              className="corpus-row"
              key={c.id}
              href={first ? `/read/${first.id}` : "/upload"}
            >
              <span className="corpus-index">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h2>{c.name}</h2>
                <p>
                  {docs.length
                    ? docs.map((d) => d.title.split(" · ")[0]).join(" · ")
                    : "No documents yet — add your first PDF"}
                </p>
              </div>
              <div className="corpus-stats">
                <span>{docs.length} documents</span>
                <span>
                  {
                    data.nodes.filter((n) =>
                      docs.some((d) => d.id === n.doc_id),
                    ).length
                  }{" "}
                  results
                </span>
              </div>
              <span className="cross-link">↗</span>
            </Link>
          );
        })}
      </section>
      <footer>
        <span>Follow a reference. Find your footing.</span>
        <span>Built for the way mathematics is read.</span>
      </footer>
    </main>
  );
}
