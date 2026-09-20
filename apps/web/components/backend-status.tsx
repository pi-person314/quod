"use client";
import { useEffect, useState } from "react";
export function BackendStatus() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch("/api/backend/status", { cache: "no-store", signal: AbortSignal.timeout(12000) });
        const data = response.ok ? await response.json() : null;
        if (active) setOffline(data?.online !== true);
      } catch { if (active) setOffline(true); }
    };
    void check(); const timer = setInterval(() => { if (!document.hidden) void check(); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  if (!offline) return null;
  return <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 10000, background: "#142739", border: "1px solid #e7b85a", borderRadius: 10, padding: "12px 20px", maxWidth: "90vw", color: "#eee" }}>The document server is offline. Your documents will be available when it reconnects.</div>;
}
export function BackendUnavailable() {
  return <main style={{ maxWidth: 640, margin: "15vh auto", padding: 24 }}><h1>Document server offline</h1><p>Your documents are stored on the local backend. Please try again when it reconnects.</p><button onClick={() => location.reload()}>Try again</button> <a href="/">Back to Quod</a></main>;
}
