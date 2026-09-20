"use client";
import { Brand } from "@/components/brand";
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="state-page"><header className="workspace-header"><Brand/></header><section className="state-card"><span className="eyebrow">Documents failed to open</span><h1>We couldn’t open the documents.</h1><p>Check the connection and try again.</p><button onClick={reset}>Try again</button></section></main>;}
