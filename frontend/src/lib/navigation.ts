import {
  BookOpen,
  Boxes,
  CircleCheckBig,
  FileCheck2,
  FileCode2,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Settings2,
  ShieldCheck,
  Bot,
  MessageSquareText,
  Ticket,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

const DASHBOARD_ROLES = new Set(["SUPERVISOR", "ADMIN"]);
// docs/10-architecture-rag.md §10 : un EMPLOYEE a aussi accès à la
// recherche (niveau 1 "public" uniquement, filtré côté serveur).
const KNOWLEDGE_ROLES = new Set(["EMPLOYEE", "TECHNICIAN", "SUPERVISOR", "ADMIN"]);
const APPROVAL_ROLES = new Set(["TECHNICIAN", "SUPERVISOR", "ADMIN"]);
const ARTICLE_REVIEW_ROLES = new Set(["SUPERVISOR", "ADMIN"]);
const ADMIN_ROLES = new Set(["ADMIN"]);
const ALL_ROLES = new Set(["EMPLOYEE", "TECHNICIAN", "SUPERVISOR", "ADMIN"]);

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Set<string>;
  // Compte de démonstration (SessionUser.isReadOnly) : "hide" retire une page
  // faite uniquement d'actions refusées par le backend, "only" ajoute un
  // raccourci propre à la démonstration.
  readOnly?: "hide" | "only";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Memes droits d'acces par role que l'ancienne barre d'onglets ; seul le
// regroupement change.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Opérations",
    items: [
      { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard, roles: DASHBOARD_ROLES },
      { href: "/admin/sla-policies", label: "SLA", icon: ShieldCheck, roles: DASHBOARD_ROLES },
      { href: "/tickets", label: "Tickets", icon: Ticket, roles: ALL_ROLES, readOnly: "only" },
      { href: "/tickets/new", label: "Diagnostic IA", icon: MessageSquareText, roles: ALL_ROLES, readOnly: "only" },
      { href: "/automation/approvals", label: "Approbations", icon: CircleCheckBig, roles: APPROVAL_ROLES, readOnly: "hide" },
    ],
  },
  {
    label: "Actifs",
    items: [
      { href: "/admin/configuration-items", label: "Inventaire", icon: Boxes, roles: DASHBOARD_ROLES },
      { href: "/admin/licenses", label: "Licences", icon: KeyRound, roles: DASHBOARD_ROLES },
    ],
  },
  {
    label: "Connaissances",
    items: [
      { href: "/knowledge", label: "Base de connaissances", icon: BookOpen, roles: KNOWLEDGE_ROLES },
      { href: "/knowledge/articles", label: "Articles proposés", icon: FileCheck2, roles: ARTICLE_REVIEW_ROLES, readOnly: "hide" },
    ],
  },
  {
    label: "Automatisation",
    items: [
      { href: "/admin/automation-scripts", label: "Scripts", icon: FileCode2, roles: ADMIN_ROLES },
      { href: "/admin/ai-agents", label: "Agents IA", icon: Bot, roles: ADMIN_ROLES },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/teams", label: "Équipes", icon: UsersRound, roles: DASHBOARD_ROLES },
      { href: "/admin/users", label: "Utilisateurs", icon: UserCog, roles: ADMIN_ROLES },
      { href: "/admin/audit-logs", label: "Journal d'audit", icon: ScrollText, roles: ADMIN_ROLES },
      { href: "/admin/settings", label: "Configuration", icon: Settings2, roles: ADMIN_ROLES },
    ],
  },
];

export function visibleNavGroups(role: string | undefined, isReadOnly = false): NavGroup[] {
  if (!role) return [];
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        item.roles.has(role) && (isReadOnly ? item.readOnly !== "hide" : item.readOnly !== "only"),
    ),
  })).filter((group) => group.items.length > 0);
}

// Une route active peut etre une sous-page (ex. /admin/configuration-items/:id) :
// on retient l'entree dont le href est le prefixe le plus long.
export function activeNavHref(groups: NavGroup[], pathname: string | null): string | null {
  let best: string | null = null;
  for (const item of groups.flatMap((group) => group.items)) {
    if (pathname === item.href || pathname?.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.length) best = item.href;
    }
  }
  return best;
}
