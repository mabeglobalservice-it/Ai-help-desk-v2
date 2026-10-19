import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const decimal = new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 0 });

export const formatDecimal = (n: number) => decimal.format(n);
export const formatInteger = (n: number) => integer.format(Math.round(n));
export const formatPercent = (n: number) => `${decimal.format(n)} %`;

export function formatDuration(hours: number): string {
  return hours < 24 ? `${decimal.format(hours)} h` : `${decimal.format(hours / 24)} j`;
}

export interface TrendProps {
  // Ecart brut entre la periode courante et la precedente (meme unite que
  // la valeur affichee : points de %, nombre de tickets, heures).
  delta: number;
  formatDelta: (absDelta: number) => string;
  // Sens favorable : "up" si une hausse est une bonne nouvelle.
  goodWhen: "up" | "down";
  // Variante pour la bande navy (couleurs adaptees a la surface forte).
  onStrong?: boolean;
}

// Tendance : fleche + valeur signee + texte (jamais la couleur seule,
// docs/12 §3).
export function Trend({ delta, formatDelta, goodWhen, onStrong = false }: TrendProps) {
  const rounded = Math.round(delta * 10) / 10;
  const direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const good = direction !== "flat" && direction === goodWhen;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;
  const sign = direction === "up" ? "+" : direction === "down" ? "−" : "";
  const tone =
    direction === "flat"
      ? onStrong
        ? "text-surface-strong-muted"
        : "text-muted-foreground"
      : good
        ? onStrong
          ? "text-surface-strong-up"
          : "text-signal-moss-fg"
        : onStrong
          ? "text-surface-strong-down"
          : "text-terracotta-fg";

  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs whitespace-nowrap">
      <span className={cn("inline-flex items-center gap-0.5 font-mono font-medium tabular-nums", tone)}>
        <Icon className="size-3.5" aria-hidden="true" />
        {direction === "flat" ? "Stable" : `${sign}${formatDelta(Math.abs(rounded))}`}
      </span>
      <span className={cn("truncate", onStrong ? "text-surface-strong-muted" : "text-muted-foreground")}>
        vs période préc.
      </span>
    </span>
  );
}

// Texte de remplacement de la tendance quand aucune comparaison n'est
// possible (periode precedente vide, non bornee ou indisponible).
export function NoComparison({ onStrong = false }: { onStrong?: boolean }) {
  return (
    <span
      className={cn(
        "truncate text-xs",
        onStrong ? "text-surface-strong-muted" : "text-muted-foreground",
      )}
    >
      Pas de comparaison disponible
    </span>
  );
}

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  // Libelle complet si `label` est abrege (infobulle + lecteurs d'ecran).
  fullLabel?: string;
  value: string | null;
  // Message affiche a la place de la valeur quand elle est absente.
  emptyMessage: string;
  // Explication courte du chiffre, affichee sous la valeur.
  hint?: string;
  trend?: ReactNode;
  // Pied de carte quand il n'y a pas de valeur (ex. action suggeree).
  footer?: ReactNode;
  children?: ReactNode;
}

// Structure fixe (libelle / valeur / explication / tendance) : la valeur est
// a la meme hauteur sur toutes les cartes d'une rangee, et la ligne de
// tendance est poussee en bas de carte pour rester alignee elle aussi.
export function KpiCard({
  icon: Icon,
  label,
  fullLabel,
  value,
  emptyMessage,
  hint,
  trend,
  footer,
  children,
}: KpiCardProps) {
  const bottom = value !== null ? (trend ?? footer) : (footer ?? trend);
  return (
    <Card className="@container h-full gap-0 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-medium text-muted-foreground" title={fullLabel ?? label}>
          {fullLabel ? (
            <>
              <span aria-hidden="true">{label}</span>
              <span className="sr-only">{fullLabel}</span>
            </>
          ) : (
            label
          )}
        </h3>
        {/* Icone masquee sur les cartes etroites : le libelle a priorite. */}
        <Icon className="hidden size-4 shrink-0 text-muted-foreground @[11rem]:block" aria-hidden="true" />
      </div>
      <div className="mt-3 flex h-10 items-end">
        {value === null ? (
          <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">{emptyMessage}</p>
        ) : (
          <p className="font-mono text-[1.75rem] leading-none font-medium tracking-tight text-foreground tabular-nums">
            {value}
          </p>
        )}
      </div>
      {hint && value !== null ? (
        <p className="mt-2 line-clamp-2 text-xs leading-snug text-muted-foreground">{hint}</p>
      ) : null}
      <div className="mt-auto flex min-h-5 items-center pt-3">{bottom}</div>
      {children}
    </Card>
  );
}

export function KpiCardSkeleton() {
  return (
    <Card className="h-full gap-0 px-4 py-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-10 w-20" />
      <Skeleton className="mt-3 h-4 w-28" />
    </Card>
  );
}
