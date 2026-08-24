import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// docs/12-maquettes-ui-ux.md §2 : "Typographie titres : police serif (ex.
// Georgia / Iowan Old Style)" — identite editoriale distincte d'un SaaS
// generique. Source Serif 4 est l'equivalent Google Fonts le plus proche
// de cette reference (transitionnelle, chaleureuse, tres lisible en titre).
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
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
    <html
      lang="fr"
      className={`${plexSans.variable} ${plexMono.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionBootstrap>{children}</SessionBootstrap>
        <Toaster />
      </body>
    </html>
  );
}
