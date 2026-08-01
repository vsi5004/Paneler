import type { Metadata } from "next";
import { Bebas_Neue, DM_Sans, JetBrains_Mono } from "next/font/google";
import PlausibleProvider from "next-plausible";
import "./globals.css";

// Plausible only runs in the server build: the static export (GH Pages
// preview) can't serve the proxy rewrites, and preview traffic would
// pollute the paneler.app dashboard anyway.
const isStaticExport = process.env.STATIC_EXPORT === "1";

const bebasNeue = Bebas_Neue({
  weight: "400",
  variable: "--font-heading",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Technical readouts — panel IDs, hex codes, panel counts — pull this
// instead of the body face so numeric content reads as data, not prose.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Panel Designer — Paneler",
  description:
    "Design any sewn ball before you sew it. Paint every panel in 3D and export laser-ready sewing templates.",
  // The designer is an app, not a content page: the landing page at
  // paneler.app/ is the indexable surface. This also keeps the GH Pages
  // static preview from competing with the real domain in search.
  robots: { index: false, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bebasNeue.variable} ${dmSans.variable} ${jetbrainsMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {!isStaticExport && <PlausibleProvider domain="paneler.app" />}
        {children}
      </body>
    </html>
  );
}
