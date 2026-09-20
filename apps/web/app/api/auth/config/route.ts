import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PUBLIC_FIELDS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"] as const;

export function GET() {
  // Bracket access keeps these values server-runtime values instead of allowing
  // Next to inline them into the client bundle at build time.
  const runtime = process.env as Record<string, string | undefined>;
  const values: Record<(typeof PUBLIC_FIELDS)[number], string | undefined> = {
    apiKey: runtime["NEXT_PUBLIC_FIREBASE_API_KEY"],
    authDomain: runtime["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"],
    projectId: runtime["NEXT_PUBLIC_FIREBASE_PROJECT_ID"],
    storageBucket: runtime["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"],
    messagingSenderId: runtime["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"],
    appId: runtime["NEXT_PUBLIC_FIREBASE_APP_ID"],
  };
  const config = Object.fromEntries(PUBLIC_FIELDS.flatMap(field => values[field] ? [[field, values[field]]] : []));
  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    return NextResponse.json({ error: "Google login is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ config }, { headers: { "Cache-Control": "no-store" } });
}
