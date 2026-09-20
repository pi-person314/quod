import Link from "next/link";
import { Brand } from "@/components/brand";
export default function NotFound(){return <main className="state-page"><header className="workspace-header"><Brand/></header><section className="state-card"><span className="eyebrow">404 · Not found</span><span className="state-symbol" aria-hidden="true">∅</span><h1>This page is missing.</h1><p>The document may have been removed, or the link may be incomplete.</p><Link href="/library">Return to your documents ↗</Link></section></main>;}
