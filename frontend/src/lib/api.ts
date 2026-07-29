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

async function apiFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
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

export type TicketStatus = "NEW" | "IN_PROGRESS" | "RESOLVED" | "ESCALATED";

export interface Ticket {
  id: string;
  reference: string;
  title: string;
  summary: string | null;
  status: TicketStatus;
  createdAt: string;
  resolvedAt: string | null;
  employee: { id: string; displayName: string; email: string };
  technician: { id: string; displayName: string; email: string } | null;
  category: { id: string; name: string };
  priority: { id: string; name: string; level: number };
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
  changedBy: { id: string; displayName: string; email: string };
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
}

export function updateTicket(token: string, id: string, input: UpdateTicketInput): Promise<Ticket> {
  return apiFetch<Ticket>(`/tickets/${id}`, token, {
    method: "PATCH",
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

export interface Department {
  id: string;
  name: string;
}

export function getDepartments(token: string): Promise<Department[]> {
  return apiFetch<Department[]>("/departments", token);
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  departmentId: string | null;
  department: Department | null;
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
}

export function updateUser(token: string, id: string, input: UpdateUserInput): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/users/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface CreateTicketInput {
  employeeId: string;
  categoryId: string;
  priorityId: string;
  title: string;
  summary?: string;
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
  const response = await fetch(`${API_URL}/tickets/${ticketId}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
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
  const response = await fetch(`${API_URL}/tickets/${ticketId}/attachments/${attachmentId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  return response.blob();
}

export type NotificationType = "TICKET_ASSIGNED" | "NEW_COMMENT" | "STATUS_CHANGED";

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
