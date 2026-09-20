import type { Metadata } from "next";
import "./globals.css";
import "./quod-design.css";
import "./workspace-design.css";
import "./reader-design.css";
import { AuthProvider } from "@/components/auth-provider";

export const metadata: Metadata = {
  title: "Quod",
  description:
    "A textbook is a dependency graph flattened into a line. Quod unflattens it.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen"><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
