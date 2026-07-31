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

export type Criticality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type CiStatus = "ACTIVE" | "IN_REPAIR" | "RETIRED";

export interface ConfigurationItem {
  id: string;
  ciTypeId: string;
  ciType: CiType;
  name: string;
  inventoryNumber: string;
  serialNumber: string | null;
  criticality: Criticality;
  status: CiStatus;
  createdAt: string;
}

export interface ConfigurationItemDetail extends ConfigurationItem {
  tickets: {
    id: string;
    reference: string;
    title: string;
    status: TicketStatus;
    createdAt: string;
  }[];
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

export type UpdateConfigurationItemInput = Partial<CreateConfigurationItemInput>;

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

export interface KnowledgeSearchResult {
  id: string;
  reference: string;
  title: string;
  summary: string | null;
  resolvedAt: string | null;
  categoryName: string;
  priorityName: string;
  rank: number;
  snippet: string;
}

export function searchKnowledge(token: string, q: string): Promise<KnowledgeSearchResult[]> {
  const params = new URLSearchParams({ q });
  return apiFetch<KnowledgeSearchResult[]>(`/knowledge/search?${params.toString()}`, token);
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
  createdAt: string;
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
}

export function updateUser(token: string, id: string, input: UpdateUserInput): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/users/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface CreateTicketInput {
  categoryId: string;
  priorityId: string;
  title: string;
  summary?: string;
  ciId?: string;
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

export interface TicketDiagnosis {
  title: string;
  categoryId: string;
  categoryName: string;
  priorityId: string;
  priorityName: string;
  degraded: boolean;
}

export function aiDiagnoseTicket(token: string, description: string): Promise<TicketDiagnosis> {
  return apiFetch<TicketDiagnosis>("/tickets/ai-diagnose", token, {
    method: "POST",
    body: JSON.stringify({ description }),
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

export type NotificationType = "TICKET_ASSIGNED" | "NEW_COMMENT" | "STATUS_CHANGED" | "SLA_BREACHED";

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
