"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  decideKnowledgeArticle,
  getPendingKnowledgeArticles,
  type KnowledgeArticle,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

// docs/10-architecture-rag.md §11 "Apprentissage continu" : un résumé
// généré par l'IA à la résolution d'un ticket n'entre dans la base de
// connaissances qu'après validation explicite d'un superviseur ou admin —
// jamais automatiquement, pour éviter de propager une solution incomplète.
export default function KnowledgeArticlesPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [articles, setArticles] = useState<KnowledgeArticle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPrivileged = user?.role === "SUPERVISOR" || user?.role === "ADMIN";

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) return;

    getPendingKnowledgeArticles(token)
      .then((data) => {
        setArticles(data);
        setLoadError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          router.replace("/login");
          return;
        }
        setLoadError("Impossible de charger les articles proposés pour le moment.");
      });
  }, [router]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user && !isPrivileged) return;
    if (!user) return;

    refresh();
  }, [router, user, isPrivileged, refresh]);

  async function handleDecide(id: string, decision: "APPROVED" | "REJECTED") {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setActionError(null);
    setIsSubmitting(true);
    try {
      await decideKnowledgeArticle(token, id, decision);
      refresh();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Impossible d'enregistrer la décision pour le moment.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (user && !isPrivileged) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Articles proposés" />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>Cette page est réservée aux superviseurs et administrateurs.</AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Articles proposés" />

      <main className="mx-auto max-w-3xl px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              Articles en attente d&apos;approbation{articles ? ` (${articles.length})` : ""}
            </CardTitle>
            <CardDescription>
              Résumés générés par l&apos;IA à la résolution d&apos;un ticket — n&apos;entrent dans la
              base de connaissances qu&apos;après validation.
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
            ) : articles === null ? (
              <p className="text-sm text-muted-foreground">Chargement des articles...</p>
            ) : articles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun article en attente d&apos;approbation.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {articles.map((article) => (
                  <li key={article.id} className="rounded-md border border-border p-4">
                    <p className="font-medium">{article.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {article.ticket
                        ? `Ticket source : ${article.ticket.reference} — ${article.ticket.title}`
                        : "Source : résolution automatique (UC-015, sans ticket)"}
                    </p>
                    <p className="mt-2 text-sm whitespace-pre-wrap">{article.content}</p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        className="flex-1"
                        disabled={isSubmitting}
                        onClick={() => handleDecide(article.id, "APPROVED")}
                      >
                        Approuver
                      </Button>
                      <Button
                        className="flex-1"
                        variant="outline"
                        disabled={isSubmitting}
                        onClick={() => handleDecide(article.id, "REJECTED")}
                      >
                        Rejeter
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
