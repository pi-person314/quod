"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut, type Auth, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);

function authMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Login was cancelled. Try again when you’re ready.";
  if (code === "auth/popup-blocked") return "Allow popups for this site, then try Google login again.";
  if (code === "auth/unauthorized-domain") return "This domain needs to be added to Firebase Authentication’s authorized domains.";
  if (code === "auth/operation-not-allowed") return "Enable the Google sign-in provider in Firebase Authentication.";
  return error instanceof Error ? error.message : "Login failed. Please try again.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sessionQueue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(false);
  const subscribedAuth = useRef<Auth | null>(null);
  const stopSubscription = useRef<() => void>(() => {});
  const syncSession = useCallback((auth: Auth, nextUser: User | null) => {
    const task = sessionQueue.current.catch(() => {}).then(async () => {
      // Token events can arrive while a popup or logout is still completing.
      if (auth.currentUser?.uid !== nextUser?.uid) return;
      const response = await fetch("/api/auth/session", nextUser ? {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await nextUser.getIdToken() }),
      } : { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not establish your login session. Please try again.");
      }
      if (mounted.current && auth.currentUser?.uid === nextUser?.uid) setUser(nextUser);
    });
    sessionQueue.current = task;
    return task;
  }, []);

  const ensureSubscription = useCallback((auth: Auth) => {
    if (!mounted.current || subscribedAuth.current === auth) return;
    stopSubscription.current();
    subscribedAuth.current = auth;
    const unsubscribeToken = onIdTokenChanged(auth, (nextUser) => {
      if (!mounted.current) return;
      setUser(current => current?.uid === nextUser?.uid ? current : null);
      setLoading(true);
      void syncSession(auth, nextUser).catch(cause => {
        if (mounted.current) { setUser(null); setError(authMessage(cause)); }
      }).finally(() => { if (mounted.current) setLoading(false); });
    });
    // Refresh even on an idle tab so the server cookie never outlives its ID token.
    const refresh = () => { if (auth.currentUser) void auth.currentUser.getIdToken(true).catch(cause => { if (mounted.current) setError(authMessage(cause)); }); };
    const interval = window.setInterval(refresh, 45 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    stopSubscription.current = () => {
      unsubscribeToken();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      if (subscribedAuth.current === auth) subscribedAuth.current = null;
    };
  }, [syncSession]);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        ensureSubscription(await firebaseAuth());
      } catch {
        // Do not surface an error simply because a public page has no login config.
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
      stopSubscription.current();
      stopSubscription.current = () => {};
    };
  }, [ensureSubscription]);

  const login = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const auth = await firebaseAuth();
      ensureSubscription(auth);
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      await syncSession(auth, result.user);
    } catch (cause) {
      setError(authMessage(cause));
      throw cause;
    } finally { setLoading(false); }
  }, [ensureSubscription, syncSession]);
  const logout = useCallback(async () => {
    setError("");
    setUser(null);
    setLoading(true);
    try {
      const auth = await firebaseAuth();
      ensureSubscription(auth);
      await signOut(auth);
      await syncSession(auth, null);
    } catch (cause) {
      setError(authMessage(cause));
      throw cause;
    } finally { setLoading(false); }
  }, [ensureSubscription, syncSession]);

  return <AuthContext.Provider value={{ user, loading, login, logout }}>
    {children}
    {error && <div className="auth-notice" role="alert"><span>{error}</span><button aria-label="Dismiss login message" onClick={() => setError("")}>×</button></div>}
  </AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used within AuthProvider");
  return auth;
}
