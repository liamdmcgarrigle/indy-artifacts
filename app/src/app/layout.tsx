import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./indy.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Indy", template: "%s · Indy" },
  description: "Pages, reports and forms your agents publish, for you to read, comment on and answer.",
  icons: { icon: "/icon.svg" },
};

/** Edge to edge on a phone, with the safe areas left to the page. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0e0f11" };

/**
 * Set the colour scheme before first paint so the page never flashes. Indy is
 * dark unless you have picked light.
 */
const SCHEME_BOOT = `(function(){try{var s=localStorage.getItem("indy-scheme");
if(s!=="light"&&s!=="dark"){s="dark";}
document.documentElement.setAttribute("data-scheme",s);}catch(e){
document.documentElement.setAttribute("data-scheme","dark");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scheme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCHEME_BOOT }} />
        {/* Indy is dark already. Dark Reader would otherwise rewrite every icon
            before React hydrates, and each one reports a hydration mismatch. */}
        <meta name="darkreader-lock" />
        {/* Served from this origin because sandbox frames have no network. */}
        <link rel="stylesheet" href="/fonts/fonts.css" />
        <link rel="stylesheet" href="/primitives/primitives.css" />
        <link rel="stylesheet" href="/highlight.css" />
      </head>
      <body>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
