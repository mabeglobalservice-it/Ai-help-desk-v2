import { clearSession, getRefreshToken, updateTokens } from "./session";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (Array.isArray(body?.message)) return body.message.join(", ");
    if (typeof body?.message === "string") return body.message;
  } catch {
    // response had no JSON body
  }
  return "Une erreur est survenue.";
}

// Concurrent 401s share a single in-flight refresh instead of each rotating
// the refresh token independently (which would invalidate one another).
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessTokenSilently(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        // the refresh token itself is dead: no point keeping stale tokens around
        clearSession();
        return null;
      }

      const data = (await response.json()) as { accessToken: string; refreshToken: string };
      updateTokens(data.accessToken, data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Shared by every authenticated fetch (JSON, upload, download): on a 401,
// attempts one silent token refresh and retries the request once with the
// new access token. Falls back to the original 401 response if refreshing
// fails, letting the caller's existing "clear session, go to /login" handling
// take over.
async function fetchWithAuthRetry(path: string, token: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });

  if (response.status !== 401) return response;

  const newToken = await refreshAccessTokenSilently();
  if (!newToken) return response;

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${newToken}`, ...init?.headers },
  });
}

async function apiFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchWithAuthRetry(path, token, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  return response.json();
}

export type Role = "EMPLOYEE" | "TECHNICIAN" | "SUPERVISOR" | "ADMIN";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  return response.json();
}

// Revokes the given refresh token server-side. Best-effort: callers should
// clear the local session regardless of whether this succeeds.
export async function logout(token: string, refreshToken: string): Promise<void> {
  const response = await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }
}

export type TicketStatus = "NEW" | "IN_PROGRESS" | "RESOLVED" | "ESCALATED";

export interface Ticket {
  id: string;
  reference: string;
  title: string;
  summary: string | null;
  status: TicketStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  slaDueAt: string | null;
  rating: number | null;
  ratingComment: string | null;
  ratedAt: string | null;
  employee: { id: string; displayName: string; email: string };
  technician: { id: string; displayName: string; email: string } | null;
  category: { id: string; name: string };
  priority: { id: string; name: string; level: number };
  ci: {
    id: string;
    name: string;
    inventoryNumber: string;
    ciType: { id: string; name: string };
  } | null;
}

export interface TicketsFilter {
  status?: TicketStatus;
  categoryId?: string;
  priorityId?: string;
  technicianId?: string;
}

export function getTickets(token: string, filter: TicketsFilter = {}): Promise<Ticket[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.categoryId) params.set("categoryId", filter.categoryId);
  if (filter.priorityId) params.set("priorityId", filter.priorityId);
  if (filter.technicianId) params.set("technicianId", filter.technicianId);
  const query = params.toString();
  return apiFetch<Ticket[]>(`/tickets${query ? `?${query}` : ""}`, token);
}

export interface TicketStatusHistoryEntry {
  id: string;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  changedBy: { id: string; displayName: string; email: string } | null;
  changedAt: string;
}

export interface TicketDetail extends Ticket {
  statusHistory: TicketStatusHistoryEntry[];
}

export function getTicket(token: string, id: string): Promise<TicketDetail> {
  return apiFetch<TicketDetail>(`/tickets/${id}`, token);
}

export interface UpdateTicketInput {
  status?: TicketStatus;
  technicianId?: string;
  resolutionNote?: string;
  categoryId?: string;
  priorityId?: string;
}

export function updateTicket(token: string, id: string, input: UpdateTicketInput): Promise<Ticket> {
  return apiFetch<Ticket>(`/tickets/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface RateTicketInput {
  rating: number;
  comment?: string;
}

