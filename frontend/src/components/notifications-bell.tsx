"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { getNotifications, markNotificationAsRead, type Notification } from "@/lib/api";
import { getToken } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const dateFormatter = new Intl.DateTimeFormat("fr-CA", {
  dateStyle: "short",
  timeStyle: "short",
});

const POLL_INTERVAL_MS = 30_000;

export function NotificationsBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) return;

    getNotifications(token)
      .then(setNotifications)
      .catch(() => {
        // silent: a transient failure here shouldn't break the rest of the page
      });
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleSelect(notification: Notification) {
    if (!notification.isRead) {
      const token = getToken();
      if (token) {
        try {
          await markNotificationAsRead(token, notification.id);
          setNotifications((prev) =>
            prev.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item)),
          );
        } catch {
          // best-effort
        }
      }
    }

    if (notification.ticketId) {
      router.push(`/tickets/${notification.ticketId}`);
    }
  }

  const unreadCount = notifications.filter((notification) => !notification.isRead).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <Bell className="size-4" />
        {unreadCount > 0 ? (
          <Badge className="absolute -top-1 -right-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        ) : null}
        <span className="sr-only">Notifications{unreadCount > 0 ? ` (${unreadCount} non lues)` : ""}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <p className="px-1.5 py-1 text-xs font-medium text-muted-foreground">Notifications</p>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <p className="px-1.5 py-3 text-center text-sm text-muted-foreground">Aucune notification.</p>
        ) : (
          notifications.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              onClick={() => handleSelect(notification)}
              className="flex-col items-start gap-0.5 whitespace-normal"
            >
              <span className={`flex items-center gap-1.5 text-sm ${notification.isRead ? "" : "font-medium"}`}>
                {!notification.isRead ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                {notification.message}
              </span>
              <span className="text-xs text-muted-foreground">
                {dateFormatter.format(new Date(notification.createdAt))}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
