import type { Metadata } from "next";
import { mantineHtmlProps } from "@mantine/core";
import { Providers } from "@/components/Providers";
import "@mantine/core/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Find That Session",
  description:
    "Search your Claude Code CLI sessions with hybrid keyword + local embeddings.",
};

/** Boot light/dark + palette before paint (avoids ColorSchemeScript client <script> warning). */
const themeBoot = `(function(){try{var d=document.documentElement;var k="mantine-color-scheme-value";var s=localStorage.getItem(k);var v=s==="light"||s==="dark"||s==="auto"?s:"auto";var c=v!=="auto"?v:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");d.setAttribute("data-mantine-color-scheme",c);var t=localStorage.getItem("fts-theme");var ok={ocean:1,sand:1,mist:1,pine:1,amber:1};d.setAttribute("data-app-theme",ok[t]?t:"ocean");}catch(e){document.documentElement.setAttribute("data-app-theme","ocean");}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-app-theme="ocean" {...mantineHtmlProps}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
