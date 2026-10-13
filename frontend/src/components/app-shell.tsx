"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

// Pages hors application (connexion, redirection d'accueil) : pas de barre
// laterale.
const BARE_ROUTES = new Set(["/", "/login"]);

// Meme cookie que celui ecrit par SidebarProvider a chaque repli/depli.
const SIDEBAR_COOKIE = "sidebar_state";

function initialSidebarOpen(): boolean {
  const match = document.cookie.match(new RegExp(`(?:^|; )${SIDEBAR_COOKIE}=(true|false)`));
  if (match) return match[1] === "true";
  // Sans choix memorise : depliee sur grand ecran, en icones sur tablette.
  return window.innerWidth >= 1024;
}

// Mise en page partagee de toutes les pages de l'application : barre
// laterale repliable (tiroir sur mobile) + zone de contenu. Chaque page
// fournit sa barre superieure via <AppHeader>. Rendu cote client uniquement
// (SessionBootstrap ne rend rien cote serveur), d'ou l'acces direct a
// document/window.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [defaultOpen] = useState(initialSidebarOpen);

  if (BARE_ROUTES.has(pathname)) return <>{children}</>;

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset className="min-w-0">{children}</SidebarInset>
    </SidebarProvider>
  );
}
