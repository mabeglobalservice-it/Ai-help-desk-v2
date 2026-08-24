import { cn } from "@/lib/utils";

const AVATAR_TONES = [
  "bg-primary/15 text-primary",
  "bg-terracotta/20 text-terracotta",
  "bg-electric/15 text-electric",
  "bg-signal-moss/15 text-signal-moss",
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
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
