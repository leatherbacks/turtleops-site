import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tagfinder.turtleops.org"),
  title: "TurtleTag Recovery — Pop-up Satellite Tag Analysis | TurtleOps",
  description:
    "Find your popped-off archival tag. Free analysis for marine researchers using Wildlife Computers and Lotek PSATs — decoded CSVs, raw Argos dumps, or recovered-tag logs in; position, tag state, and an AI-drafted recovery brief out. Field-tested on real recoveries.",
  keywords: [
    "satellite tag",
    "wildlife computers",
    "lotek",
    "PSAT+",
    "MiniPAT",
    "PSAT",
    "sea turtle",
    "manta",
    "tag recovery",
    "argos",
    "biotelemetry",
    "turtleops",
  ],
  authors: [{ name: "Chris Johnson — Florida Leatherbacks Inc." }],
  icons: {
    icon: "/assets/logo.png",
  },
  openGraph: {
    title: "TurtleTag Recovery — Pop-up Satellite Tag Analysis",
    description:
      "Find your popped-off archival tag. Upload Wildlife Computers or Lotek PSAT files and get position, tag state, and an AI-drafted recovery brief.",
    url: "https://tagfinder.turtleops.org",
    siteName: "TurtleTag Recovery",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TurtleTag Recovery — Pop-up Satellite Tag Analysis",
    description:
      "Find your popped-off archival tag. Wildlife Computers or Lotek PSAT files in — position + state + recovery brief out.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans bg-background text-foreground antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
