import Link from "next/link";
export function Brand({ trail }: { trail?: string }) {
  return <div className="brand-group"><Link className="wordmark" href="/" aria-label="Quod home"><i aria-hidden="true" />quod</Link>
    {trail && <><span className="brand-divider" aria-hidden="true">/</span><span className="brand-trail">{trail}</span></>}
  </div>;
}
