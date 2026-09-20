"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Corpus } from "@cairn/contracts";
import type { Dataset } from "@/lib/data";
import { useAuth } from "./auth-provider";
import { AddCorpusButton } from "./account-menu";

export function CorpusLibrary() {
  const { user, loading } = useAuth();
  const [library, setLibrary] = useState<{ uid: string; corpora: Corpus[]; data: Dataset } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setLibrary(null);
    setError("");
    if (!user || loading) return;
    const controller = new AbortController();
    const load = async (path: string) => {
      const response = await fetch(path, { signal: controller.signal, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load your corpora.");
      return body;
    };
    void Promise.all([load("/api/corpus"), load("/api/library")]).then(([courses, data]) => {
      if (!controller.signal.aborted) setLibrary({ uid: user.uid, corpora: courses.corpora, data });
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load your corpora."); });
    return () => controller.abort();
  }, [user?.uid, loading, retry]);
  const current = user && library?.uid === user.uid ? library : null;
  return <section className="corpora">
    <div className="section-heading"><span className="eyebrow">YOUR CORPORA</span><span>{(current?.corpora.length ?? 0).toString().padStart(2, "0")}</span></div>
    {loading ? <p className="library-empty" role="status">Connecting to your library…</p>
      : !user ? <div className="library-empty"><p>Log in to create a corpus and keep your documents together.</p><AddCorpusButton>Log in and add a corpus ↗</AddCorpusButton></div>
      : error ? <div className="library-empty" role="alert"><p className="error">{error}</p><button onClick={() => setRetry(value => value + 1)}>Try again</button></div>
      : !current ? <p className="library-empty" role="status">Loading your corpora…</p>
      : current.corpora.length === 0 ? <div className="library-empty"><p>Your library is ready for its first corpus.</p><AddCorpusButton>Add your first corpus ↗</AddCorpusButton></div>
      : current.corpora.map((corpus, index) => {
        const docs = current.data.docs.filter(doc => doc.corpus_id === corpus.id);
        const first = docs.find(doc => !/problem|pset/i.test(doc.title)) ?? docs[0];
        return <Link className="corpus-row" key={corpus.id} href={first ? `/read/${first.id}` : "/upload"}>
          <span className="corpus-index">{String(index + 1).padStart(2, "0")}</span>
          <div><h2>{corpus.name}</h2><p>{docs.length ? docs.map(doc => doc.title.split(" · ")[0]).join(" · ") : "No documents yet — add your first PDF"}</p></div>
          <div className="corpus-stats"><span>{docs.length} documents</span><span>{current.data.nodes.filter(node => docs.some(doc => doc.id === node.doc_id)).length} results</span></div>
          <span className="cross-link">↗</span>
        </Link>;
      })}
  </section>;
}
