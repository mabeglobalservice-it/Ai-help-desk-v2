"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { logout } from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { disconnectSocket } from "@/lib/socket";
import { useSessionUser } from "@/lib/use-session-user";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotificationsBell } from "@/components/notifications-bell";

const DASHBOARD_ROLES = new Set(["SUPERVISOR", "ADMIN"]);
// docs/10-architecture-rag.md §10 : un EMPLOYEE a aussi accès à la
// recherche (niveau 1 "public" uniquement, filtré côté serveur).
const KNOWLEDGE_ROLES = new Set(["EMPLOYEE", "TECHNICIAN", "SUPERVISOR", "ADMIN"]);
const APPROVAL_ROLES = new Set(["TECHNICIAN", "SUPERVISOR", "ADMIN"]);
const ARTICLE_REVIEW_ROLES = new Set(["SUPERVISOR", "ADMIN"]);

interface NavItem {
  href: string;
  label: string;
  roles: Set<string>;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Tableau de bord", roles: DASHBOARD_ROLES },
  { href: "/admin/teams", label: "Équipes", roles: DASHBOARD_ROLES },
  { href: "/admin/sla-policies", label: "SLA", roles: DASHBOARD_ROLES },
  { href: "/admin/configuration-items", label: "Inventaire", roles: DASHBOARD_ROLES },
  { href: "/admin/licenses", label: "Licences", roles: DASHBOARD_ROLES },
  { href: "/knowledge", label: "Base de connaissances", roles: KNOWLEDGE_ROLES },
  { href: "/knowledge/articles", label: "Articles proposés", roles: ARTICLE_REVIEW_ROLES },
  { href: "/automation/approvals", label: "Approbations", roles: APPROVAL_ROLES },
  { href: "/admin/automation-scripts", label: "Scripts", roles: new Set(["ADMIN"]) },
  { href: "/admin/users", label: "Utilisateurs", roles: new Set(["ADMIN"]) },
  { href: "/admin/ai-agents", label: "Agents IA", roles: new Set(["ADMIN"]) },
  { href: "/admin/audit-logs", label: "Journal d'audit", roles: new Set(["ADMIN"]) },
  { href: "/admin/settings", label: "Configuration", roles: new Set(["ADMIN"]) },
];

interface AppHeaderProps {
  title: string;
  action?: ReactNode;
}

export function AppHeader({ title, action }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
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

  const visibleItems = user ? NAV_ITEMS.filter((item) => item.roles.has(user.role)) : [];
  // Une route active peut etre une sous-page (ex. /tickets/:id) : on
  // fait correspondre l'onglet dont le href est le prefixe le plus long.
  const activeHref = visibleItems.reduce<string | null>((best, item) => {
    if (pathname === item.href || pathname?.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.length) return item.href;
    }
    return best;
  }, null);

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div>
          <p className="font-mono text-xs tracking-[0.25em] text-muted-foreground">SYSTÈME</p>
          <h1 className="font-heading text-xl font-semibold tracking-tight text-primary">{title}</h1>
        </div>
        <div className="flex items-center gap-3">
          {action}
          {user ? <NotificationsBell /> : null}
          {user ? (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.displayName} · <span className="font-mono text-xs">{user.role}</span>
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            Se déconnecter
          </Button>
        </div>
      </div>
      {visibleItems.length > 0 ? (
        <div className="mx-auto max-w-5xl overflow-x-auto px-6 pb-2">
          <Tabs value={activeHref ?? undefined}>
            <TabsList variant="line" className="w-max">
              {visibleItems.map((item) => {
                const isActive = item.href === activeHref;
                return (
                  <TabsTrigger
                    key={item.href}
                    value={item.href}
                    nativeButton={false}
                    render={<Link href={item.href} />}
                    className="data-active:font-semibold data-active:text-primary after:opacity-0"
                  >
                    {isActive ? (
                      <motion.div
                        layoutId="nav-active-pill"
                        className="absolute inset-0 rounded-md bg-primary/10"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
                      />
                    ) : null}
                    <span className="relative z-10">{item.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>
      ) : null}
    </header>
  );
}
