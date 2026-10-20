import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppShell } from "@/components/app-shell";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Polices hebergees dans le depot (src/app/fonts, sous-ensemble latin des
// paquets @fontsource, licence SIL OFL 1.1) plutot que next/font/google :
// next/font/google telecharge les fichiers chez Google pendant `next build`,
// et un echec reseau fait echouer la compilation (CI, image Docker). Memes
// graisses et memes variables CSS qu'avant : rendu identique.
const plexSans = localFont({
  variable: "--font-plex-sans",
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  fallback: ["system-ui", "Arial", "sans-serif"],
});

const plexMono = localFont({
  variable: "--font-plex-mono",
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  adjustFontFallback: false,
  fallback: ["ui-monospace", "Menlo", "Consolas", "monospace"],
});

// docs/12-maquettes-ui-ux.md §2 : "Typographie titres : police serif (ex.
// Georgia / Iowan Old Style)" — identite editoriale distincte d'un SaaS
// generique. Source Serif 4 est l'equivalent Google Fonts le plus proche
// de cette reference (transitionnelle, chaleureuse, tres lisible en titre).
const sourceSerif = localFont({
  variable: "--font-source-serif",
  src: [
    { path: "./fonts/source-serif-4-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/source-serif-4-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/source-serif-4-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  adjustFontFallback: "Times New Roman",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const metadata: Metadata = {
  title: "AI Help Desk",
  description: "Console de support IT assisté par IA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning : THEME_INIT_SCRIPT ajoute la classe .dark sur
    // <html> avant l'hydratation.
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexMono.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          <SessionBootstrap>
            <AppShell>{children}</AppShell>
          </SessionBootstrap>
        </TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
