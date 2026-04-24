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
    "Find your popped-off archival tag. Free analysis for marine researchers using Wildlife Computers MiniPATs and other PSATs — position estimates, drift predictions, and AI-drafted recovery briefs.",
  keywords: [
    "satellite tag",
    "wildlife computers",
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
      "Find your popped-off archival tag. Upload MiniPAT/PSAT CSVs and get position, drift prediction, and an AI-drafted recovery brief.",
    url: "https://tagfinder.turtleops.org",
    siteName: "TurtleTag Recovery",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TurtleTag Recovery — Pop-up Satellite Tag Analysis",
    description:
      "Find your popped-off archival tag. Upload MiniPAT/PSAT CSVs, get position + state + recovery brief.",
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