export function rateTicket(token: string, id: string, input: RateTicketInput): Promise<Ticket> {
  return apiFetch<Ticket>(`/tickets/${id}/rate`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface TicketCategory {
  id: string;
  name: string;
}

export function getTicketCategories(token: string): Promise<TicketCategory[]> {
  return apiFetch<TicketCategory[]>("/ticket-categories", token);
}

export interface Priority {
  id: string;
  name: string;
  level: number;
}

export function getPriorities(token: string): Promise<Priority[]> {
  return apiFetch<Priority[]>("/priorities", token);
}

export interface CiType {
  id: string;
  name: string;
}

export function getCiTypes(token: string): Promise<CiType[]> {
  return apiFetch<CiType[]>("/ci-types", token);
}

export interface Manufacturer {
  id: string;
  name: string;
}

export function getManufacturers(token: string): Promise<Manufacturer[]> {
  return apiFetch<Manufacturer[]>("/manufacturers", token);
}

export interface CiModel {
  id: string;
  name: string;
  manufacturerId: string;
}

export function getModelsByManufacturer(
  token: string,
  manufacturerId: string,
): Promise<CiModel[]> {
  return apiFetch<CiModel[]>(`/models?manufacturerId=${manufacturerId}`, token);
}

// US-24 : garantie d'un CI, consultée avant de décider réparer vs remplacer.
export interface Warranty {
  id: string;
  provider: string;
  startDate: string;
  endDate: string;
  referenceNumber: string | null;
  notes: string | null;
}

export interface SetWarrantyInput {
  provider: string;
  startDate: string;
  endDate: string;
  referenceNumber?: string;
  notes?: string;
}

// US-23 : licence d'un CI et sa date d'expiration, pour anticiper les renouvellements.
export interface License {
  id: string;
  vendor: string;
  expiresAt: string;
  purchasedAt: string | null;
  referenceNumber: string | null;
  notes: string | null;
}

export interface SetLicenseInput {
  vendor: string;
  expiresAt: string;
  purchasedAt?: string;
  referenceNumber?: string;
  notes?: string;
}

export type Criticality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type CiStatus = "ACTIVE" | "IN_REPAIR" | "RETIRED";

export interface ConfigurationItem {
  id: string;
  ciTypeId: string;
  ciType: CiType;
  name: string;
  inventoryNumber: string;
  serialNumber: string | null;
  manufacturer: Manufacturer | null;
  model: (CiModel & { manufacturer: Manufacturer }) | null;
  warranty: Warranty | null;
  license: License | null;
  criticality: Criticality;
  status: CiStatus;
  createdAt: string;
}

// docs/08-schema-base-de-donnees.md §4.3 : dependance de CI, dans les deux sens.
export type RelationshipType = "DEPENDS_ON" | "HOSTS" | "CONNECTS_TO" | "RUNS_ON";

export interface ConfigurationItemRef {
  id: string;
  name: string;
  inventoryNumber: string;
  criticality: Criticality;
  status: CiStatus;
  ciType: CiType;
}

export interface CiRelationshipAsParent {
  id: string;
  relationshipType: RelationshipType;
  child: ConfigurationItemRef;
}

export interface CiRelationshipAsChild {
  id: string;
  relationshipType: RelationshipType;
  parent: ConfigurationItemRef;
}

export interface ConfigurationItemDetail extends ConfigurationItem {
  tickets: {
    id: string;
    reference: string;
    title: string;
    status: TicketStatus;
    createdAt: string;
  }[];
  relationshipsAsParent: CiRelationshipAsParent[];
  relationshipsAsChild: CiRelationshipAsChild[];
}

export function getConfigurationItems(token: string): Promise<ConfigurationItem[]> {
  return apiFetch<ConfigurationItem[]>("/configuration-items", token);
}

export function getConfigurationItem(token: string, id: string): Promise<ConfigurationItemDetail> {
  return apiFetch<ConfigurationItemDetail>(`/configuration-items/${id}`, token);
}

export interface CreateConfigurationItemInput {
  ciTypeId: string;
  name: string;
  inventoryNumber: string;
  serialNumber?: string;
  manufacturerName?: string;
  modelName?: string;
  warranty?: SetWarrantyInput;
  license?: SetLicenseInput;
  criticality?: Criticality;
  status?: CiStatus;
}

export function createConfigurationItem(
  token: string,
  input: CreateConfigurationItemInput,
): Promise<ConfigurationItem> {
  return apiFetch<ConfigurationItem>("/configuration-items", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type UpdateConfigurationItemInput = Partial<CreateConfigurationItemInput> & {
  clearWarranty?: boolean;
  clearLicense?: boolean;
};

export function updateConfigurationItem(
  token: string,
  id: string,
  input: UpdateConfigurationItemInput,
): Promise<ConfigurationItem> {
  return apiFetch<ConfigurationItem>(`/configuration-items/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface CreateCiRelationshipInput {
  childCiId: string;
  relationshipType: RelationshipType;
}

export function addCiRelationship(
  token: string,
  id: string,
  input: CreateCiRelationshipInput,
): Promise<CiRelationshipAsParent> {
  return apiFetch<CiRelationshipAsParent>(`/configuration-items/${id}/relationships`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function removeCiRelationship(
  token: string,
  id: string,
  relationshipId: string,
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/configuration-items/${id}/relationships/${relationshipId}`, token, {
    method: "DELETE",
  });
}

// docs/08-schema-base-de-donnees.md §4.3, docs/11-documentation-api.md §9
// (GET /inventory/cis/:id/impact) : "connaître l'impact d'un incident".
export interface CiImpactEntry {
  ci: ConfigurationItemRef;
  relationshipType: RelationshipType;
  viaParentId: string;
}

export interface CiImpactTicket {
  id: string;
  reference: string;
  title: string;
  status: TicketStatus;
  ciId: string;
  employee: { id: string; displayName: string; email: string };
}

export interface CiImpactResult {
  ci: ConfigurationItemRef;
  impactedCis: CiImpactEntry[];
  affectedTickets: CiImpactTicket[];
}

export function getCiImpact(token: string, id: string): Promise<CiImpactResult> {
  return apiFetch<CiImpactResult>(`/configuration-items/${id}/impact`, token);
}

// US-27 : tendance du nombre de tickets par modèle sur 90 jours, pour
// anticiper les remplacements (docs/09 §3.6, Agent Manager).
export interface ModelReliabilityEntry {
  modelId: string;
  modelName: string;
  manufacturerName: string;
  ciCount: number;
  recentTicketCount: number;
  previousTicketCount: number;
  recentTicketsPerCi: number;
  trendPercent: number | null;
  atRisk: boolean;
}

export function getModelReliability(token: string): Promise<ModelReliabilityEntry[]> {
  return apiFetch<ModelReliabilityEntry[]>(
    "/configuration-items/models/reliability",
    token,
  );
}

// US-23 : consulter les licences et leur date d'expiration, pour anticiper
// les renouvellements.
export type LicenseStatus = "EXPIRED" | "EXPIRING_SOON" | "VALID";

export interface LicenseListEntry {
  ci: {
    id: string;
    name: string;
    inventoryNumber: string;
    ciType: CiType;
  };
  license: License;
  status: LicenseStatus;
  daysUntilExpiration: number;
}

export function getLicenses(token: string): Promise<LicenseListEntry[]> {
  return apiFetch<LicenseListEntry[]>("/configuration-items/licenses", token);
}

// docs/10-architecture-rag.md §13 ("RAG multi-niveaux") : 1=public, 2=interne,
// 3=tickets résolus, 4=automatisation, 5=personnel.
export interface KnowledgeSearchResult {
  id: string;
  reference: string | null;
  title: string;
  summary: string | null;
  resolvedAt: string | null;
  categoryName: string | null;
  priorityName: string | null;
  sourceType: "TICKET" | "ARTICLE" | "SCRIPT" | "DOCUMENT";
  knowledgeLevel: number;
  rank: number;
  snippet: string;
}

export function searchKnowledge(token: string, q: string): Promise<KnowledgeSearchResult[]> {
  const params = new URLSearchParams({ q });
  return apiFetch<KnowledgeSearchResult[]>(`/knowledge/search?${params.toString()}`, token);
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  knowledgeLevel: number;
  ownerId: string | null;
  uploadedById: string;
  authorName: string | null;
  sourceVersion: string | null;
  language: string;
  createdAt: string;
}

export interface CreateKnowledgeDocumentInput {
  title: string;
  content: string;
  knowledgeLevel?: 1 | 2 | 4;
  authorName?: string;
  sourceVersion?: string;
}

// docs/11-documentation-api.md §7 : Technicien (niveau 5, personnel toujours
// forcé côté serveur), Admin (niveaux 1, 2 ou 4).
export function createKnowledgeDocument(
  token: string,
  input: CreateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  return apiFetch<KnowledgeDocument>("/knowledge/documents", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getKnowledgeDocument(token: string, id: string): Promise<KnowledgeDocument> {
  return apiFetch<KnowledgeDocument>(`/knowledge/documents/${id}`, token);
}

export function deleteKnowledgeDocument(token: string, id: string): Promise<KnowledgeDocument> {
  return apiFetch<KnowledgeDocument>(`/knowledge/documents/${id}`, token, {
    method: "DELETE",
  });
}

// docs/10-architecture-rag.md §11 (Agent Documentation, apprentissage
// continu), docs/11-documentation-api.md §7.
export type KnowledgeArticleStatus = "PROPOSED" | "APPROVED" | "REJECTED";

export interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  status: KnowledgeArticleStatus;
  createdAt: string;
  decidedAt: string | null;
  // docs/06-cas-utilisation.md UC-015 : un article peut aussi provenir d'une
  // résolution automatique (pas de ticket) — ticket est alors null.
  ticket: { id: string; reference: string; title: string } | null;
  approvedBy: { id: string; displayName: string; email: string } | null;
}

export function getPendingKnowledgeArticles(token: string): Promise<KnowledgeArticle[]> {
  return apiFetch<KnowledgeArticle[]>("/knowledge/articles/pending", token);
}

export function decideKnowledgeArticle(
  token: string,
  id: string,
  decision: "APPROVED" | "REJECTED",
): Promise<KnowledgeArticle> {
  return apiFetch<KnowledgeArticle>(`/knowledge/articles/${id}/approve`, token, {
    method: "PATCH",
    body: JSON.stringify({ decision }),
  });
}

export interface SlaPolicy {
  id: string;
  priorityId: string;
  priority: Priority;
  resolutionHours: number;
  createdAt: string;
}

export function getSlaPolicies(token: string): Promise<SlaPolicy[]> {
  return apiFetch<SlaPolicy[]>("/sla-policies", token);
}

export function updateSlaPolicy(
  token: string,
  priorityId: string,
  resolutionHours: number,
): Promise<SlaPolicy> {
  return apiFetch<SlaPolicy>(`/sla-policies/${priorityId}`, token, {
    method: "PATCH",
    body: JSON.stringify({ resolutionHours }),
  });
}

export interface Department {
  id: string;
  name: string;
}

export function getDepartments(token: string): Promise<Department[]> {
  return apiFetch<Department[]>("/departments", token);
}

export interface Team {
  id: string;
  name: string;
  categoryId: string | null;
  category: TicketCategory | null;
  createdAt: string;
  _count: { members: number };
}

export function getTeams(token: string): Promise<Team[]> {
  return apiFetch<Team[]>("/teams", token);
}

export interface CreateTeamInput {
  name: string;
  categoryId?: string;
}

export function createTeam(token: string, input: CreateTeamInput): Promise<Team> {
  return apiFetch<Team>("/teams", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface UpdateTeamInput {
  name?: string;
  categoryId?: string | null;
}

export function updateTeam(token: string, id: string, input: UpdateTeamInput): Promise<Team> {
  return apiFetch<Team>(`/teams/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// docs/06-cas-utilisation.md UC-031 étape 3, docs/05-user-stories.md US-13 :
// spécialités d'un technicien, indépendantes de son équipe (teamId).
export interface TechnicianSpecialty {
  categoryId: string;
  category: TicketCategory;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  departmentId: string | null;
  department: Department | null;
  teamId: string | null;
  team: Team | null;
  isActive: boolean;
  canApproveAutomations: boolean;
  createdAt: string;
  specialties: TechnicianSpecialty[];
}

export function getUsers(token: string): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>("/users", token);
}

export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
  role: Role;
  departmentId?: string;
  teamId?: string;
}

export function createUser(token: string, input: CreateUserInput): Promise<AdminUser> {
  return apiFetch<AdminUser>("/users", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface UpdateUserInput {
  role?: Role;
  isActive?: boolean;
  departmentId?: string;
  teamId?: string | null;
  canApproveAutomations?: boolean;
}

export function updateUser(token: string, id: string, input: UpdateUserInput): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/users/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// docs/11-documentation-api.md §3 : remplace intégralement l'ensemble des
// spécialités du technicien (Admin uniquement).
export function updateUserSpecialties(
  token: string,
  id: string,
  categoryIds: string[],
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/users/${id}/specialties`, token, {
    method: "PATCH",
    body: JSON.stringify({ categoryIds }),
  });
}

export interface CreateTicketInput {
  categoryId: string;
  priorityId: string;
  title: string;
  summary?: string;
  ciId?: string;
  conversationId?: string;
  // docs/02-brd.md BR-07 : catégorie/priorité suggérée par l'IA, figée au
  // moment du diagnostic — alimente le taux de correction manuelle du
  // tableau de bord. Omis quand le ticket n'est pas issu du flux IA.
  aiSuggestedCategoryId?: string;
  aiSuggestedPriorityId?: string;
}

export function createTicket(token: string, input: CreateTicketInput): Promise<Ticket> {
  return apiFetch<Ticket>("/tickets", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface SuggestedTechnician {
  id: string;
  displayName: string;
  email: string;
  openTicketCount: number;
}

export function suggestTechnician(token: string, ticketId: string): Promise<SuggestedTechnician> {
  return apiFetch<SuggestedTechnician>(`/tickets/${ticketId}/suggest-technician`, token, {
    method: "POST",
  });
}

// docs/09-architecture-agents-ia.md §3.3 (Agent Technicien) : explique une
// panne/commande/script à partir du contexte du ticket et de l'historique
// CMDB de l'actif concerné — suggère un script à titre indicatif, ne
// l'exécute jamais (toute exécution réelle passe par le module Automation).
export interface TechnicianAssistResult {
  explanation: string;
  suggestedScript: string | null;
  degraded: boolean;
  conversationId: string;
}

export function assistTechnician(
  token: string,
  ticketId: string,
  question: string,
): Promise<TechnicianAssistResult> {
  return apiFetch<TechnicianAssistResult>(`/tickets/${ticketId}/assist`, token, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export interface TicketDiagnosis {
  title: string;
  categoryId: string;
  categoryName: string;
  priorityId: string;
  priorityName: string;
  degraded: boolean;
  conversationId: string;
}

export function aiDiagnoseTicket(token: string, description: string): Promise<TicketDiagnosis> {
  return apiFetch<TicketDiagnosis>("/tickets/ai-diagnose", token, {
    method: "POST",
    body: JSON.stringify({ description }),
  });
}

// docs/06-cas-utilisation.md UC-001 étapes 1-6, docs/09-architecture-agents-
// ia.md §3.2 (Agent Help Desk) : dialogue multi-tour — au plus une question
// de clarification à la fois, puis un diagnostic (cause probable + étapes
// de self-service) avant toute création de ticket.
export interface ConversationalDiagnosis {
  title: string;
  categoryId: string;
  categoryName: string;
  priorityId: string;
  priorityName: string;
  degraded: boolean;
  causeProbable: string;
  suggestedSteps: string[];
  confidence: number;
}

export type DiagnosticTurnResult =
  | { status: "NEEDS_INFO"; conversationId: string; question: string }
  | { status: "DIAGNOSED"; conversationId: string; diagnosis: ConversationalDiagnosis };

export function startOrContinueDiagnostic(
  token: string,
  input: { message: string; conversationId?: string },
): Promise<DiagnosticTurnResult> {
  return apiFetch<DiagnosticTurnResult>("/diagnostics", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// docs/06-cas-utilisation.md UC-001 étape 6 (US-02/US-03).
export type ResolveDiagnosticResult = { status: "RESOLVED" } | { status: "PERSISTS" };

export function resolveDiagnosticConversation(
  token: string,
  conversationId: string,
  resolved: boolean,
): Promise<ResolveDiagnosticResult> {
  return apiFetch<ResolveDiagnosticResult>(`/diagnostics/${conversationId}/resolve`, token, {
    method: "POST",
    body: JSON.stringify({ resolved }),
  });
}

// docs/06-cas-utilisation.md UC-015 ("Résolution automatique"), RM-03 : ne
// propose une résolution automatique que pour un script non sensible avec
// une confiance >= 95% — jamais en mode dégradé.
export type AutoResolveProposal =
  | { eligible: false }
  | {
      eligible: true;
      scriptId: string;
      scriptName: string;
      confidence: number;
      explanation: string;
    };

export function proposeAutoResolution(
  token: string,
  description: string,
): Promise<AutoResolveProposal> {
  return apiFetch<AutoResolveProposal>("/automation/auto-resolve", token, {
    method: "POST",
    body: JSON.stringify({ description }),
  });
}

export type AutoResolveConfirmResult =
  | { status: "RESOLVED"; outputLog: string; autoResolutionId: string }
  | { status: "FAILED_FALLBACK"; ticketId: string; autoResolutionId: string };

export function confirmAutoResolution(
  token: string,
  input: { description: string; scriptId: string; confidence: number },
): Promise<AutoResolveConfirmResult> {
  return apiFetch<AutoResolveConfirmResult>("/automation/auto-resolve/confirm", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface TicketComment {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; displayName: string; email: string; role: Role };
}

export function getComments(token: string, ticketId: string): Promise<TicketComment[]> {
  return apiFetch<TicketComment[]>(`/tickets/${ticketId}/comments`, token);
}

export function createComment(token: string, ticketId: string, content: string): Promise<TicketComment> {
  return apiFetch<TicketComment>(`/tickets/${ticketId}/comments`, token, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export interface TicketAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedBy: { id: string; displayName: string; email: string; role: Role };
}

export const ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
].join(",");

export function getAttachments(token: string, ticketId: string): Promise<TicketAttachment[]> {
  return apiFetch<TicketAttachment[]>(`/tickets/${ticketId}/attachments`, token);
}

export async function uploadAttachment(
  token: string,
  ticketId: string,
  file: File,
): Promise<TicketAttachment> {
  const formData = new FormData();
  formData.append("file", file);

  // Deliberately not using apiFetch: it always sets Content-Type: application/json
  // when a body is present, which would strip the multipart boundary the browser
  // sets automatically for FormData.
  const response = await fetchWithAuthRetry(`/tickets/${ticketId}/attachments`, token, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  return response.json();
}

export async function downloadAttachment(
  token: string,
  ticketId: string,
  attachmentId: string,
): Promise<Blob> {
  const response = await fetchWithAuthRetry(
    `/tickets/${ticketId}/attachments/${attachmentId}/download`,
    token,
  );

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  return response.blob();
}

export type NotificationType =
  | "TICKET_ASSIGNED"
  | "NEW_COMMENT"
  | "STATUS_CHANGED"
  | "SLA_BREACHED"
  | "APPROVAL_REQUESTED"
  | "AUTOMATION_DECIDED";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  ticketId: string | null;
  isRead: boolean;
  createdAt: string;
}

export function getNotifications(token: string): Promise<Notification[]> {
  return apiFetch<Notification[]>("/notifications", token);
}

export function markNotificationAsRead(token: string, id: string): Promise<Notification> {
  return apiFetch<Notification>(`/notifications/${id}/read`, token, { method: "PATCH" });
}

export interface DashboardStats {
  totalOpen: number;
  totalResolved: number;
  averageResolutionHours: number | null;
  slaComplianceRate: number | null;
  // docs/02-brd.md BR-07 : % des tickets issus du flux IA dont la
  // catégorie/priorité finale diffère de la suggestion. null si aucun
  // ticket issu du flux IA sur la période.
  aiCorrectionRate: number | null;
  byCategory: { categoryId: string; categoryName: string; count: number }[];
  byTechnician: { technicianId: string; technicianName: string; count: number }[];
}

export interface DashboardStatsFilter {
  from?: string;
  to?: string;
}

export function getDashboardStats(
  token: string,
  filter: DashboardStatsFilter = {},
): Promise<DashboardStats> {
  const params = new URLSearchParams();
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  const query = params.toString();
  return apiFetch<DashboardStats>(`/dashboard/stats${query ? `?${query}` : ""}`, token);
}

export type DashboardExportFormat = "csv" | "pdf";

export async function exportDashboardReport(
  token: string,
  format: DashboardExportFormat,
  filter: DashboardStatsFilter = {},
): Promise<{ blob: Blob; filename: string }> {
  const params = new URLSearchParams({ format });
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);

  const response = await fetchWithAuthRetry(`/dashboard/export?${params.toString()}`, token);

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = /filename="([^"]+)"/.exec(disposition);
  const filename = filenameMatch?.[1] ?? `rapport-tickets.${format}`;

  return { blob: await response.blob(), filename };
}

export type ActorType = "USER" | "AI_AGENT" | "SYSTEM";

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorType: ActorType;
  action: string;
  targetType: string;
  targetId: string;
  ipAddress: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
  actor: { id: string; displayName: string; email: string } | null;
}

export interface AuditLogFilter {
  targetType?: string;
  from?: string;
  to?: string;
}

export function getAuditLogs(token: string, filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (filter.targetType) params.set("targetType", filter.targetType);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  const query = params.toString();
  return apiFetch<AuditLogEntry[]>(`/audit-logs${query ? `?${query}` : ""}`, token);
}

// docs/06-cas-utilisation.md UC-014/UC-022, docs/09-architecture-agents-ia.md
// §3.5, docs/11-documentation-api.md §8 — module Automation.
export type ScriptLanguage = "POWERSHELL" | "CMD" | "BASH" | "PYTHON";

export interface Script {
  id: string;
  name: string;
  language: ScriptLanguage;
  content: string;
  isSensitive: boolean;
  createdAt: string;
}

export function getScripts(token: string): Promise<Script[]> {
  return apiFetch<Script[]>("/automation/scripts", token);
}

export interface CreateScriptInput {
  name: string;
  language: ScriptLanguage;
  content: string;
  isSensitive?: boolean;
}

export function createScript(token: string, input: CreateScriptInput): Promise<Script> {
  return apiFetch<Script>("/automation/scripts", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type AutomationRunStatus = "PENDING_APPROVAL" | "RUNNING" | "SUCCESS" | "FAILED" | "REJECTED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface AutomationRun {
  id: string;
  script: Script;
  ticket: { id: string; reference: string; title: string } | null;
  requestedBy: { id: string; displayName: string; email: string };
  executedBy: { id: string; displayName: string; email: string } | null;
  justification: string;
  status: AutomationRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  outputLog: string | null;
  createdAt: string;
  approval: Approval | null;
}

export interface Approval {
  id: string;
  automationRunId: string;
  status: ApprovalStatus;
  decidedAt: string | null;
  createdAt: string;
}

export interface PendingApproval extends Approval {
  automationRun: AutomationRun;
}

export interface RequestAutomationRunInput {
  scriptId: string;
  ticketId?: string;
  ciId?: string;
  justification: string;
}

export function requestAutomationRun(
  token: string,
  input: RequestAutomationRunInput,
): Promise<AutomationRun> {
  return apiFetch<AutomationRun>("/automation/runs", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getAutomationRun(token: string, id: string): Promise<AutomationRun> {
  return apiFetch<AutomationRun>(`/automation/runs/${id}`, token);
}

// docs/05-user-stories.md US-28 : prépare (ne demande ni n'exécute jamais)
// un script + justification à partir du contexte du ticket.
export interface AutomationSuggestion {
  scriptId: string;
  scriptName?: string;
  justification: string;
}

export function suggestAutomation(token: string, ticketId: string): Promise<AutomationSuggestion> {
  return apiFetch<AutomationSuggestion>(`/automation/suggest/${ticketId}`, token);
}

export function getPendingApprovals(token: string): Promise<PendingApproval[]> {
  return apiFetch<PendingApproval[]>("/automation/approvals/pending", token);
}

export function decideApproval(
  token: string,
  id: string,
  decision: "APPROVED" | "REJECTED",
  note?: string,
): Promise<AutomationRun> {
  return apiFetch<AutomationRun>(`/automation/approvals/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify({ decision, note }),
  });
}

// docs/11-documentation-api.md §6 : administration des agents IA et du
// fournisseur actif (réservé à l'Admin).
export type AiAgentName =
  | "DIAGNOSTIC"
  | "DOCUMENTATION"
  | "AUTOMATION"
  | "SUPERVISOR"
  | "INVENTORY"
  | "HELPDESK";

export interface AiAgent {
  id: string;
  name: AiAgentName;
  description: string;
  isActive: boolean;
}

export function getAiAgents(token: string): Promise<AiAgent[]> {
  return apiFetch<AiAgent[]>("/ai/agents", token);
}

export function toggleAiAgent(token: string, id: string): Promise<AiAgent> {
  return apiFetch<AiAgent>(`/ai/agents/${id}/toggle`, token, {
    method: "PATCH",
  });
}

export type AiProviderName = "CLAUDE" | "OPENAI" | "AZURE_OPENAI";

export interface AiProviderConfig {
  id: string;
  provider: AiProviderName;
  isActive: boolean;
}

export function getAiProviders(token: string): Promise<AiProviderConfig[]> {
  return apiFetch<AiProviderConfig[]>("/ai/providers", token);
}

export function setActiveAiProvider(
  token: string,
  provider: AiProviderName,
): Promise<AiProviderConfig> {
  return apiFetch<AiProviderConfig>("/ai/providers/active", token, {
    method: "PATCH",
    body: JSON.stringify({ provider }),
  });
}

// docs/11-documentation-api.md §6 : GET /ai/conversations/:id/cost, reserve
// aux roles SUPERVISOR et ADMIN.
export interface AiConversationCost {
  conversationId: string;
  provider: string;
  model: string;
  callCount: number;
  totalTokenCost: number;
  messages: Array<{
    id: string;
    role: "USER" | "AGENT";
    responseTimeMs: number | null;
    tokenCost: number | null;
    createdAt: string;
  }>;
}

export function getAiConversationCost(
  token: string,
  conversationId: string,
): Promise<AiConversationCost> {
  return apiFetch<AiConversationCost>(
    `/ai/conversations/${conversationId}/cost`,
    token,
  );
}

// docs/11-documentation-api.md §5 : historique et feedback d'une
// conversation de diagnostic (docs/08 §4.4).
export type AiMessageRole = "USER" | "AGENT";

export interface AiConversationMessage {
  id: string;
  role: AiMessageRole;
  content: string;
  responseTimeMs: number | null;
  tokenCost: string | null;
  createdAt: string;
}

export interface AiConversationDetail {
  id: string;
  userId: string;
  ticketId: string | null;
  provider: string;
  model: string;
  startedAt: string;
  messages: AiConversationMessage[];
}

export function getDiagnosticConversation(
  token: string,
  conversationId: string,
): Promise<AiConversationDetail> {
  return apiFetch<AiConversationDetail>(`/diagnostics/${conversationId}`, token);
}

export function addDiagnosticFeedback(
  token: string,
  conversationId: string,
  payload: { wasHelpful: boolean; comment?: string },
): Promise<{ id: string; wasHelpful: boolean; comment: string | null }> {
  return apiFetch(`/diagnostics/${conversationId}/feedback`, token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
