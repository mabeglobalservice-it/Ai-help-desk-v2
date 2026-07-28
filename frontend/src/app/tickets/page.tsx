"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getTickets, type Ticket, type TicketStatus } from "@/lib/api";
import { clearSession, getSessionUser, getToken } from "@/lib/session";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

const STATUS_DISPLAY: Record<TicketStatus, { label: string; dot: string }> = {
  NEW: { label: "Nouveau", dot: "bg-signal-slate" },
  IN_PROGRESS: { label: "En cours", dot: "bg-signal-amber" },
  RESOLVED: { label: "Résolu", dot: "bg-signal-moss" },
  ESCALATED: { label: "Escaladé", dot: "bg-signal-rust" },
};

function priorityDotClass(level: number) {
  if (level >= 3) return "bg-signal-rust";
  if (level === 2) return "bg-signal-amber";
  return "bg-signal-slate";
}

const dateFormatter = new Intl.DateTimeFormat("fr-CA", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function TicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const user = getSessionUser();

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    getTickets(token)
      .then(setTickets)
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearSession();
          router.replace("/login");
          return;
        }
        setError("Impossible de charger les tickets pour le moment.");
      });
  }, [router]);

  function handleSignOut() {
    clearSession();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="font-mono text-xs tracking-[0.25em] text-muted-foreground">SYSTÈME</p>
            <h1 className="text-lg font-semibold tracking-tight">Tickets</h1>
          </div>
          <div className="flex items-center gap-4">
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

      <main className="mx-auto max-w-5xl px-6 py-8">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : tickets === null ? (
          <p className="text-sm text-muted-foreground">Chargement des tickets...</p>
        ) : tickets.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-16 text-center">
            <p className="font-medium">Aucun ticket pour le moment.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Les nouveaux tickets créés apparaîtront ici.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Titre</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Priorité</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Employé</TableHead>
                  <TableHead>Créé le</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-mono text-xs">{ticket.reference}</TableCell>
                    <TableCell className="max-w-64 truncate font-medium">{ticket.title}</TableCell>
                    <TableCell className="text-muted-foreground">{ticket.category.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span className={`size-1.5 rounded-full ${priorityDotClass(ticket.priority.level)}`} />
                        {ticket.priority.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span className={`size-1.5 rounded-full ${STATUS_DISPLAY[ticket.status].dot}`} />
                        {STATUS_DISPLAY[ticket.status].label}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{ticket.employee.displayName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateFormatter.format(new Date(ticket.createdAt))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}
