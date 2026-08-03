"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  searchKnowledge,
  type KnowledgeSearchResult,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const dateFormatter = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" });

// docs/10-architecture-rag.md §10 : un EMPLOYEE n'a accès qu'au niveau 1
// (public) mais peut chercher ; TECHNICIAN/SUPERVISOR niveaux 1-4 + ses
// propres notes (5) ; ADMIN tout.
const KNOWLEDGE_ROLES = new Set(["EMPLOYEE", "TECHNICIAN", "SUPERVISOR", "ADMIN"]);
const UPLOAD_ROLES = new Set(["TECHNICIAN", "ADMIN"]);

const LEVEL_LABELS: Record<number, string> = {
  1: "Public",
  2: "Interne",
  3: "Ticket résolu",
  4: "Automatisation",
  5: "Personnel",
};

const UPLOAD_LEVEL_LABELS: Record<string, string> = {
  "1": "Public / constructeur",
  "2": "Interne",
  "4": "Automatisation",
};

const SOURCE_LABELS: Record<KnowledgeSearchResult["sourceType"], string> = {
  TICKET: "Ticket",
  ARTICLE: "Article",
  SCRIPT: "Script",
  DOCUMENT: "Document",
};

// ts_headline (backend) et le surlignage de snippet côté service enveloppent
// les termes trouvés dans `**...**` ; on les rend en <mark> plutôt qu'en
// astérisques bruts, sans jamais utiliser dangerouslySetInnerHTML — le texte
// autour reste du texte React normal, donc auto-échappé quel que soit le
// contenu original.
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadLevel, setUploadLevel] = useState<"1" | "2" | "4">("2");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const isAllowed = user?.role ? KNOWLEDGE_ROLES.has(user.role) : undefined;
  const canUpload = user?.role ? UPLOAD_ROLES.has(user.role) : false;
  const isAdmin = user?.role === "ADMIN";

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

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (uploadTitle.trim().length === 0 || uploadContent.trim().length < 10) {
      setUploadError("Titre et contenu (au moins 10 caractères) requis.");
      return;
    }

    setUploadError(null);
    setUploadSuccess(null);
    setIsUploading(true);
    try {
      await createKnowledgeDocument(token, {
        title: uploadTitle.trim(),
        content: uploadContent.trim(),
        ...(isAdmin ? { knowledgeLevel: Number(uploadLevel) as 1 | 2 | 4 } : {}),
      });
      setUploadSuccess("Document ajouté à la base de connaissances.");
      setUploadTitle("");
      setUploadContent("");
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : "Impossible d'ajouter ce document pour le moment.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(id: string) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setDeletingId(id);
    try {
      await deleteKnowledgeDocument(token, id);
      setResults((current) => current?.filter((r) => r.id !== id) ?? current);
    } catch {
      setSearchError("Impossible de retirer ce document pour le moment.");
    } finally {
      setDeletingId(null);
    }
  }

  if (user && !isAllowed) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Base de connaissances" />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>Cette page est réservée aux utilisateurs connectés.</AlertDescription>
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
                Rechercher dans les 5 niveaux de connaissance
              </CardTitle>
              <CardDescription>
                Documents publics/internes, tickets résolus, articles approuvés, scripts
                d&apos;automatisation, et vos notes personnelles (docs/10-architecture-rag.md §13).
                Recherche hybride (embedding + recouvrement lexical) filtrée selon votre rôle.
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
                Aucun résultat accessible à votre rôle pour cette recherche.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {results.map((result) => {
                  const canDelete =
                    result.sourceType === "DOCUMENT" && (isAdmin || result.knowledgeLevel === 5);
                  return (
                    <Card key={`${result.sourceType}-${result.id}`}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{SOURCE_LABELS[result.sourceType]}</Badge>
                            <Badge variant="outline">{LEVEL_LABELS[result.knowledgeLevel]}</Badge>
                            <CardTitle className="text-base">{result.title}</CardTitle>
                          </div>
                          {result.reference ? (
                            <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                              {result.reference}
                            </span>
                          ) : null}
                        </div>
                        {result.categoryName || result.priorityName || result.resolvedAt ? (
                          <CardDescription>
                            {[result.categoryName, result.priorityName].filter(Boolean).join(" · ")}
                            {result.resolvedAt
                              ? ` · Résolu le ${dateFormatter.format(new Date(result.resolvedAt))}`
                              : null}
                          </CardDescription>
                        ) : null}
                      </CardHeader>
                      <CardContent>
                        <Snippet text={result.snippet} />
                        {canDelete ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            disabled={deletingId === result.id}
                            onClick={() => handleDelete(result.id)}
                          >
                            {deletingId === result.id ? "..." : "Retirer de l'index"}
                          </Button>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )
          ) : null}

          {canUpload ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Ajouter un document</CardTitle>
                <CardDescription>
                  {isAdmin
                    ? "docs/11 §7 : niveau public, interne ou automatisation."
                    : "docs/11 §7 : enregistré comme note personnelle (niveau 5), visible de vous seul."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {uploadError ? (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>{uploadError}</AlertDescription>
                  </Alert>
                ) : null}
                {uploadSuccess ? (
                  <Alert className="mb-4">
                    <AlertDescription>{uploadSuccess}</AlertDescription>
                  </Alert>
                ) : null}
                <form className="flex flex-col gap-3" onSubmit={handleUpload} noValidate>
                  <Input
                    aria-label="Titre"
                    placeholder="Titre du document"
                    value={uploadTitle}
                    onChange={(event) => setUploadTitle(event.target.value)}
                  />
                  <Textarea
                    aria-label="Contenu"
                    placeholder="Contenu (procédure, note, script...)"
                    rows={5}
                    value={uploadContent}
                    onChange={(event) => setUploadContent(event.target.value)}
                  />
                  {isAdmin ? (
                    <Select
                      value={uploadLevel}
                      onValueChange={(value) => setUploadLevel(value as "1" | "2" | "4")}
                    >
                      <SelectTrigger aria-label="Niveau de connaissance">
                        <SelectValue placeholder="Niveau">
                          {(value: string | null) => UPLOAD_LEVEL_LABELS[value ?? ""] ?? "Niveau"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Public / constructeur</SelectItem>
                        <SelectItem value="2">Interne</SelectItem>
                        <SelectItem value="4">Automatisation</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Button type="submit" disabled={isUploading} className="self-start">
                    {isUploading ? "Ajout..." : "Ajouter"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </main>
    </div>
  );
}
