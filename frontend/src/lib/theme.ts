export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

// Execute dans <head> avant le premier rendu (voir app/layout.tsx) pour
// appliquer la classe .dark sans flash de theme clair. Choix explicite
// memorise > preference systeme.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}})();`;

export function getTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // stockage indisponible (navigation privee...) : le theme reste applique
    // pour la session en cours
  }
}
