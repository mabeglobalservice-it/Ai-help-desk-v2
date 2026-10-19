import { cn } from "@/lib/utils";

const AVATAR_TONES = [
  "bg-primary/15 text-primary",
  "bg-terracotta/20 text-terracotta",
  "bg-electric/15 text-electric",
  "bg-signal-moss/15 text-signal-moss",
];

// Ignore le texte entre parentheses (ex. suffixe « (démo) ») et tout
// caractere non alphabetique, pour ne jamais afficher « K( » ou « M- ».
function initialsOf(name: string): string {
  const parts = name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toLocaleUpperCase("fr-CA");
}

interface InitialsAvatarProps {
  name: string;
  index?: number;
  className?: string;
}

export function InitialsAvatar({ name, index = 0, className }: InitialsAvatarProps) {
  const tone = AVATAR_TONES[index % AVATAR_TONES.length];
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        tone,
        className,
      )}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </div>
  );
}
