"use client";

import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

type PublicFirebaseConfig = Pick<FirebaseOptions, "apiKey" | "authDomain" | "projectId" | "storageBucket" | "messagingSenderId" | "appId">;

let authPromise: Promise<Auth> | null = null;

function unavailable() {
  return new Error("Google login is not configured for this site. Please try again later.");
}

function validConfig(value: unknown): value is PublicFirebaseConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  return ["apiKey", "authDomain", "projectId", "appId"].every(key => typeof config[key] === "string" && config[key]);
}

async function publicConfig(): Promise<PublicFirebaseConfig> {
  let response: Response;
  try {
    response = await fetch("/api/auth/config", { cache: "no-store", credentials: "same-origin" });
  } catch {
    throw unavailable();
  }
  if (!response.ok) throw unavailable();
  const payload = await response.json().catch(() => null);
  if (!validConfig(payload?.config)) throw unavailable();
  return payload.config;
}

/** Initializes Firebase from the running server's public configuration. */
export async function firebaseAuth(): Promise<Auth> {
  if (!authPromise) authPromise = publicConfig().then(config => getAuth(getApps().length ? getApp() : initializeApp(config)));
  try {
    return await authPromise;
  } catch (cause) {
    // Let a later login attempt retry after a transient configuration fetch.
    authPromise = null;
    throw cause;
  }
}
