import { Badge } from "@/components/ui/badge";
import { getSlaBadgeStatus } from "@/lib/sla-display";
import type { TicketStatus } from "@/lib/api";

interface SlaBadgeProps {
  slaDueAt: string | null;
  createdAt: string;
  status: TicketStatus;
}

export function SlaBadge({ slaDueAt, createdAt, status }: SlaBadgeProps) {
  const slaStatus = getSlaBadgeStatus({ slaDueAt, createdAt, status });
  if (!slaStatus) return null;

  if (slaStatus === "BREACHED") {
    return <Badge variant="destructive">SLA dépassé</Badge>;
  }

  return <Badge className="bg-signal-amber/15 text-signal-amber">SLA proche</Badge>;
}
