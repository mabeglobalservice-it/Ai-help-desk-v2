"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { activeNavHref, visibleNavGroups } from "@/lib/navigation";
import { useSessionUser } from "@/lib/use-session-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

export function AppSidebar() {
  const pathname = usePathname();
  const user = useSessionUser();
  const { state, isMobile, toggleSidebar, setOpenMobile } = useSidebar();
  const groups = visibleNavGroups(user?.role);
  const activeHref = activeNavHref(groups, pathname);
  const collapsed = state === "collapsed" && !isMobile;

  return (
    <Sidebar collapsible="icon" aria-label="Navigation principale">
      <SidebarHeader className="h-14 flex-row items-center gap-2 border-b border-sidebar-border px-3">
        <Link
          href={groups.length > 0 ? groups[0].items[0].href : "/tickets"}
          className="flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          onClick={() => setOpenMobile(false)}
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary font-heading text-sm font-semibold text-sidebar-primary-foreground"
          >
            A
          </span>
          <span className="truncate font-heading text-base font-semibold text-sidebar-primary group-data-[collapsible=icon]:hidden">
            AI Help Desk
          </span>
        </Link>
        {isMobile ? (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            aria-label="Fermer le menu"
            onClick={() => setOpenMobile(false)}
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="font-mono text-[0.7rem] tracking-[0.12em] text-muted-foreground uppercase">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = item.href === activeHref;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        className="data-active:font-semibold data-active:text-sidebar-primary data-active:shadow-[inset_2px_0_0_var(--sidebar-primary)]"
                        render={
                          <Link
                            href={item.href}
                            aria-current={isActive ? "page" : undefined}
                            onClick={() => setOpenMobile(false)}
                          />
                        }
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {!isMobile ? (
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={toggleSidebar}
                tooltip="Déplier le menu"
                aria-expanded={!collapsed}
                className="text-muted-foreground"
              >
                {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
                <span>{collapsed ? "Déplier le menu" : "Replier le menu"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      ) : null}
      <SidebarRail />
    </Sidebar>
  );
}
