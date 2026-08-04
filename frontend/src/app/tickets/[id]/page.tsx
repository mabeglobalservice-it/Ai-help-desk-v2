"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Star } from "lucide-react";
import {
  ApiError,
  ATTACHMENT_ACCEPT,
  assistTechnician,
  createComment,
  downloadAttachment,
  getAttachments,
  getComments,
  getPriorities,
  getScripts,
  getTicket,
  getTicketCategories,
  getUsers,
  rateTicket,
  requestAutomationRun,
  suggestAutomation,
  suggestTechnician,
  updateTicket,
  uploadAttachment,
  type AdminUser,
  type AutomationRun,
  type Priority,
  type Script,
  type TechnicianAssistResult,
  type TicketAttachment,
  type TicketCategory,
  type TicketComment,
  type TicketDetail,
  type TicketStatus,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { useRealtimeEvent } from "@/lib/use-realtime-event";
import { STATUS_DISPLAY, priorityDotClass } from "@/lib/ticket-display";
import { formatFileSize } from "@/lib/format";
import { AppHeader } from "@/components/app-header";
import { SlaBadge } from "@/components/sla-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

const ALL_STATUSES = Object.keys(STATUS_DISPLAY) as TicketStatus[];
const UNASSIGNED = "UNASSIGNED";

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

function StarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!onChange || disabled}
          aria-label={`${star} étoile${star > 1 ? "s" : ""}`}
          aria-pressed={star <= value}
          onClick={() => onChange?.(star)}
          className={onChange ? "cursor-pointer" : "cursor-default"}
        >
          <Star
            className={`size-5 ${star <= value ? "fill-signal-amber text-signal-amber" : "text-muted-foreground"}`}
          />
        </button>
      ))}
    </div>
  );
}

