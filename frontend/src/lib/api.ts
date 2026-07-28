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

export function getTickets(token: string): Promise<Ticket[]> {
  return apiFetch<Ticket[]>("/tickets", token);
}

export interface TicketStatusHistoryEntry {
  id: string;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  changedBy: string;
  changedAt: string;
}

export interface TicketDetail extends Ticket {
  statusHistory: TicketStatusHistoryEntry[];
}

export function getTicket(token: string, id: string): Promise<TicketDetail> {
  return apiFetch<TicketDetail>(`/tickets/${id}`, token);
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
