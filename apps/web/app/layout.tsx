import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sessions — Understand every change. Recover with confidence.",
  description:
    "AI-native source control and execution infrastructure for AI systems, AI agents, and humans.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
