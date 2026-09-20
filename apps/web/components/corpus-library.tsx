"use client";
import { RenameButton } from "./rename-button";
import { documentColor } from "@/lib/document-colors";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "./brand";
import { Upload } from "./upload";
import { useAuth } from "./auth-provider";
import { AccountMenu, AddCorpusButton } from "./account-menu";
import type { Dataset } from "@/lib/data";
import type { Corpus } from "@quod/contracts";
interface CourseSummary { id:string; name:string; docs:{id:string;title:string;status:string}[]; nodeCount:number;edgeCount:number;docNodes:number[] }
type Ledger = { measured:boolean; total_usd:number; stages:{stage:string;calls:number;cost_usd:number}[] };
function LibraryContents({courses,onRefresh}:{courses:CourseSummary[];onRefresh:()=>void}) {
  const [progress,setProgress] = useState<Record<string,string>>({});
  const [files,setFiles] = useState<File[]>();
  const [drag,setDrag] = useState(false);
  const [selected,setSelected] = useState(courses[0]?.id ?? "");
  const [ledger,setLedger] = useState<Ledger>();
  const [costError,setCostError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const active = courses.filter(c=>c.docs.some(d=>["queued","ingesting"].includes(d.status)));
    const streams=active.map(c=>{
      const stream=new EventSource(`/api/corpus/${c.id}/events`);
      stream.onmessage=e=>{try{const event=JSON.parse(e.data);setProgress(old=>({...old,[c.id]:event.message??event.stage}));
        if(event.stage==="done"||event.stage==="error") onRefresh();}catch{}};
      return stream;
    });
    return ()=>streams.forEach(s=>s.close());
  },[courses,onRefresh]);
  useEffect(()=>{
    setLedger(undefined);setCostError(false);
    if(!selected)return;
    const controller=new AbortController();
    fetch(`/api/intel/costs?corpus_id=${selected}`,{signal:controller.signal})
      .then(async r=>{if(!r.ok)throw new Error();return r.json();})
      .then(setLedger).catch(()=>{if(!controller.signal.aborted)setCostError(true);});
    return ()=>controller.abort();
  },[selected]);
  if(files?.length) return <Upload initialFiles={files}/>;
  return <main className="library-page">
    <header className="workspace-header"><Brand trail="Your library"/><span className="eyebrow workspace-tagline">A reader for connected thinking</span><AccountMenu/><AddCorpusButton className="pill-primary">Add documents <span aria-hidden="true">↗</span></AddCorpusButton></header>
    <div className="library-content"><div className="library-heading"><div><span className="eyebrow">Your documents</span><h1>Nothing is learned alone.</h1></div><span className="library-count">{String(courses.length).padStart(2,"0")}</span></div>
      <div className="library-courses">{courses.map((course,i)=>{
        const doc=course.docs.find(d=>d.status==="ready"&&!/problem|pset/i.test(d.title))??course.docs[0];
        const running=course.docs.find(d=>["queued","ingesting"].includes(d.status));
        const failed=course.docs.find(d=>["error","unsupported"].includes(d.status));
        return <article className="library-course" key={course.id}>
          <span className="library-index">{String(i+1).padStart(2,"0")}</span><div className="library-course-copy"><div className="set-title"><h2><Link href={doc?`/read/${doc.id}`:"/upload"}>{course.name}</Link></h2><RenameButton kind="set" id={course.id} name={course.name} onRename={()=>onRefresh()}/></div>
            <p className={running?"ingesting":failed?"error":""}>{running?`Preparing ${running.title} — ${progress[course.id]??"processing documents"}`:failed?`${failed.title} needs attention — open to review`:course.docs.length?course.docs.map(d=>d.title.split(" · ")[0]).join(" · "):"No documents yet — add your first PDF"}</p></div>
          <div className="library-metrics"><div><span>{course.docs.length} {course.docs.length===1?"document":"documents"}</span><span>{course.nodeCount} results</span><span>{course.edgeCount} edges</span></div>
            {!!course.nodeCount&&<div className="coverage-strip" aria-label="Results by document">{course.docNodes.map((n,j)=>n>0&&<span key={j} style={{flex:n,background:documentColor(course.docs[j].id,course.docs)}} title={`${course.docs[j].title}: ${n} results`}/>)}</div>}</div>
          <Link className="cross-link" href={doc?`/read/${doc.id}`:"/upload"} aria-label={`Open ${course.name}`}>↗</Link>
          <div className="library-document-list">{course.docs.map(document=><div key={document.id}><i className="document-dot" style={{background:documentColor(document.id,course.docs)}}/><Link href={`/read/${document.id}`}>{document.title}</Link><RenameButton kind="document" id={document.id} name={document.title} onRename={()=>onRefresh()}/></div>)}</div></article>;
      })}{!courses.length&&<div className="library-empty"><h2>Your next idea starts here.</h2><p>Add your textbook, notes, and problem sets to connect the results they share.</p></div>}</div>
      <div className="library-bottom"><input ref={fileInput} type="file" accept="application/pdf,.pdf,.tex" multiple hidden onChange={e=>setFiles(Array.from(e.target.files??[]))}/>
        <button className={`library-drop ${drag?"dragging":""}`} onClick={()=>fileInput.current?.click()} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);setFiles(Array.from(e.dataTransfer.files));}}>
          <span className="drop-plus" aria-hidden="true">+</span><span><strong>Drop PDFs or .tex here</strong><span>Needs a selectable text layer. Scans without one come back as <em>unsupported</em> and can be replaced.</span></span></button>
        <section className="library-ledger" id="costs" aria-labelledby="ledger-title"><header><span className="eyebrow" id="ledger-title">Cost ledger</span><span>measured, never guessed</span></header>
          {courses.length>1&&<select aria-label="Cost ledger documents" value={selected} onChange={e=>setSelected(e.target.value)}>{courses.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select>}
          <div className="ledger-total">{ledger?.measured?`$${ledger.total_usd.toFixed(4)}`:"—"}</div>
          {ledger?.stages.map(s=><div className="ledger-row" key={s.stage}><span>{s.stage}</span><span>{s.calls} calls</span><span>${s.cost_usd.toFixed(4)}</span></div>)}
          {costError?<p role="alert">The cost ledger is unavailable. Try again shortly.</p>:!ledger&&selected?<p aria-live="polite">Loading recorded usage…</p>:!ledger?.measured?<p>No measured API usage recorded yet.</p>:null}
          <p>Baked cards make no model calls while you read.</p></section>
      </div></div><footer className="workspace-footer"><span>Follow a reference. Find your footing.</span><span>Built for the way mathematics is read.</span></footer>
  </main>;
}

