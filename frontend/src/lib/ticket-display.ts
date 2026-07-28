import type { TicketStatus } from "./api";

export const STATUS_DISPLAY: Record<TicketStatus, { label: string; dot: string }> = {
  NEW: { label: "Nouveau", dot: "bg-signal-slate" },
  IN_PROGRESS: { label: "En cours", dot: "bg-signal-amber" },
  RESOLVED: { label: "Résolu", dot: "bg-signal-moss" },
  ESCALATED: { label: "Escaladé", dot: "bg-signal-rust" },
};

export function priorityDotClass(level: number) {
  if (level >= 3) return "bg-signal-rust";
  if (level === 2) return "bg-signal-amber";
  return "bg-signal-slate";
}
