import type { Metadata } from "next";
import "./globals.css";
import "./brand.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: "Sessions — Software changes. Know exactly why.",
  description:
    "Sessions is the native development platform for AI systems, AI agents, and humans — source control, collaboration, verification, execution intelligence, and recovery in one place.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