export function CorpusLibrary() {
  const {user,loading}=useAuth();
  const [library,setLibrary]=useState<{uid:string;courses:CourseSummary[]}|null>(null);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  const refresh=useCallback(()=>setRetry(n=>n+1),[]);
  useEffect(()=>{
    setLibrary(null);setError("");
    if(!user||loading)return;
    const controller=new AbortController();
    const load=async(path:string)=>{const r=await fetch(path,{cache:"no-store",signal:controller.signal});const body=await r.json();if(!r.ok)throw new Error(body.error||"Could not load your library.");return body;};
    Promise.all([load("/api/corpus"),load("/api/library")]).then(([list,data]:[{corpora:Corpus[]},Dataset])=>{
      const courses=list.corpora.map(course=>{
        const docs=data.docs.filter(d=>d.corpus_id===course.id),ids=new Set(docs.map(d=>d.id));
        const nodes=data.nodes.filter(n=>ids.has(n.doc_id)),nodeIds=new Set(nodes.map(n=>n.id));
        return {id:course.id,name:course.name === "New course corpus" ? "New documents" : course.name,docs:docs.map(d=>({id:d.id,title:d.title,status:d.status})),nodeCount:nodes.length,
          edgeCount:data.edges.filter(e=>nodeIds.has(e.src)&&nodeIds.has(e.dst)).length,docNodes:docs.map(d=>nodes.filter(n=>n.doc_id===d.id).length)};
      });
      if(!controller.signal.aborted)setLibrary({uid:user.uid,courses});
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message||"Could not load your library.");});
    return ()=>controller.abort();
  },[user?.uid,loading,retry]);
  if(user&&library&&library.uid===user.uid)return <LibraryContents courses={library.courses} onRefresh={refresh}/>;
  return <main className="state-page"><header className="workspace-header"><Brand trail="Your library"/><AccountMenu/></header>
    <section className="state-card"><span className="eyebrow">{loading||user&&!error?"Your documents":error?"Library unavailable":"Your private library"}</span>
      <h1>{loading?"Connecting to your library…":error?"We couldn’t open the documents.":user?"Loading your documents…":"Your private library"}</h1>
      <p>{error||(!user&&!loading?"Log in to read your documents. Your files stay in your private library.":"Your documents and their connections will appear here.")}</p>
      {error?<button onClick={()=>setRetry(n=>n+1)}>Try again</button>:!user&&!loading?<AccountMenu/>:null}
    </section></main>;
}
