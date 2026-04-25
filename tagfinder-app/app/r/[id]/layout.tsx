import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shared Recovery Report | TurtleTag',
  description: 'Shared satellite tag recovery report.',
  robots: {
    index: false, // Don't crawl shared reports — they contain sensitive positions
    follow: false,
    nocache: true,
  },
};

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
