"use client";

import { useEffect, useState, type ReactNode } from "react";
import { refreshAccessTokenSilently } from "@/lib/api";

// docs/07 §9 : l'access token vit uniquement en memoire (voir lib/session.ts)
// et disparait donc a chaque rechargement complet de page. Chaque page fait
// sa propre verification synchrone de getToken() au montage ; sans ce
// composant, un reload perdrait la session meme avec un refresh token encore
// valide en cookie httpOnly. On bloque le rendu des pages le temps d'une
// tentative de refresh silencieux, qui repeuple le token en memoire avant que
// leurs effets ne s'executent.
export function SessionBootstrap({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void refreshAccessTokenSilently().finally(() => {
      if (!cancelled) setIsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isReady) return null;

  return <>{children}</>;
}
