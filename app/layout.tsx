import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AFC Asian Cup 2027 — Live Ticket Monitor",
  description:
    "Real-time ticket availability tracker for AFC Asian Cup Saudi Arabia 2027. Live updates, smart notifications, beautiful dashboard.",
  openGraph: {
    title: "AFC Asian Cup 2027 — Live Ticket Monitor",
    description: "Live ticket availability for all 51 matches.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0c1a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
