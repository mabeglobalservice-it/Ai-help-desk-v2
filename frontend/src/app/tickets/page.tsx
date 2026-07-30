"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getPriorities,
  getTicketCategories,
  getTickets,
  type Priority,
  type Ticket,
  type TicketCategory,
  type TicketStatus,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { STATUS_DISPLAY, priorityDotClass } from "@/lib/ticket-display";
import { AppHeader } from "@/components/app-header";
import { SlaBadge } from "@/components/sla-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

const dateFormatter = new Intl.DateTimeFormat("fr-CA", {
  dateStyle: "medium",
  timeStyle: "short",
});

const ALL_STATUSES = Object.keys(STATUS_DISPLAY) as TicketStatus[];
const ALL = "ALL";

export default function TicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const user = useSessionUser();

  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | typeof ALL>(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [priorityFilter, setPriorityFilter] = useState(ALL);
  const [myTicketsOnly, setMyTicketsOnly] = useState(false);

  const hasActiveFilter =
    statusFilter !== ALL || categoryFilter !== ALL || priorityFilter !== ALL || myTicketsOnly;

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    Promise.all([getTicketCategories(token), getPriorities(token)])
      .then(([categoryList, priorityList]) => {
        setCategories(categoryList);
        setPriorities(priorityList);
      })
      .catch(() => {
        // best-effort: filter dropdowns just stay empty if this fails
      });
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    getTickets(token, {
      status: statusFilter === ALL ? undefined : statusFilter,
      categoryId: categoryFilter === ALL ? undefined : categoryFilter,
      priorityId: priorityFilter === ALL ? undefined : priorityFilter,
      technicianId: myTicketsOnly && user ? user.id : undefined,
    })
      .then((data) => {
        setTickets(data);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearSession();
          router.replace("/login");
          return;
        }
        setError("Impossible de charger les tickets pour le moment.");
      });
  }, [router, statusFilter, categoryFilter, priorityFilter, myTicketsOnly, user]);

  function resetFilters() {
    setStatusFilter(ALL);
    setCategoryFilter(ALL);
    setPriorityFilter(ALL);
    setMyTicketsOnly(false);
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title="Tickets"
        action={
          user?.role === "EMPLOYEE" ? (
            <Button size="sm" nativeButton={false} render={<Link href="/tickets/new" />}>
              Nouveau ticket
            </Button>
          ) : undefined
        }
      />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-status">Statut</Label>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as TicketStatus | typeof ALL)}
            >
              <SelectTrigger id="filter-status" className="w-40">
                <SelectValue placeholder="Tous les statuts">
                  {(value: string | null) =>
                    value && value !== ALL ? STATUS_DISPLAY[value as TicketStatus].label : "Tous les statuts"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les statuts</SelectItem>
                {ALL_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_DISPLAY[status].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-category">Catégorie</Label>
            <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value ?? ALL)}>
              <SelectTrigger id="filter-category" className="w-44">
                <SelectValue placeholder="Toutes les catégories">
                  {(value: string | null) =>
                    value && value !== ALL
                      ? (categories.find((category) => category.id === value)?.name ?? "Toutes les catégories")
                      : "Toutes les catégories"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes les catégories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-priority">Priorité</Label>
            <Select value={priorityFilter} onValueChange={(value) => setPriorityFilter(value ?? ALL)}>
              <SelectTrigger id="filter-priority" className="w-40">
                <SelectValue placeholder="Toutes les priorités">
                  {(value: string | null) =>
                    value && value !== ALL
                      ? (priorities.find((priority) => priority.id === value)?.name ?? "Toutes les priorités")
                      : "Toutes les priorités"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes les priorités</SelectItem>
                {priorities.map((priority) => (
                  <SelectItem key={priority.id} value={priority.id}>
                    {priority.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {user?.role === "TECHNICIAN" ? (
            <div className="flex flex-col gap-1.5">
              <span aria-hidden className="invisible text-sm font-medium">
                Mes tickets
              </span>
              <Button
                type="button"
                variant={myTicketsOnly ? "default" : "outline"}
                size="sm"
                aria-pressed={myTicketsOnly}
                onClick={() => setMyTicketsOnly((prev) => !prev)}
              >
                Mes tickets
              </Button>
            </div>
          ) : null}

          {hasActiveFilter ? (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Réinitialiser
            </Button>
          ) : null}
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : tickets === null ? (
          <p className="text-sm text-muted-foreground">Chargement des tickets...</p>
        ) : tickets.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-16 text-center">
            <p className="font-medium">
              {hasActiveFilter ? "Aucun ticket ne correspond à ces filtres." : "Aucun ticket pour le moment."}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasActiveFilter
                ? "Essayez de réinitialiser les filtres."
                : user?.role === "EMPLOYEE"
                  ? "Créez votre premier ticket pour démarrer."
                  : "Les nouveaux tickets créés apparaîtront ici."}
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
                  <TableHead>SLA</TableHead>
                  <TableHead>Employé</TableHead>
                  <TableHead>Créé le</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Voir le ticket ${ticket.reference}`}
                    className="cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                    onClick={() => router.push(`/tickets/${ticket.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(`/tickets/${ticket.id}`);
                      }
                    }}
                  >
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
                    <TableCell>
                      <SlaBadge slaDueAt={ticket.slaDueAt} createdAt={ticket.createdAt} status={ticket.status} />
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
