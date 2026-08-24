import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, message, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 py-10 text-center", className)}>
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
