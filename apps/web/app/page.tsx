import Link from "next/link";
import { AccountMenu, AddCorpusButton } from "@/components/account-menu";
import { CorpusLibrary } from "@/components/corpus-library";

export default function Home() {
  return (
    <main className="landing">
      <header>
        <Link href="/" className="wordmark">cairn<span> / </span></Link>
        <span className="eyebrow">A READER FOR CONNECTED THINKING</span>
        <div className="header-actions"><AddCorpusButton /><AccountMenu /></div>
      </header>
      <section className="landing-intro">
        <span className="eyebrow">THE REFERENCE IS A BEGINNING</span>
        <h1>Keep the proof in view.<br /><em>Bring its foundations closer.</em></h1>
        <p>Your textbook, notes, and problem sets — connected at the results they share.</p>
        <div className="landing-actions"><AddCorpusButton className="primary">Start with your own PDFs <span>↗</span></AddCorpusButton></div>
        <div className="corpus-preview"><span>Problem set 4</span><span className="connector">the dimension theorem ───↗</span><span>Textbook · Rank-Nullity</span></div>
      </section>
      <CorpusLibrary />
      <footer><span>Follow a reference. Find your footing.</span><span>Built for the way mathematics is read.</span></footer>
    </main>
  );
}
