"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  decideApproval,
  getPendingApprovals,
  type PendingApproval,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { useRealtimeEvent } from "@/lib/use-realtime-event";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

const dateFormatter = new Intl.DateTimeFormat("fr-CA", {
  dateStyle: "medium",
  timeStyle: "short",
});

// docs/12-maquettes-ui-ux.md §4.4: "File d'approbation" — Superviseur ou
// Technicien habilité (docs/06-cas-utilisation.md UC-022). Un TECHNICIAN
// non habilité reçoit un 403 de l'API ; on affiche alors le même message
// que les autres pages admin réservées à un rôle non détenu.
export default function AutomationApprovalsPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [approvals, setApprovals] = useState<PendingApproval[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const eligibleRole = user?.role === "SUPERVISOR" || user?.role === "ADMIN" || user?.role === "TECHNICIAN";

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) return;

    getPendingApprovals(token)
      .then((data) => {
        setApprovals(data);
        setForbidden(false);
        setLoadError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          router.replace("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          return;
        }
        setLoadError("Impossible de charger les approbations en attente pour le moment.");
      });
  }, [router]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!user) return;
    refresh();
  }, [router, user, refresh]);

  useRealtimeEvent("approval.requested", refresh);

  async function handleDecide(approvalId: string, decision: "APPROVED" | "REJECTED", decisionNote?: string) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setActionError(null);
    setIsSubmitting(true);
    try {
      await decideApproval(token, approvalId, decision, decisionNote);
      setRejectingId(null);
      setNote("");
      refresh();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Impossible d'enregistrer la décision pour le moment.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (user && !eligibleRole) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Approbations" />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>
              Cette page est réservée aux superviseurs, administrateurs et techniciens habilités.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Approbations" />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>
              Vous n&apos;êtes pas habilité à approuver les actions sensibles. Un administrateur peut vous
              accorder ce droit depuis la gestion des utilisateurs.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Approbations" />

      <main className="mx-auto max-w-3xl px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              Actions en attente d&apos;approbation{approvals ? ` (${approvals.length})` : ""}
            </CardTitle>
            <CardDescription>
              Lisez toujours la justification avant d&apos;approuver — une action sensible ne peut pas être
              annulée après exécution.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {actionError ? (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            ) : null}
            {loadError ? (
              <Alert variant="destructive">
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            ) : approvals === null ? (
              <p className="text-sm text-muted-foreground">Chargement des approbations...</p>
            ) : approvals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune action en attente d&apos;approbation.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {approvals.map((approval) => {
                  const run = approval.automationRun;
                  return (
                    <li key={approval.id} className="rounded-md border border-border p-4">
                      <p className="flex items-center gap-2 font-medium">
                        <span aria-hidden className="text-signal-amber">⚠</span>
                        {run.script.name}
                      </p>
                      {run.ticket ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Ticket : {run.ticket.reference} — {run.ticket.title}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm text-muted-foreground">
                        Demandé par : {run.requestedBy.displayName} ({dateFormatter.format(new Date(run.createdAt))})
                      </p>
                      <p className="mt-2 text-sm">
                        Justification : « {run.justification} »
                      </p>

                      {rejectingId === approval.id ? (
                        <div className="mt-3 flex flex-col gap-2">
                          <Textarea
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            placeholder="Motif du rejet (optionnel)"
                            rows={2}
                          />
                          <div className="flex gap-2">
                            <Button
                              variant="destructive"
                              disabled={isSubmitting}
                              onClick={() => handleDecide(approval.id, "REJECTED", note || undefined)}
                            >
                              Confirmer le rejet
                            </Button>
                            <Button
                              variant="outline"
                              disabled={isSubmitting}
                              onClick={() => {
                                setRejectingId(null);
                                setNote("");
                              }}
                            >
                              Annuler
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex gap-2">
                          <Button
                            className="flex-1"
                            disabled={isSubmitting}
                            onClick={() => handleDecide(approval.id, "APPROVED")}
                          >
                            Approuver
                          </Button>
                          <Button
                            className="flex-1"
                            variant="outline"
                            disabled={isSubmitting}
                            onClick={() => setRejectingId(approval.id)}
                          >
                            Rejeter
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
