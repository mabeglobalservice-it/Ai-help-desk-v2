"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  // Rendu cote client uniquement (SessionBootstrap bloque le rendu serveur
  // des pages), la classe .dark est donc deja posee par THEME_INIT_SCRIPT.
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Activer le thème sombre" : "Activer le thème clair";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => {
        setTheme(next);
        setThemeState(next);
      }}
    >
      {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
