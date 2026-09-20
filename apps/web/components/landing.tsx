"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./brand";
import { AccountMenu, AddCorpusButton } from "./account-menu";
import { useAuth } from "./auth-provider";
const SCENES = ["lattice", "sphere", "surface"] as const;
export function Landing() {
  const {user,loading}=useAuth();
  const [entry,setEntry]=useState<{uid:string;docId:string;corpusId:string}|null>(null);
  useEffect(()=>{
    setEntry(null);if(!user||loading)return;
    const controller=new AbortController();
    fetch("/api/library",{signal:controller.signal,cache:"no-store"}).then(async r=>{if(!r.ok)return;const data=await r.json();const doc=data.docs.find((d:{status:string})=>d.status==="ready");if(doc&&!controller.signal.aborted)setEntry({uid:user.uid,docId:doc.id,corpusId:doc.corpus_id});}).catch(()=>{});
    return ()=>controller.abort();
  },[user?.uid,loading]);
  const current=user&&entry?.uid===user.uid?entry:null;
  const docId=current?.docId,corpusId=current?.corpusId;
  const [scene, setScene] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(true);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReducedMotion(media.matches);
    changed(); media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    let disposed = false;
    let cycle: ReturnType<typeof setTimeout> | undefined;
    let fade: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(cycle); clearTimeout(fade);
      if (reducedMotion || document.hidden) {
        videos.current.forEach(player => player?.pause());
        return;
      }
      void videos.current[scene]?.play().catch(() => {});
      // Keep the outgoing video moving until the crossfade finishes.
      fade = setTimeout(() => videos.current.forEach((player, index) => {
        if (index !== scene) player?.pause();
      }), 1600);
      cycle = setTimeout(async () => {
        const next = (scene + 1) % SCENES.length;
        const player = videos.current[next];
        if (!player) return;
        try {
          player.currentTime = 0;
          await player.play();
          if (!disposed && !document.hidden) setScene(next);
          else player.pause();
        } catch { /* Keep the current scene if the next video cannot play. */ }
      }, 8500);
    };
    update(); document.addEventListener("visibilitychange", update);
    return () => {
      disposed = true;
      clearTimeout(cycle); clearTimeout(fade);
      document.removeEventListener("visibilitychange", update);
    };
  }, [scene, reducedMotion]);
  return <main className="quod-landing">
    {SCENES.map((name, index) => <video key={name}
      ref={player => { videos.current[index] = player; }}
      className={`hero-film${index === (reducedMotion ? 0 : scene) ? " is-active" : ""}`}
      muted loop playsInline preload="auto" aria-hidden="true"
      poster={`/animations/quod-${name}-poster.png`}
      src={reducedMotion ? undefined : `/animations/quod-${name}.mp4`} />)}
    <div className="hero-shade" aria-hidden="true" />
    <header className="hero-nav"><Brand />
      <nav aria-label="Main navigation">
        <Link href="/library">Documents <span>01</span></Link>
        <Link href={corpusId ? `/map/${corpusId}` : "/library"}>Map <span>02</span></Link>

      </nav>
      <AccountMenu/>
      <AddCorpusButton className="pill-primary">Add documents <span aria-hidden="true">↗</span></AddCorpusButton>
    </header>
    <span className="hero-latin">∎ quod erat demonstrandum</span>
    <section className="hero-copy"><h1>Know what<br />rests on what.</h1><div className="hero-description">
      <p>Upload your textbook, your notes, your problem sets. Quod reads them together and builds the graph underneath. Hover any reference to see what it rests on, without losing your place.</p>
      <div className="hero-actions"><AddCorpusButton className="pill-primary">Start with your own PDFs <span aria-hidden="true">↗</span></AddCorpusButton>
        <Link className="pill-secondary" href={docId ? `/read/${docId}` : "/library"}>{docId ? "Continue reading" : "Explore your library"}</Link></div>
    </div></section>
  </main>;
}
