import type { Metadata } from "next";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import "./globals.css";

/**
 * Newsreader for the wordmark and headings, IBM Plex Sans for everything else.
 *
 * An editorial serif against a workhorse humanist sans is a deliberate pairing
 * rather than a default one. Plex was drawn for interface text and has real
 * tabular figures, which the severity scores and distances rely on. Both are
 * self-hosted by next/font, so there is no runtime request to a font CDN and no
 * layout shift on load.
 */
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NavigAble",
  description: "Accessibility obstacle map.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
