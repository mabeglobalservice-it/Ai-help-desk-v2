"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  aiDiagnoseTicket,
  ApiError,
  createTicket,
  getPriorities,
  getTicketCategories,
  type Priority,
  type TicketCategory,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function NewTicketPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [categories, setCategories] = useState<TicketCategory[] | null>(null);
  const [priorities, setPriorities] = useState<Priority[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priorityId, setPriorityId] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [aiError, setAiError] = useState<string | null>(null);
  const [aiDegraded, setAiDegraded] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user?.role !== "EMPLOYEE") return;

    Promise.all([getTicketCategories(token), getPriorities(token)])
      .then(([categoryList, priorityList]) => {
        setCategories(categoryList);
        setPriorities(priorityList);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearSession();
          router.replace("/login");
          return;
        }
        setLoadError("Impossible de charger le formulaire pour le moment.");
      });
  }, [router, user?.role]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getToken();
    if (!token || !user) {
      router.replace("/login");
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      await createTicket(token, {
        employeeId: user.id,
        categoryId,
        priorityId,
        title,
        summary: summary || undefined,
      });
      router.push("/tickets");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Impossible de créer le ticket pour le moment.");
      setIsSubmitting(false);
    }
  }

  async function handleAnalyze() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setAiError(null);
    setAiDegraded(false);
    setIsAnalyzing(true);

    try {
      const diagnosis = await aiDiagnoseTicket(token, summary);
      setTitle(diagnosis.title);
      setCategoryId(diagnosis.categoryId);
      setPriorityId(diagnosis.priorityId);
      setAiDegraded(diagnosis.degraded);
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : "Impossible d'analyser la description pour le moment.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  const backLink = (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/tickets" />}>
      Retour aux tickets
    </Button>
  );

  if (user && user.role !== "EMPLOYEE") {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Nouveau ticket" action={backLink} />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>
              Seul le rôle EMPLOYEE peut créer un ticket. Retournez à la liste pour consulter les
              tickets existants.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Nouveau ticket" action={backLink} />

      <main className="mx-auto max-w-lg px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Décrire le problème</CardTitle>
            <CardDescription>
              Un technicien prendra en charge votre ticket selon sa priorité.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadError ? (
              <Alert variant="destructive">
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            ) : categories === null || priorities === null ? (
              <p className="text-sm text-muted-foreground">Chargement du formulaire...</p>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                <div className="space-y-2">
                  <Label htmlFor="title">Titre</Label>
                  <Input
                    id="title"
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Ex. L'écran ne s'allume plus"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="summary">Description</Label>
                  <Textarea
                    id="summary"
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                    placeholder="Décrivez le problème, ce que vous avez déjà essayé..."
                    rows={4}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || summary.trim().length < 10}
                  >
                    {isAnalyzing ? "Analyse en cours..." : "Analyser avec l'IA"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Suggère automatiquement un titre, une catégorie et une priorité à partir de votre
                    description. Vous pourrez toujours les modifier avant d&apos;envoyer.
                  </p>
                  {aiError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{aiError}</AlertDescription>
                    </Alert>
                  ) : null}
                  {aiDegraded ? (
                    <Alert>
                      <AlertDescription>
                        L&apos;IA n&apos;est pas disponible pour le moment : suggestion générée en mode
                        dégradé à partir de mots-clés. Vérifiez les valeurs avant d&apos;envoyer.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Catégorie</Label>
                  <Select value={categoryId} onValueChange={(value) => setCategoryId(value as string)}>
                    <SelectTrigger id="category" className="w-full">
                      <SelectValue placeholder="Choisir une catégorie">
                        {(value: string | null) =>
                          categories.find((category) => category.id === value)?.name ??
                          "Choisir une catégorie"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="priority">Priorité</Label>
                  <Select value={priorityId} onValueChange={(value) => setPriorityId(value as string)}>
                    <SelectTrigger id="priority" className="w-full">
                      <SelectValue placeholder="Choisir une priorité">
                        {(value: string | null) =>
                          priorities.find((priority) => priority.id === value)?.name ??
                          "Choisir une priorité"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {priorities.map((priority) => (
                        <SelectItem key={priority.id} value={priority.id}>
                          {priority.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {submitError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{submitError}</AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting || !categoryId || !priorityId}
                >
                  {isSubmitting ? "Création..." : "Créer le ticket"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
