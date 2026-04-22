import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
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
  title: "TurtleTag Recovery | TurtleOps",
  description:
    "Free satellite tag analysis for marine researchers. Upload Wildlife Computers CSVs to estimate tag position, diagnose physical state, and generate AI-drafted recovery search briefs — all client-side.",
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
    title: "TurtleTag Recovery",
    description:
      "Free satellite tag analysis for marine researchers. Estimate tag position, diagnose state, generate recovery briefs.",
    url: "https://tagfinder.turtleops.org",
    siteName: "TurtleTag Recovery",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TurtleTag Recovery",
    description:
      "Free satellite tag analysis for marine researchers. Upload WC CSVs, get position + state + recovery brief.",
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
      </body>
    </html>
  );
}
