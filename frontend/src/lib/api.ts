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

export async function getTickets(token: string): Promise<Ticket[]> {
  const response = await fetch(`${API_URL}/tickets`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  return response.json();
}
