import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
  // Explication ou piste d'action, affichee sous le message.
  description?: string;
  // Action suggeree (lien ou bouton).
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, message, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 py-10 text-center", className)}>
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      {/* Sans description, rendu inchange pour les pages existantes. */}
      <p className={cn("text-sm", description ? "font-medium text-foreground" : "text-muted-foreground")}>
        {message}
      </p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
