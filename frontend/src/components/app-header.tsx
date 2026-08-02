"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import { clearSession, getRefreshToken, getToken } from "@/lib/session";
import { disconnectSocket } from "@/lib/socket";
import { useSessionUser } from "@/lib/use-session-user";
import { Button } from "@/components/ui/button";
import { NotificationsBell } from "@/components/notifications-bell";

const DASHBOARD_ROLES = new Set(["SUPERVISOR", "ADMIN"]);
const KNOWLEDGE_ROLES = new Set(["TECHNICIAN", "SUPERVISOR", "ADMIN"]);
const APPROVAL_ROLES = new Set(["TECHNICIAN", "SUPERVISOR", "ADMIN"]);
const ARTICLE_REVIEW_ROLES = new Set(["SUPERVISOR", "ADMIN"]);

interface AppHeaderProps {
  title: string;
  action?: ReactNode;
}

export function AppHeader({ title, action }: AppHeaderProps) {
  const router = useRouter();
  const user = useSessionUser();

  async function handleSignOut() {
    const token = getToken();
    const refreshToken = getRefreshToken();
    if (token && refreshToken) {
      try {
        await logout(token, refreshToken);
      } catch {
        // best-effort: the local session is cleared regardless
      }
    }
    disconnectSocket();
    clearSession();
    router.replace("/login");
  }

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div>
          <p className="font-mono text-xs tracking-[0.25em] text-muted-foreground">SYSTÈME</p>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-4">
          {action}
          {user && DASHBOARD_ROLES.has(user.role) ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard" />}>
              Tableau de bord
            </Button>
          ) : null}
          {user && DASHBOARD_ROLES.has(user.role) ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/teams" />}>
              Équipes
            </Button>
          ) : null}
          {user && DASHBOARD_ROLES.has(user.role) ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/sla-policies" />}>
              SLA
            </Button>
          ) : null}
          {user && DASHBOARD_ROLES.has(user.role) ? (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/admin/configuration-items" />}
            >
              Inventaire
            </Button>
          ) : null}
          {user && DASHBOARD_ROLES.has(user.role) ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/licenses" />}>
              Licences
            </Button>
          ) : null}
          {user && KNOWLEDGE_ROLES.has(user.role) ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/knowledge" />}>
              Base de connaissances
            </Button>
          ) : null}
          {user && ARTICLE_REVIEW_ROLES.has(user.role) ? (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/knowledge/articles" />}
            >
              Articles proposés
            </Button>
          ) : null}
          {user && APPROVAL_ROLES.has(user.role) ? (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/automation/approvals" />}
            >
              Approbations
            </Button>
          ) : null}
          {user && user.role === "ADMIN" ? (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/admin/automation-scripts" />}
            >
              Scripts
            </Button>
          ) : null}
          {user && user.role === "ADMIN" ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/users" />}>
              Utilisateurs
            </Button>
          ) : null}
          {user && user.role === "ADMIN" ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/ai-agents" />}>
              Agents IA
            </Button>
          ) : null}
          {user && user.role === "ADMIN" ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/audit-logs" />}>
              Journal d&apos;audit
            </Button>
          ) : null}
          {user ? <NotificationsBell /> : null}
          {user ? (
            <span className="text-sm text-muted-foreground">
              {user.displayName} · <span className="font-mono text-xs">{user.role}</span>
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            Se déconnecter
          </Button>
        </div>
      </div>
    </header>
  );
}
