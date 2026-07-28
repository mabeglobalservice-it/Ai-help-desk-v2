"use client";

import { useEffect, useState } from "react";
import { getSessionUser } from "./session";
import type { SessionUser } from "./api";

/**
 * localStorage isn't available during SSR, so getSessionUser() would return
 * a different value server-side vs. client-side if read directly in render.
 * Deferring to an effect keeps the first render consistent on both sides.
 */
export function useSessionUser(): SessionUser | null {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    // Intentional: this is the mount-only read of a browser-only source
    // (localStorage) that the render-consistency comment above depends on,
    // not state derived from props/state that belongs in render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(getSessionUser());
  }, []);

  return user;
}
