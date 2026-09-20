"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";

export function AccountMenu() {
  const { user, loading, login, logout } = useAuth();
  const router = useRouter();
  return <div className="account-menu">
    {user && <span className="account-name" title={user.email ?? undefined}>{user.displayName || user.email || "Your account"}</span>}
    <button className="account-button" disabled={loading} onClick={() => {
      if (user) void logout().then(() => { router.replace("/"); router.refresh(); }).catch(() => {});
      else void login().catch(() => {});
    }}>{loading ? "Connecting…" : user ? "Log out" : "Log in with Google"}</button>
  </div>;
}

export function AddCorpusButton({ className, children = "Add a corpus ↗" }: { className?: string; children?: React.ReactNode }) {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  return <button className={className} disabled={loading} onClick={() => {
    if (user) router.push("/upload");
    else void login().then(() => router.push("/upload")).catch(() => {});
  }}>{children}</button>;
}
