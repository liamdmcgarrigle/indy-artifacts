import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Artifacts",
  description: "Versioned, sandboxed artifacts published by the agents on this box",
};

/** Set the colour scheme before first paint so the page never flashes. */
const SCHEME_BOOT = `(function(){try{var s=localStorage.getItem("art-scheme");
if(s!=="light"&&s!=="dark"){s=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}
document.documentElement.setAttribute("data-scheme",s);}catch(e){
document.documentElement.setAttribute("data-scheme","light");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCHEME_BOOT }} />
        {/* Themes name typefaces; this is what actually loads them. Served from
            this origin because sandbox frames have no network. */}
        <link rel="preconnect" href="/fonts" />
        <link rel="stylesheet" href="/fonts/fonts.css" />
        <link rel="stylesheet" href="/primitives/primitives.css" />
        <link rel="stylesheet" href="/highlight.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
