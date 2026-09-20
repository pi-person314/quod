"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut, type User } from "firebase/auth";
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
  const syncSession = useCallback((nextUser: User | null) => {
    const task = sessionQueue.current.catch(() => {}).then(async () => {
      // Token events can arrive while a popup or logout is still completing.
      if (firebaseAuth().currentUser?.uid !== nextUser?.uid) return;
      const response = await fetch("/api/auth/session", nextUser ? {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await nextUser.getIdToken() }),
      } : { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not establish your login session. Please try again.");
      }
      if (firebaseAuth().currentUser?.uid === nextUser?.uid) setUser(nextUser);
    });
    sessionQueue.current = task;
    return task;
  }, []);

  useEffect(() => {
    try {
      const auth = firebaseAuth();
      const unsubscribe = onIdTokenChanged(auth, (nextUser) => {
        setUser(current => current?.uid === nextUser?.uid ? current : null);
        setLoading(true);
        void syncSession(nextUser).catch(cause => {
          setUser(null);
          setError(authMessage(cause));
        }).finally(() => setLoading(false));
      });
      // Refresh even on an idle tab so the server cookie never outlives its ID token.
      const refresh = () => { if (auth.currentUser) void auth.currentUser.getIdToken(true).catch(cause => setError(authMessage(cause))); };
      const interval = window.setInterval(refresh, 45 * 60 * 1000);
      const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
      document.addEventListener("visibilitychange", onVisible);
      return () => { unsubscribe(); window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
    } catch (cause) {
      setError(authMessage(cause));
      setLoading(false);
    }
  }, [syncSession]);

  const login = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const result = await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
      await syncSession(result.user);
    } catch (cause) {
      setError(authMessage(cause));
      throw cause;
    } finally { setLoading(false); }
  }, [syncSession]);
  const logout = useCallback(async () => {
    setError("");
    setUser(null);
    setLoading(true);
    try {
      await signOut(firebaseAuth());
      await syncSession(null);
    } catch (cause) {
      setError(authMessage(cause));
      throw cause;
    } finally { setLoading(false); }
  }, [syncSession]);

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
