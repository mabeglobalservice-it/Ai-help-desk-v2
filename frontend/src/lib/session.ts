import type { SessionUser } from "./api";

const USER_KEY = "ai-help-desk.user";

// docs/07 §9 : l'access token n'est jamais persiste (localStorage/cookie JS-
// lisible) — uniquement garde en memoire, il disparait a chaque rechargement
// complet de page et doit etre restaure via un refresh silencieux
// (voir SessionBootstrap) a partir du refresh token en cookie httpOnly.
let accessToken: string | null = null;

export function saveSession(token: string, user: SessionUser) {
  accessToken = token;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// Used after a silent token refresh: replaces the access token without
// touching the stored user (unchanged across a refresh).
export function updateTokens(token: string) {
  accessToken = token;
}

export function getToken(): string | null {
  return accessToken;
}

export function getSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function clearSession() {
  accessToken = null;
  localStorage.removeItem(USER_KEY);
}