export default function TicketDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const user = useSessionUser();

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [comments, setComments] = useState<TicketComment[] | null>(null);
  const [attachments, setAttachments] = useState<TicketAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [newComment, setNewComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [technicians, setTechnicians] = useState<AdminUser[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [showResolvePrompt, setShowResolvePrompt] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [isSavingTriage, setIsSavingTriage] = useState(false);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState(UNASSIGNED);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [suggestionInfo, setSuggestionInfo] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);

  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);

  const [scripts, setScripts] = useState<Script[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState("");
  const [automationJustification, setAutomationJustification] = useState("");
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [isRequestingAutomation, setIsRequestingAutomation] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<AutomationRun | null>(null);
  const [automationSuggestionInfo, setAutomationSuggestionInfo] = useState<string | null>(null);
  const [automationSuggestError, setAutomationSuggestError] = useState<string | null>(null);
  const [isSuggestingAutomation, setIsSuggestingAutomation] = useState(false);

  // docs/09-architecture-agents-ia.md §3.3 (Agent Technicien)
  const [technicianQuestion, setTechnicianQuestion] = useState("");
  const [isAskingAssistant, setIsAskingAssistant] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantResult, setAssistantResult] = useState<TechnicianAssistResult | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    Promise.all([getTicket(token, params.id), getComments(token, params.id), getAttachments(token, params.id)])
      .then(([ticketData, commentsData, attachmentsData]) => {
        setTicket(ticketData);
        setComments(commentsData);
        setAttachments(attachmentsData);
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
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        setError("Impossible de charger ce ticket pour le moment.");
      });
  }, [router, params.id]);

  const isPrivileged = user?.role === "SUPERVISOR" || user?.role === "ADMIN";

  useEffect(() => {
    if (!isPrivileged) return;
    const token = getToken();
    if (!token) return;

    getUsers(token)
      .then((users) => setTechnicians(users.filter((u) => u.role === "TECHNICIAN" && u.isActive)))
      .catch(() => {
        // best-effort: the assignment dropdown just stays empty
      });
  }, [isPrivileged]);

  // docs/02-brd.md BR-07: le technicien assigné (ou superviseur/admin) peut
  // corriger manuellement une catégorisation/priorité erronée.
  useEffect(() => {
    const token = getToken();
    if (!token || !user) return;

    Promise.all([getTicketCategories(token), getPriorities(token)])
      .then(([categoryList, priorityList]) => {
        setCategories(categoryList);
        setPriorities(priorityList);
      })
      .catch(() => {
        // best-effort: the triage dropdowns just stay empty
      });
  }, [user]);

  useEffect(() => {
    // Intentional: resyncs the pending (unsaved) selection to the server's
    // current assignment whenever fresh ticket data arrives (initial load or
    // after a confirmed change), while still letting the user stage a
    // different pick locally before clicking "Assigner".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ticket) setSelectedTechnicianId(ticket.technician?.id ?? UNASSIGNED);
  }, [ticket]);

  useEffect(() => {
    // Intentional: same resync pattern as the technician selection above,
    // applied to the rating form so it reflects the employee's last saved
    // rating while still allowing them to stage an edit before submitting.
    if (ticket) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRatingValue(ticket.rating ?? 0);
      setRatingComment(ticket.ratingComment ?? "");
    }
  }, [ticket]);

  const isTechnician = user?.role === "TECHNICIAN";

  // docs/06-cas-utilisation.md UC-014/UC-022, docs/11-documentation-api.md
  // §8: POST /automation/runs est réservé au rôle TECHNICIAN (pas restreint
  // au technicien assigné), donc la liste des scripts est chargée pour tout
  // technicien consultant ce ticket.
  useEffect(() => {
    if (!isTechnician) return;
    const token = getToken();
    if (!token) return;

    getScripts(token)
      .then(setScripts)
      .catch(() => {
        // best-effort: the script dropdown just stays empty
      });
  }, [isTechnician]);

  async function refreshTicket(token: string) {
    const ticketData = await getTicket(token, params.id);
    setTicket(ticketData);
  }

  // docs/05-user-stories.md US-28: pré-remplit le script et la justification
  // à partir du contexte du ticket — le technicien reste libre de les
  // modifier ou de les ignorer avant de proposer l'action.
  async function handleSuggestAutomation() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setAutomationSuggestError(null);
    setAutomationSuggestionInfo(null);
    setIsSuggestingAutomation(true);
    try {
      const suggestion = await suggestAutomation(token, params.id);
      setSelectedScriptId(suggestion.scriptId);
      setAutomationJustification(suggestion.justification);
      setAutomationSuggestionInfo(
        `Suggestion : ${suggestion.scriptName ?? "script"} — vérifiez avant de proposer.`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setAutomationSuggestError("Aucune suggestion disponible pour ce ticket.");
      } else {
        setAutomationSuggestError(
          err instanceof ApiError ? err.message : "Impossible de suggérer une action pour le moment.",
        );
      }
    } finally {
      setIsSuggestingAutomation(false);
    }
  }

  // docs/09-architecture-agents-ia.md §3.3 (Agent Technicien) : explication
  // textuelle et, le cas échéant, un script suggéré à titre indicatif — ne
  // déclenche jamais d'exécution (voir la section Automatisation pour ça).
  async function handleAskAssistant() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!technicianQuestion.trim()) return;

    setAssistantError(null);
    setIsAskingAssistant(true);
    try {
      const result = await assistTechnician(token, params.id, technicianQuestion.trim());
      setAssistantResult(result);
    } catch (err) {
      setAssistantError(
        err instanceof ApiError ? err.message : "Impossible de contacter l'assistant pour le moment.",
      );
    } finally {
      setIsAskingAssistant(false);
    }
  }

  async function handleRequestAutomation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!selectedScriptId || !automationJustification.trim()) return;

    setAutomationError(null);
    setIsRequestingAutomation(true);
    try {
      const run = await requestAutomationRun(token, {
        scriptId: selectedScriptId,
        ticketId: params.id,
        justification: automationJustification.trim(),
      });
      setLastRunResult(run);
      setAutomationJustification("");
    } catch (err) {
      setAutomationError(
        err instanceof ApiError ? err.message : "Impossible de proposer cette action pour le moment.",
      );
    } finally {
      setIsRequestingAutomation(false);
    }
  }

  // docs/11-documentation-api.md §13: refetch en temps reel quand CE ticket
  // change de statut ou d'assignation (ex. depuis un autre onglet/appareil).
  useRealtimeEvent<{ id: string }>("ticket.statusChanged", (payload) => {
    if (payload.id !== params.id) return;
    const token = getToken();
    if (token) refreshTicket(token);
  });
  useRealtimeEvent<{ id: string }>("ticket.assigned", (payload) => {
    if (payload.id !== params.id) return;
    const token = getToken();
    if (token) refreshTicket(token);
  });

  // docs/06-cas-utilisation.md UC-013: passer un ticket à "Résolu" exige une
  // note de résolution (requise en V2), demandée avant d'envoyer le
  // changement plutôt que de l'appliquer immédiatement comme les autres
  // transitions de statut.
  async function handleStatusChange(newStatus: TicketStatus) {
    if (newStatus === "RESOLVED") {
      setStatusError(null);
      setShowResolvePrompt(true);
      return;
    }

    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setStatusError(null);
    setIsUpdatingStatus(true);
    try {
      await updateTicket(token, params.id, { status: newStatus });
      await refreshTicket(token);
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : "Impossible de changer le statut pour le moment.");
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  async function handleConfirmResolve() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setStatusError(null);
    setIsUpdatingStatus(true);
    try {
      await updateTicket(token, params.id, {
        status: "RESOLVED",
        resolutionNote: resolutionNote.trim(),
      });
      await refreshTicket(token);
      setShowResolvePrompt(false);
      setResolutionNote("");
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : "Impossible de résoudre le ticket pour le moment.");
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  function handleCancelResolve() {
    setShowResolvePrompt(false);
    setResolutionNote("");
  }

  async function handleCategoryChange(newCategoryId: string) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setTriageError(null);
    setIsSavingTriage(true);
    try {
      await updateTicket(token, params.id, { categoryId: newCategoryId });
      await refreshTicket(token);
    } catch (err) {
      setTriageError(err instanceof ApiError ? err.message : "Impossible de changer la catégorie pour le moment.");
    } finally {
      setIsSavingTriage(false);
    }
  }

  async function handlePriorityChange(newPriorityId: string) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setTriageError(null);
    setIsSavingTriage(true);
    try {
      await updateTicket(token, params.id, { priorityId: newPriorityId });
      await refreshTicket(token);
    } catch (err) {
      setTriageError(err instanceof ApiError ? err.message : "Impossible de changer la priorité pour le moment.");
    } finally {
      setIsSavingTriage(false);
    }
  }

  async function handleAssignTechnician() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!selectedTechnicianId || selectedTechnicianId === UNASSIGNED) return;

    setAssignError(null);
    setIsAssigning(true);
    try {
      await updateTicket(token, params.id, { technicianId: selectedTechnicianId });
      await refreshTicket(token);
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : "Impossible d'assigner le technicien pour le moment.");
    } finally {
      setIsAssigning(false);
    }
  }

  async function handleSuggestTechnician() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setSuggestError(null);
    setSuggestionInfo(null);
    setIsSuggesting(true);
    try {
      const suggestion = await suggestTechnician(token, params.id);
      setSelectedTechnicianId(suggestion.id);
      setSuggestionInfo(
        `Suggestion : ${suggestion.displayName} (${suggestion.openTicketCount} ticket${suggestion.openTicketCount === 1 ? "" : "s"} ouvert${suggestion.openTicketCount === 1 ? "" : "s"})`,
      );
    } catch (err) {
      setSuggestError(
        err instanceof ApiError ? err.message : "Impossible de suggérer un technicien pour le moment.",
      );
    } finally {
      setIsSuggesting(false);
    }
  }

  async function handleSubmitRating(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (ratingValue < 1) return;

    setRatingError(null);
    setIsSubmittingRating(true);
    try {
      await rateTicket(token, params.id, { rating: ratingValue, comment: ratingComment.trim() || undefined });
      await refreshTicket(token);
    } catch (err) {
      setRatingError(
        err instanceof ApiError ? err.message : "Impossible d'enregistrer votre évaluation pour le moment.",
      );
    } finally {
      setIsSubmittingRating(false);
    }
  }

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

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    try {
      const attachment = await uploadAttachment(token, params.id, file);
      setAttachments((prev) => (prev ? [...prev, attachment] : [attachment]));
    } catch (err) {
      if (err instanceof ApiError && err.status === 413) {
        setUploadError("Le fichier dépasse la taille maximale autorisée (10 Mo).");
      } else if (err instanceof ApiError) {
        setUploadError(err.message);
      } else {
        setUploadError("Impossible de téléverser le fichier pour le moment.");
      }
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDownload(attachment: TicketAttachment) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setDownloadError(null);

    try {
      const blob = await downloadAttachment(token, params.id, attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("Impossible de télécharger ce fichier pour le moment.");
    }
  }

  const canContribute = !!(
    user &&
    ticket &&
    (ticket.employee.id === user.id ||
      ticket.technician?.id === user.id ||
      user.role === "SUPERVISOR" ||
      user.role === "ADMIN")
  );

  const canChangeStatus = !!(
    user &&
    ticket &&
    (ticket.technician?.id === user.id || user.role === "SUPERVISOR" || user.role === "ADMIN")
  );

  const canAssignTechnician = isPrivileged;

  const isOwner = !!(user && ticket && ticket.employee.id === user.id);
  const canRate = !!(ticket && ticket.status === "RESOLVED" && (isOwner || ticket.rating !== null));

  const backLink = (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/tickets" />}>
      Retour aux tickets
    </Button>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title={ticket ? ticket.reference : "Ticket"} action={backLink} />

      <main className="mx-auto max-w-2xl px-6 py-8">
        {forbidden ? (
          <Alert>
            <AlertDescription>
              Vous n&apos;avez pas accès à ce ticket. Retournez à la liste pour consulter vos tickets.
            </AlertDescription>
          </Alert>
        ) : notFound ? (
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
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xl">{ticket.title}</CardTitle>
                    <SlaBadge slaDueAt={ticket.slaDueAt} createdAt={ticket.createdAt} status={ticket.status} />
                  </div>
                  {canChangeStatus ? (
                    <Select
                      value={ticket.status}
                      onValueChange={(value) => value && handleStatusChange(value as TicketStatus)}
                      disabled={isUpdatingStatus}
                    >
                      <SelectTrigger className="w-40 shrink-0">
                        <SelectValue placeholder="Statut">
                          {(value: string | null) => (value ? STATUS_DISPLAY[value as TicketStatus].label : "Statut")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {STATUS_DISPLAY[status].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm">
                      <span className={`size-1.5 rounded-full ${STATUS_DISPLAY[ticket.status].dot}`} />
                      {STATUS_DISPLAY[ticket.status].label}
                    </span>
                  )}
                </div>
                {statusError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{statusError}</AlertDescription>
                  </Alert>
                ) : null}
                {showResolvePrompt ? (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <Label htmlFor="resolution-note">Note de résolution (requise)</Label>
                    <Textarea
                      id="resolution-note"
                      value={resolutionNote}
                      onChange={(event) => setResolutionNote(event.target.value)}
                      placeholder="Ex. Redémarrage du service d'impression, problème résolu."
                      rows={3}
                      disabled={isUpdatingStatus}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleConfirmResolve}
                        disabled={isUpdatingStatus || !resolutionNote.trim()}
                      >
                        {isUpdatingStatus ? "Résolution..." : "Confirmer la résolution"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCancelResolve}
                        disabled={isUpdatingStatus}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : null}
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

                {ticket.resolutionNote ? (
                  <div>
                    <dt className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">
                      Note de résolution
                    </dt>
                    <dd className="mt-1 text-sm whitespace-pre-wrap">{ticket.resolutionNote}</dd>
                  </div>
                ) : null}

                {triageError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{triageError}</AlertDescription>
                  </Alert>
                ) : null}

                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <Field label="Référence">
                    <span className="font-mono text-xs">{ticket.reference}</span>
                  </Field>
                  <Field label="Catégorie">
                    {canChangeStatus ? (
                      <Select
                        value={ticket.category.id}
                        onValueChange={(value) => value && handleCategoryChange(value as string)}
                        disabled={isSavingTriage}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(value: string | null) =>
                              categories.find((category) => category.id === value)?.name ??
                              ticket.category.name
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
                    ) : (
                      ticket.category.name
                    )}
                  </Field>
                  <Field label="Priorité">
                    {canChangeStatus ? (
                      <Select
                        value={ticket.priority.id}
                        onValueChange={(value) => value && handlePriorityChange(value as string)}
                        disabled={isSavingTriage}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(value: string | null) =>
                              priorities.find((priority) => priority.id === value)?.name ??
                              ticket.priority.name
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
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`size-1.5 rounded-full ${priorityDotClass(ticket.priority.level)}`} />
                        {ticket.priority.name}
                      </span>
                    )}
                  </Field>
                  <Field label="Équipement concerné">
                    {ticket.ci ? (
                      <>
                        {isTechnician || user?.role === "SUPERVISOR" || user?.role === "ADMIN" ? (
                          <Link href={`/admin/configuration-items/${ticket.ci.id}`} className="hover:underline">
                            {ticket.ci.name}
                          </Link>
                        ) : (
                          ticket.ci.name
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {ticket.ci.ciType.name} · {ticket.ci.inventoryNumber}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Aucun</span>
                    )}
                  </Field>
                  <Field label="Employé">
                    {ticket.employee.displayName}
                    <span className="block text-xs text-muted-foreground">{ticket.employee.email}</span>
                  </Field>
                  <Field label="Technicien assigné">
                    {canAssignTechnician ? (
                      <div className="space-y-1.5">
                        <Select
                          value={selectedTechnicianId}
                          onValueChange={(value) => setSelectedTechnicianId(value ?? UNASSIGNED)}
                          disabled={isAssigning}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Assigner un technicien">
                              {(value: string | null) =>
                                value && value !== UNASSIGNED
                                  ? (technicians.find((tech) => tech.id === value)?.displayName ??
                                    ticket.technician?.displayName ??
                                    "Assigner un technicien")
                                  : "Assigner un technicien"
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {technicians.map((tech) => (
                              <SelectItem key={tech.id} value={tech.id}>
                                {tech.displayName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleSuggestTechnician}
                            disabled={isSuggesting}
                          >
                            {isSuggesting ? "Suggestion..." : "Suggérer un technicien"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleAssignTechnician}
                            disabled={
                              isAssigning ||
                              selectedTechnicianId === UNASSIGNED ||
                              selectedTechnicianId === (ticket.technician?.id ?? UNASSIGNED)
                            }
                          >
                            {isAssigning ? "Assignation..." : "Assigner"}
                          </Button>
                        </div>
                        {suggestionInfo ? (
                          <p className="text-xs text-muted-foreground">{suggestionInfo}</p>
                        ) : null}
                        {suggestError ? (
                          <Alert variant="destructive">
                            <AlertDescription>{suggestError}</AlertDescription>
                          </Alert>
                        ) : null}
                        {assignError ? (
                          <Alert variant="destructive">
                            <AlertDescription>{assignError}</AlertDescription>
                          </Alert>
                        ) : null}
                      </div>
                    ) : ticket.technician ? (
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
                  <Field label="Échéance SLA">
                    {ticket.slaDueAt ? (
                      dateFormatter.format(new Date(ticket.slaDueAt))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Field>
                </dl>
              </CardContent>
            </Card>

            {canRate ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Évaluation de la résolution</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isOwner ? (
                    <form onSubmit={handleSubmitRating} className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Note</Label>
                        <StarPicker value={ratingValue} onChange={setRatingValue} disabled={isSubmittingRating} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="rating-comment" className="sr-only">
                          Commentaire (optionnel)
                        </Label>
                        <Textarea
                          id="rating-comment"
                          value={ratingComment}
                          onChange={(event) => setRatingComment(event.target.value)}
                          placeholder="Un commentaire sur la résolution (optionnel)..."
                          rows={2}
                        />
                      </div>
                      {ratingError ? (
                        <Alert variant="destructive">
                          <AlertDescription>{ratingError}</AlertDescription>
                        </Alert>
                      ) : null}
                      <Button type="submit" size="sm" disabled={isSubmittingRating || ratingValue < 1}>
                        {isSubmittingRating ? "Envoi..." : ticket.rating !== null ? "Mettre à jour" : "Envoyer"}
                      </Button>
                    </form>
                  ) : (
                    <div className="space-y-1.5">
                      <StarPicker value={ticket.rating ?? 0} />
                      {ticket.ratingComment ? (
                        <p className="text-sm whitespace-pre-wrap">{ticket.ratingComment}</p>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {isTechnician ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Automatisation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {scripts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucun script disponible pour le moment.</p>
                  ) : (
                    <form onSubmit={handleRequestAutomation} className="space-y-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleSuggestAutomation}
                        disabled={isSuggestingAutomation}
                      >
                        {isSuggestingAutomation ? "Suggestion..." : "Suggérer une action"}
                      </Button>
                      {automationSuggestionInfo ? (
                        <p className="text-xs text-muted-foreground">{automationSuggestionInfo}</p>
                      ) : null}
                      {automationSuggestError ? (
                        <Alert>
                          <AlertDescription>{automationSuggestError}</AlertDescription>
                        </Alert>
                      ) : null}
                      <div className="space-y-1.5">
                        <Label htmlFor="automation-script">Script</Label>
                        <Select value={selectedScriptId} onValueChange={(value) => setSelectedScriptId(value ?? "")}>
                          <SelectTrigger id="automation-script" className="w-full">
                            <SelectValue placeholder="Choisir un script">
                              {(value: string | null) =>
                                scripts.find((script) => script.id === value)?.name ?? "Choisir un script"
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {scripts.map((script) => (
                              <SelectItem key={script.id} value={script.id}>
                                {script.name} {script.isSensitive ? "(sensible)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="automation-justification">Justification</Label>
                        <Textarea
                          id="automation-justification"
                          value={automationJustification}
                          onChange={(event) => setAutomationJustification(event.target.value)}
                          placeholder="Ex. Compte verrouillé après 5 tentatives"
                          rows={2}
                          required
                        />
                      </div>
                      {automationError ? (
                        <Alert variant="destructive">
                          <AlertDescription>{automationError}</AlertDescription>
                        </Alert>
                      ) : null}
                      <Button
                        type="submit"
                        size="sm"
                        disabled={
                          isRequestingAutomation || !selectedScriptId || !automationJustification.trim()
                        }
                      >
                        {isRequestingAutomation ? "Envoi..." : "Proposer"}
                      </Button>
                    </form>
                  )}

                  {lastRunResult ? (
                    <Alert>
                      <AlertDescription>
                        {lastRunResult.status === "PENDING_APPROVAL"
                          ? "Action sensible envoyée pour approbation."
                          : lastRunResult.status === "SUCCESS"
                            ? "Action exécutée avec succès."
                            : `Statut : ${lastRunResult.status}`}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {isTechnician ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Assistant Technicien</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    docs/09 §3.3 : explique une panne, une commande ou un script à partir du contexte
                    de ce ticket — un script suggéré n&apos;est jamais exécuté ici, seulement indicatif.
                  </p>
                  <div className="flex gap-2">
                    <Textarea
                      value={technicianQuestion}
                      onChange={(event) => setTechnicianQuestion(event.target.value)}
                      placeholder="Ex. Comment vider le cache DNS avant de réinstaller le pilote réseau ?"
                      rows={2}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAskAssistant}
                    disabled={isAskingAssistant || !technicianQuestion.trim()}
                  >
                    {isAskingAssistant ? "Analyse en cours..." : "Demander à l'assistant"}
                  </Button>
                  {assistantError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{assistantError}</AlertDescription>
                    </Alert>
                  ) : null}
                  {assistantResult ? (
                    <div className="space-y-2 rounded-md border p-3">
                      <p className="text-sm whitespace-pre-wrap">{assistantResult.explanation}</p>
                      {assistantResult.suggestedScript ? (
                        <div className="space-y-1">
                          <p className="text-xs font-medium">
                            Script suggéré (non exécuté) :
                          </p>
                          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                            {assistantResult.suggestedScript}
                          </pre>
                        </div>
                      ) : null}
                      {assistantResult.degraded ? (
                        <Alert>
                          <AlertDescription>
                            L&apos;IA n&apos;est pas disponible pour le moment : réponse générique en
                            mode dégradé.
                          </AlertDescription>
                        </Alert>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

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

                {canContribute ? (
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
                <CardTitle className="text-base">Pièces jointes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {attachments === null ? (
                  <p className="text-sm text-muted-foreground">Chargement des pièces jointes...</p>
                ) : attachments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune pièce jointe pour le moment.</p>
                ) : (
                  <ul className="space-y-3">
                    {attachments.map((attachment) => (
                      <li
                        key={attachment.id}
                        className="border-t border-border pt-3 first:border-t-0 first:pt-0"
                      >
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0 text-sm font-medium"
                          onClick={() => handleDownload(attachment)}
                        >
                          {attachment.fileName}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(attachment.size)} · {dateFormatter.format(new Date(attachment.createdAt))} ·{" "}
                          {attachment.uploadedBy.displayName}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {downloadError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{downloadError}</AlertDescription>
                  </Alert>
                ) : null}

                {canContribute ? (
                  <div className="space-y-2 border-t border-border pt-4">
                    <Label htmlFor="attachment-upload">Ajouter un fichier</Label>
                    <Input
                      id="attachment-upload"
                      type="file"
                      accept={ATTACHMENT_ACCEPT}
                      onChange={handleFileChange}
                      disabled={isUploading}
                    />
                    <p className="text-xs text-muted-foreground">
                      Images, PDF, documents Office ou texte — 10 Mo maximum.
                    </p>
                    {isUploading ? <p className="text-xs text-muted-foreground">Envoi en cours...</p> : null}
                    {uploadError ? (
                      <Alert variant="destructive">
                        <AlertDescription>{uploadError}</AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
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
                      <li key={entry.id} className="text-sm">
                        <span>
                          {entry.fromStatus ? STATUS_DISPLAY[entry.fromStatus].label : "—"}
                          {" → "}
                          {STATUS_DISPLAY[entry.toStatus].label}
                          {" par "}
                          <span className="font-medium">
                            {entry.changedBy ? entry.changedBy.displayName : "Système (SLA dépassé)"}
                          </span>
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          le {dateFormatter.format(new Date(entry.changedAt))}
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
