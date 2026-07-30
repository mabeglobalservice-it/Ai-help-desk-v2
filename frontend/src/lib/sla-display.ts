import type { TicketStatus } from "./api";

export type SlaBadgeStatus = "AT_RISK" | "BREACHED";

const AT_RISK_THRESHOLD = 0.25;

export function getSlaBadgeStatus(ticket: {
  slaDueAt: string | null;
  createdAt: string;
  status: TicketStatus;
}): SlaBadgeStatus | null {
  if (!ticket.slaDueAt || ticket.status === "RESOLVED") return null;

  const dueAt = new Date(ticket.slaDueAt).getTime();
  const now = Date.now();
  if (now >= dueAt) return "BREACHED";

  const createdAt = new Date(ticket.createdAt).getTime();
  const totalDuration = dueAt - createdAt;
  if (totalDuration <= 0) return null;

  const remainingRatio = (dueAt - now) / totalDuration;
  return remainingRatio < AT_RISK_THRESHOLD ? "AT_RISK" : null;
}
