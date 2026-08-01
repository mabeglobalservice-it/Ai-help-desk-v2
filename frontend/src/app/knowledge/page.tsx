"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  searchKnowledge,
  type KnowledgeSearchResult,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

const dateFormatter = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" });

const KNOWLEDGE_ROLES = new Set(["TECHNICIAN", "SUPERVISOR", "ADMIN"]);

// ts_headline (backend) wraps matched terms in `**...**`; render them as
// <mark> instead of raw asterisks, without ever using dangerouslySetInnerHTML
// — the surrounding text stays plain React text, so it's auto-escaped no
// matter what an employee typed into the original ticket.
function Snippet({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <p className="text-sm text-muted-foreground">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-900">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  );
}

export default function KnowledgePage() {
  const router = useRouter();
  const user = useSessionUser();

  const [q, setQ] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const isAllowed = user?.role ? KNOWLEDGE_ROLES.has(user.role) : undefined;

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (q.trim().length < 2) {
      setSearchError("Entrez au moins 2 caractères pour lancer une recherche.");
      return;
    }

    setSearchError(null);
    setIsSearching(true);
    try {
      const data = await searchKnowledge(token, q.trim());
      setResults(data);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearSession();
        router.replace("/login");
        return;
      }
      setSearchError(
        err instanceof ApiError ? err.message : "Impossible de rechercher pour le moment.",
      );
    } finally {
      setIsSearching(false);
    }
  }

  if (user && !isAllowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Base de connaissances" />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>
              Cette page est réservée aux techniciens, superviseurs et administrateurs.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Base de connaissances" />

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                Rechercher parmi les tickets résolus et les articles de connaissance
              </CardTitle>
              <CardDescription>
                Retrouvez une résolution déjà appliquée à un problème similaire (US-26), ou un
                article rédigé à partir d&apos;un ticket résolu et approuvé par un superviseur.
                Recherche plein texte — pas encore une recherche sémantique par embeddings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {searchError ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{searchError}</AlertDescription>
                </Alert>
              ) : null}
              <form className="flex gap-2" onSubmit={handleSearch} noValidate>
                <Input
                  aria-label="Recherche"
                  placeholder="Ex. imprimante réseau ne répond plus"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                />
                <Button type="submit" disabled={isSearching}>
                  {isSearching ? "Recherche..." : "Rechercher"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {results !== null ? (
            results.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun ticket résolu ou article ne correspond à cette recherche.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {results.map((result) => (
                  <Card key={`${result.sourceType}-${result.id}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2">
                          {result.sourceType === "ARTICLE" ? (
                            <Badge variant="secondary">Article</Badge>
                          ) : null}
                          <CardTitle className="text-base">{result.title}</CardTitle>
                        </div>
                        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {result.reference}
                        </span>
                      </div>
                      <CardDescription>
                        {result.categoryName} · {result.priorityName}
                        {result.resolvedAt
                          ? ` · Résolu le ${dateFormatter.format(new Date(result.resolvedAt))}`
                          : null}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Snippet text={result.snippet} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          ) : null}
        </div>
      </main>
    </div>
  );
}
