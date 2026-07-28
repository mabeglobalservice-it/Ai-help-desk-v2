"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError, getTicket, type TicketDetail } from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { STATUS_DISPLAY, priorityDotClass } from "@/lib/ticket-display";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

const dateFormatter = new Intl.DateTimeFormat("fr-CA", {
  dateStyle: "medium",
  timeStyle: "short",
});

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

export default function TicketDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    getTicket(token, params.id)
      .then(setTicket)
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearSession();
          router.replace("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        setError("Impossible de charger ce ticket pour le moment.");
      });
  }, [router, params.id]);

  const backLink = (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/tickets" />}>
      Retour aux tickets
    </Button>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title={ticket ? ticket.reference : "Ticket"} action={backLink} />

      <main className="mx-auto max-w-2xl px-6 py-8">
        {notFound ? (
          <Alert>
            <AlertDescription>
              Ce ticket n&apos;existe pas ou a été supprimé. Retournez à la liste pour consulter les
              tickets existants.
            </AlertDescription>
          </Alert>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : ticket === null ? (
          <p className="text-sm text-muted-foreground">Chargement du ticket...</p>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <CardTitle className="text-xl">{ticket.title}</CardTitle>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-sm">
                    <span className={`size-1.5 rounded-full ${STATUS_DISPLAY[ticket.status].dot}`} />
                    {STATUS_DISPLAY[ticket.status].label}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <dt className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">
                    Description
                  </dt>
                  <dd className="mt-1 text-sm whitespace-pre-wrap">
                    {ticket.summary || <span className="text-muted-foreground">Aucune description fournie.</span>}
                  </dd>
                </div>

                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <Field label="Référence">
                    <span className="font-mono text-xs">{ticket.reference}</span>
                  </Field>
                  <Field label="Catégorie">{ticket.category.name}</Field>
                  <Field label="Priorité">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`size-1.5 rounded-full ${priorityDotClass(ticket.priority.level)}`} />
                      {ticket.priority.name}
                    </span>
                  </Field>
                  <Field label="Employé">
                    {ticket.employee.displayName}
                    <span className="block text-xs text-muted-foreground">{ticket.employee.email}</span>
                  </Field>
                  <Field label="Technicien assigné">
                    {ticket.technician ? (
                      <>
                        {ticket.technician.displayName}
                        <span className="block text-xs text-muted-foreground">{ticket.technician.email}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Non assigné</span>
                    )}
                  </Field>
                  <Field label="Créé le">{dateFormatter.format(new Date(ticket.createdAt))}</Field>
                  <Field label="Résolu le">
                    {ticket.resolvedAt ? (
                      dateFormatter.format(new Date(ticket.resolvedAt))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Field>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Historique de statut</CardTitle>
              </CardHeader>
              <CardContent>
                {ticket.statusHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun changement de statut enregistré.</p>
                ) : (
                  <ul className="space-y-3">
                    {ticket.statusHistory.map((entry) => (
                      <li key={entry.id} className="flex items-center justify-between text-sm">
                        <span>
                          {entry.fromStatus ? STATUS_DISPLAY[entry.fromStatus].label : "—"}
                          {" → "}
                          {STATUS_DISPLAY[entry.toStatus].label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {dateFormatter.format(new Date(entry.changedAt))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
