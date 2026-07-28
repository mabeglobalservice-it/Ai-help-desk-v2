"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError,
  createComment,
  getComments,
  getTicket,
  type TicketComment,
  type TicketDetail,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { STATUS_DISPLAY, priorityDotClass } from "@/lib/ticket-display";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  const user = useSessionUser();

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [comments, setComments] = useState<TicketComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [newComment, setNewComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    Promise.all([getTicket(token, params.id), getComments(token, params.id)])
      .then(([ticketData, commentsData]) => {
        setTicket(ticketData);
        setComments(commentsData);
      })
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

  async function handleAddComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setCommentError(null);
    setIsSubmittingComment(true);

    try {
      const comment = await createComment(token, params.id, newComment);
      setComments((prev) => (prev ? [...prev, comment] : [comment]));
      setNewComment("");
    } catch (err) {
      setCommentError(
        err instanceof ApiError ? err.message : "Impossible d'ajouter le commentaire pour le moment.",
      );
    } finally {
      setIsSubmittingComment(false);
    }
  }

  const canComment = !!(
    user &&
    ticket &&
    (ticket.employee.id === user.id ||
      ticket.technician?.id === user.id ||
      user.role === "SUPERVISOR" ||
      user.role === "ADMIN")
  );

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
                <CardTitle className="text-base">Commentaires</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {comments === null ? (
                  <p className="text-sm text-muted-foreground">Chargement des commentaires...</p>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun commentaire pour le moment.</p>
                ) : (
                  <ul className="space-y-4">
                    {comments.map((comment) => (
                      <li key={comment.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="text-sm font-medium">{comment.author.displayName}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {dateFormatter.format(new Date(comment.createdAt))}
                          </span>
                        </div>
                        <p className="mt-1 text-sm whitespace-pre-wrap">{comment.content}</p>
                      </li>
                    ))}
                  </ul>
                )}

                {canComment ? (
                  <form
                    onSubmit={handleAddComment}
                    className="space-y-2 border-t border-border pt-4"
                  >
                    <Label htmlFor="new-comment" className="sr-only">
                      Ajouter un commentaire
                    </Label>
                    <Textarea
                      id="new-comment"
                      value={newComment}
                      onChange={(event) => setNewComment(event.target.value)}
                      placeholder="Ajouter un commentaire..."
                      rows={3}
                      required
                    />
                    {commentError ? (
                      <Alert variant="destructive">
                        <AlertDescription>{commentError}</AlertDescription>
                      </Alert>
                    ) : null}
                    <Button type="submit" size="sm" disabled={isSubmittingComment || !newComment.trim()}>
                      {isSubmittingComment ? "Envoi..." : "Ajouter"}
                    </Button>
                  </form>
                ) : null}
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
