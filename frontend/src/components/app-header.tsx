"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { disconnectSocket } from "@/lib/socket";
import { useSessionUser } from "@/lib/use-session-user";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { ThemeToggle } from "@/components/theme-toggle";

interface AppHeaderProps {
  title: string;
  action?: ReactNode;
}

// Barre superieure de la mise en page partagee (voir AppShell) : la
// navigation vit desormais dans la barre laterale.
export function AppHeader({ title, action }: AppHeaderProps) {
  const router = useRouter();
  const user = useSessionUser();

  async function handleSignOut() {
    const token = getToken();
    if (token) {
      try {
        await logout(token);
      } catch {
        // best-effort: the local session is cleared regardless
      }
    }
    disconnectSocket();
    clearSession();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
      <SidebarTrigger className="-ml-1 size-8" aria-label="Afficher ou masquer le menu" />
      <Separator orientation="vertical" className="mr-1 h-5! self-center" />
      <h1 className="min-w-0 flex-1 truncate font-heading text-lg font-semibold tracking-tight text-primary md:text-xl">
        {title}
      </h1>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {action}
        <ThemeToggle />
        {user ? <NotificationsBell /> : null}
        {user ? (
          <span className="hidden max-w-48 truncate text-sm text-muted-foreground lg:inline">
            {user.displayName} · <span className="font-mono text-xs">{user.role}</span>
          </span>
        ) : null}
        <Button variant="outline" size="sm" onClick={handleSignOut} aria-label="Se déconnecter">
          <LogOut aria-hidden="true" />
          <span className="hidden sm:inline">Se déconnecter</span>
        </Button>
      </div>
    </header>
  );
}
