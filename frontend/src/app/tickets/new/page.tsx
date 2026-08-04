"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  aiDiagnoseTicket,
  ApiError,
  confirmAutoResolution,
  createTicket,
  getConfigurationItems,
  getPriorities,
  getTicketCategories,
  proposeAutoResolution,
  resolveDiagnosticConversation,
  startOrContinueDiagnostic,
  type AutoResolveProposal,
  type ConfigurationItem,
  type ConversationalDiagnosis,
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

const NO_CI = "NONE";

export default function NewTicketPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [categories, setCategories] = useState<TicketCategory[] | null>(null);
  const [priorities, setPriorities] = useState<Priority[] | null>(null);
  const [configurationItems, setConfigurationItems] = useState<ConfigurationItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priorityId, setPriorityId] = useState("");
  const [ciId, setCiId] = useState(NO_CI);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [aiError, setAiError] = useState<string | null>(null);
  const [aiDegraded, setAiDegraded] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // docs/02-brd.md BR-07 : suggestion IA figée au moment du diagnostic —
  // ne suit PAS categoryId/priorityId si l'employé modifie ensuite les
  // listes déroulantes, pour que la comparaison finale reflète une vraie
  // correction manuelle.
  const [aiSuggestedCategoryId, setAiSuggestedCategoryId] = useState<string | null>(null);
  const [aiSuggestedPriorityId, setAiSuggestedPriorityId] = useState<string | null>(null);

  // docs/06-cas-utilisation.md UC-015 ("Résolution automatique")
  const [autoResolveProposal, setAutoResolveProposal] = useState<AutoResolveProposal | null>(null);
  const [isConfirmingAutoResolve, setIsConfirmingAutoResolve] = useState(false);
  const [autoResolveError, setAutoResolveError] = useState<string | null>(null);
  const [autoResolveOutcome, setAutoResolveOutcome] = useState<
    { status: "RESOLVED" } | { status: "FAILED_FALLBACK"; ticketId: string } | null
  >(null);

  // docs/06-cas-utilisation.md UC-001 étapes 1-6, docs/09-architecture-
  // agents-ia.md §3.2 (Agent Help Desk) : dialogue multi-tour, avant toute
  // création de ticket (US-01/US-02/US-03).
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "agent"; content: string }[]>(
    [],
  );
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatDiagnosis, setChatDiagnosis] = useState<ConversationalDiagnosis | null>(null);
  const [chatResolved, setChatResolved] = useState(false);
  const [isChatResolving, setIsChatResolving] = useState(false);
  // conversationId to link when the employee confirms the problem persists
  // (US-03) — passed through to POST /tickets so the conversation escalates.
  const [linkedConversationId, setLinkedConversationId] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user?.role !== "EMPLOYEE") return;

    Promise.all([getTicketCategories(token), getPriorities(token), getConfigurationItems(token)])
      .then(([categoryList, priorityList, ciList]) => {
        setCategories(categoryList);
        setPriorities(priorityList);
        setConfigurationItems(ciList);
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
        categoryId,
        priorityId,
        title,
        summary: summary || undefined,
        ciId: ciId === NO_CI ? undefined : ciId,
        conversationId: linkedConversationId ?? undefined,
        aiSuggestedCategoryId: aiSuggestedCategoryId ?? undefined,
        aiSuggestedPriorityId: aiSuggestedPriorityId ?? undefined,
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
    setAutoResolveProposal(null);
    setAutoResolveError(null);
    setAutoResolveOutcome(null);

    try {
      const [diagnosis, proposal] = await Promise.all([
        aiDiagnoseTicket(token, summary),
        proposeAutoResolution(token, summary).catch(() => ({ eligible: false as const })),
      ]);
      setTitle(diagnosis.title);
      setCategoryId(diagnosis.categoryId);
      setPriorityId(diagnosis.priorityId);
      setAiSuggestedCategoryId(diagnosis.categoryId);
      setAiSuggestedPriorityId(diagnosis.priorityId);
      setAiDegraded(diagnosis.degraded);
      setAutoResolveProposal(proposal);
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : "Impossible d'analyser la description pour le moment.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleConfirmAutoResolve() {
    if (!autoResolveProposal?.eligible) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setAutoResolveError(null);
    setIsConfirmingAutoResolve(true);
    try {
      const result = await confirmAutoResolution(token, {
        description: summary,
        scriptId: autoResolveProposal.scriptId,
        confidence: autoResolveProposal.confidence,
      });
      setAutoResolveOutcome(
        result.status === "RESOLVED"
          ? { status: "RESOLVED" }
          : { status: "FAILED_FALLBACK", ticketId: result.ticketId },
      );
      setAutoResolveProposal(null);
    } catch (err) {
      setAutoResolveError(
        err instanceof ApiError ? err.message : "Impossible de confirmer la résolution automatique.",
      );
    } finally {
      setIsConfirmingAutoResolve(false);
    }
  }

  function handleDeclineAutoResolve() {
    setAutoResolveProposal(null);
  }

  // docs/06-cas-utilisation.md UC-001 étapes 1-6 : envoie la description
  // initiale, ou la réponse à la dernière question de clarification posée
  // par l'Agent Help Desk.
  async function handleChatSend() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    const message = chatInput.trim();
    if (!message) return;

    setChatError(null);
    setIsChatSending(true);
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);
    setChatInput("");

    try {
      const result = await startOrContinueDiagnostic(token, {
        message,
        conversationId: chatConversationId ?? undefined,
      });
      setChatConversationId(result.conversationId);
      if (result.status === "NEEDS_INFO") {
        setChatMessages((prev) => [...prev, { role: "agent", content: result.question }]);
      } else {
        setChatDiagnosis(result.diagnosis);
        setChatMessages((prev) => [
          ...prev,
          { role: "agent", content: result.diagnosis.causeProbable },
        ]);
      }
    } catch (err) {
      setChatError(
        err instanceof ApiError ? err.message : "Impossible de contacter l'assistant pour le moment.",
      );
    } finally {
      setIsChatSending(false);
    }
  }

  // docs/06-cas-utilisation.md UC-001 étape 6, US-02 : les étapes suggérées
  // ont résolu le problème, aucun ticket n'est nécessaire.
  async function handleChatResolved() {
    if (!chatConversationId) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setChatError(null);
    setIsChatResolving(true);
    try {
      await resolveDiagnosticConversation(token, chatConversationId, true);
      setChatResolved(true);
    } catch (err) {
      setChatError(
        err instanceof ApiError ? err.message : "Impossible de confirmer la résolution pour le moment.",
      );
    } finally {
      setIsChatResolving(false);
    }
  }

  // docs/06-cas-utilisation.md UC-001 étape 6-7, US-03 : le problème
  // persiste — pré-remplit le formulaire manuel avec le diagnostic et lie la
  // conversation au ticket qui sera créé (voir handleSubmit).
  async function handleChatPersists() {
    if (!chatConversationId || !chatDiagnosis) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setChatError(null);
    setIsChatResolving(true);
    try {
      await resolveDiagnosticConversation(token, chatConversationId, false);
      setTitle(chatDiagnosis.title);
      setCategoryId(chatDiagnosis.categoryId);
      setPriorityId(chatDiagnosis.priorityId);
      setAiSuggestedCategoryId(chatDiagnosis.categoryId);
      setAiSuggestedPriorityId(chatDiagnosis.priorityId);
      setSummary(
        `${chatDiagnosis.causeProbable}\n\nÉtapes déjà essayées sans succès :\n${chatDiagnosis.suggestedSteps
          .map((step, i) => `${i + 1}. ${step}`)
          .join("\n")}`,
      );
      setLinkedConversationId(chatConversationId);
      setChatDiagnosis(null);
    } catch (err) {
      setChatError(
        err instanceof ApiError ? err.message : "Impossible d'enregistrer la réponse pour le moment.",
      );
    } finally {
      setIsChatResolving(false);
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

  // docs/06-cas-utilisation.md UC-001 étape 6, US-02 : problème résolu par
  // les étapes suggérées de l'Agent Help Desk, sans création de ticket.
  if (chatResolved) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Nouveau ticket" action={backLink} />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>
              Problème résolu grâce aux étapes suggérées par l&apos;assistant — aucun ticket n&apos;a
              été nécessaire.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  // docs/06-cas-utilisation.md UC-015 : cas nominal — problème résolu sans
  // qu'aucun ticket n'ait été créé.
  if (autoResolveOutcome?.status === "RESOLVED") {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Nouveau ticket" action={backLink} />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>
              Problème résolu automatiquement — aucun ticket n&apos;a été nécessaire. Un article a
              été proposé pour enrichir la base de connaissances.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  // docs/06-cas-utilisation.md UC-015, cas d'erreur : la résolution
  // automatique a échoué, un ticket standard a été créé avec le contexte.
  if (autoResolveOutcome?.status === "FAILED_FALLBACK") {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Nouveau ticket" action={backLink} />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert variant="destructive">
            <AlertDescription>
              La résolution automatique a échoué : un ticket a été créé avec le contexte de la
              tentative.
            </AlertDescription>
          </Alert>
          <Button
            className="mt-4 w-full"
            nativeButton={false}
            render={<Link href={`/tickets/${autoResolveOutcome.ticketId}`} />}
          >
            Voir le ticket
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Nouveau ticket" action={backLink} />

      <main className="mx-auto max-w-lg px-6 py-8">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-xl">Assistant Help Desk</CardTitle>
            <CardDescription>
              docs/06 UC-001 : décrivez votre problème en langage naturel — l&apos;assistant pose au
              besoin une question avant de proposer une cause probable et des étapes à essayer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {chatMessages.length > 0 ? (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
                {chatMessages.map((message, index) => (
                  <div key={index} className={message.role === "user" ? "text-right" : "text-left"}>
                    <span
                      className={`inline-block max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {message.content}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {chatError ? (
              <Alert variant="destructive">
                <AlertDescription>{chatError}</AlertDescription>
              </Alert>
            ) : null}

            {chatDiagnosis ? (
              <div className="space-y-3 rounded-md border border-primary p-3">
                <p className="text-sm">
                  <span className="font-medium">Cause probable :</span> {chatDiagnosis.causeProbable}
                </p>
                <div className="text-sm">
                  <span className="font-medium">Étapes à essayer :</span>
                  <ol className="ml-4 list-decimal space-y-1">
                    {chatDiagnosis.suggestedSteps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                </div>
                {chatDiagnosis.degraded ? (
                  <Alert>
                    <AlertDescription>
                      L&apos;IA n&apos;est pas disponible pour le moment : diagnostic générique en
                      mode dégradé.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={isChatResolving} onClick={handleChatResolved}>
                    {isChatResolving ? "..." : "Ça a résolu mon problème"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={isChatResolving}
                    onClick={handleChatPersists}
                  >
                    Le problème persiste, créer un ticket
                  </Button>
                </div>
              </div>
            ) : linkedConversationId ? (
              <Alert>
                <AlertDescription>
                  Diagnostic enregistré : le formulaire ci-dessous a été pré-rempli avec la catégorie,
                  la priorité et le contexte du problème. Vérifiez les champs puis créez le ticket.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Décrivez votre problème..."
                  disabled={isChatSending}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleChatSend();
                    }
                  }}
                />
                <Button onClick={handleChatSend} disabled={isChatSending || !chatInput.trim()}>
                  {isChatSending ? "..." : "Envoyer"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {autoResolveProposal?.eligible ? (
          <Card className="mb-6 border-primary">
            <CardHeader>
              <CardTitle className="text-xl">Résolution automatique possible</CardTitle>
              <CardDescription>
                docs/06 UC-015 : l&apos;IA a identifié une solution non sensible avec{" "}
                {Math.round(autoResolveProposal.confidence * 100)}% de confiance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                <span className="font-medium">Action proposée :</span> {autoResolveProposal.scriptName}
              </p>
              <p className="text-sm text-muted-foreground">{autoResolveProposal.explanation}</p>
              {autoResolveError ? (
                <Alert variant="destructive">
                  <AlertDescription>{autoResolveError}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={isConfirmingAutoResolve}
                  onClick={handleConfirmAutoResolve}
                >
                  {isConfirmingAutoResolve ? "Résolution en cours..." : "Confirmer la résolution automatique"}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={isConfirmingAutoResolve}
                  onClick={handleDeclineAutoResolve}
                >
                  Non, créer un ticket
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

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

                <div className="space-y-2">
                  <Label htmlFor="ci">Équipement concerné (optionnel)</Label>
                  <Select value={ciId} onValueChange={(value) => setCiId((value as string) ?? NO_CI)}>
                    <SelectTrigger id="ci" className="w-full">
                      <SelectValue placeholder="Aucun équipement">
                        {(value: string | null) =>
                          value && value !== NO_CI
                            ? (configurationItems.find((ci) => ci.id === value)?.name ??
                              "Aucun équipement")
                            : "Aucun équipement"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CI}>Aucun équipement</SelectItem>
                      {configurationItems.map((ci) => (
                        <SelectItem key={ci.id} value={ci.id}>
                          {ci.name} ({ci.inventoryNumber})
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
