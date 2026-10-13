"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  Gauge,
  Search,
  ShieldCheck,
  Ticket,
  Timer,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import {
  ApiError,
  exportDashboardReport,
  getDashboardStats,
  getModelReliability,
  getRagQualityMetrics,
  getTickets,
  type DashboardExportFormat,
  type DashboardStats,
  type ModelReliabilityEntry,
  type RagQualityMetrics,
  type Ticket as TicketRecord,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { EmptyState } from "@/components/empty-state";
import { InitialsAvatar } from "@/components/initials-avatar";
import {
  PeriodToolbar,
  presetPeriod,
  previousPeriod,
  type Period,
} from "@/components/dashboard/period-toolbar";
import {
  KpiCard,
  KpiCardSkeleton,
  Trend,
  formatDecimal,
  formatDuration,
  formatInteger,
  formatPercent,
} from "@/components/dashboard/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";

const DASHBOARD_ROLES = new Set(["SUPERVISOR", "ADMIN"]);

function formatTrend(entry: ModelReliabilityEntry): string | null {
  if (entry.trendPercent === null) return entry.recentTicketCount > 0 ? "Nouveau" : null;
  const sign = entry.trendPercent > 0 ? "+" : entry.trendPercent < 0 ? "−" : "";
  return `${sign}${formatInteger(Math.abs(entry.trendPercent))} %`;
}

// getRagQualityMetrics renvoie un ratio 0-1 (relevantResponseRate,
// contrairement à DashboardStats qui renvoie déjà un pourcentage 0-100.
function formatRatio(ratio: number): string {
  return formatPercent(ratio * 100);
}

function formatLatency(ms: number): string {
  return ms < 1000 ? `${formatInteger(ms)} ms` : `${formatDecimal(ms / 1000)} s`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" });

function formatPeriod(period: Period): string {
  const day = (iso: string) => format(parseISO(iso), "d MMM yyyy", { locale: fr });
  if (period.from && period.to) {
    return period.from === period.to ? day(period.from) : `${day(period.from)} – ${day(period.to)}`;
  }
  if (period.from) return `Depuis le ${day(period.from)}`;
  if (period.to) return `Jusqu'au ${day(period.to)}`;
  return "Toutes périodes";
}

// Couleurs par categorie : palette docs/12 (navy, vert, ambre, bleu
// derive) — toute autre categorie retombe sur le terracotta de marque.
const CATEGORY_COLORS: Record<string, string> = {
  "Réseau": "var(--color-electric)",
  "Matériel": "var(--color-signal-moss)",
  "Logiciel": "var(--color-signal-amber)",
  "Accès": "var(--color-primary)",
};

function categoryColor(name: string): string {
  return CATEGORY_COLORS[name] ?? "var(--color-terracotta)";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Compte a rebours reel jusqu'a l'echeance SLA, mis a jour chaque seconde.
function SlaCountdown({ dueAt, className }: { dueAt: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const diff = Math.max(0, new Date(dueAt).getTime() - now);
  if (diff <= 0) return <Badge variant="destructive">SLA dépassé</Badge>;

  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);

  return (
    <span className={className}>
      <span aria-hidden="true">
        {pad2(hours)}:{pad2(minutes)}:{pad2(seconds)}
      </span>
      <span className="sr-only">
        {hours} h {minutes} min avant l&apos;échéance
      </span>
    </span>
  );
}

// Bande "Etat du service" (docs/12 §4.5) : seule surface navy de l'ecran,
// affichee uniquement quand le taux de SLA existe sur la periode.
function ServiceStateBand({
  slaRate,
  slaDelta,
  periodLabel,
  nextSlaTicket,
}: {
  slaRate: number;
  slaDelta: number | null;
  periodLabel: string;
  nextSlaTicket: TicketRecord | null;
}) {
  return (
    <section
      aria-labelledby="service-state-title"
      className="grid gap-6 rounded-xl bg-surface-strong p-5 text-surface-strong-foreground @3xl:grid-cols-[minmax(0,1fr)_18rem] md:p-6"
    >
      <div className="min-w-0">
        <h2
          id="service-state-title"
          className="font-mono text-xs tracking-[0.14em] text-surface-strong-muted uppercase"
        >
          État du service · <span className="normal-case tracking-normal">{periodLabel}</span>
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
          <p className="font-mono text-5xl leading-none font-medium tracking-tight tabular-nums">
            {formatPercent(slaRate)}
          </p>
          <div className="flex flex-col gap-1 pb-0.5">
            <p className="font-heading text-lg leading-none font-semibold">SLA respecté</p>
            {slaDelta !== null ? (
              <Trend delta={slaDelta} goodWhen="up" formatDelta={(n) => `${formatDecimal(n)} pt`} onStrong />
            ) : null}
          </div>
        </div>
        <div
          className="mt-5 h-1.5 overflow-hidden rounded-full bg-surface-strong-foreground/15"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full bg-surface-strong-foreground"
            style={{ width: `${Math.min(100, Math.max(0, slaRate))}%` }}
          />
        </div>
      </div>

      <div className="min-w-0 border-t border-surface-strong-foreground/15 pt-5 @3xl:border-t-0 @3xl:border-l @3xl:pt-0 @3xl:pl-6">
        <h3 className="font-mono text-xs tracking-[0.14em] text-surface-strong-muted uppercase">
          Prochaine échéance SLA
        </h3>
        {nextSlaTicket?.slaDueAt ? (
          <>
            <Link
              href={`/tickets/${nextSlaTicket.id}`}
              className="mt-2 block truncate text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-surface-strong-foreground/60"
            >
              {nextSlaTicket.reference} — {nextSlaTicket.title}
            </Link>
            <SlaCountdown
              dueAt={nextSlaTicket.slaDueAt}
              className="mt-2 block font-mono text-3xl leading-none tabular-nums"
            />
          </>
        ) : (
          <p className="mt-2 text-sm text-surface-strong-muted">
            Aucun ticket ouvert n&apos;a d&apos;échéance SLA.
          </p>
        )}
      </div>
    </section>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">
          <h2>{title}</h2>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const user = useSessionUser();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Periode par defaut : 30 derniers jours, pour que les tendances
  // s'affichent des l'ouverture.
  const [period, setPeriod] = useState<Period>(() => presetPeriod("30d"));
  const fromDate = period.from;
  const toDate = period.to;
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<DashboardExportFormat | null>(null);
  const [modelReliability, setModelReliability] = useState<ModelReliabilityEntry[] | null>(null);
  const [modelReliabilityError, setModelReliabilityError] = useState<string | null>(null);
  const [ragMetrics, setRagMetrics] = useState<RagQualityMetrics | null>(null);
  const [ragMetricsError, setRagMetricsError] = useState<string | null>(null);
  // Statistiques de la periode precedente de meme duree, etiquetees par la
  // periode courante a laquelle elles se comparent (evite d'afficher une
  // tendance calculee pour une autre periode pendant un rechargement).
  const [previous, setPrevious] = useState<{ key: string; stats: DashboardStats } | null>(null);
  const [nextSlaTicket, setNextSlaTicket] = useState<TicketRecord | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user && !DASHBOARD_ROLES.has(user.role)) return;
    if (!user) return;

    getDashboardStats(token, { from: fromDate || undefined, to: toDate || undefined })
      .then((data) => {
        setStats(data);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearSession();
          router.replace("/login");
          return;
        }
        setError("Impossible de charger les statistiques pour le moment.");
      });
  }, [router, user, fromDate, toDate]);

  useEffect(() => {
    const token = getToken();
    if (!token || (user && !DASHBOARD_ROLES.has(user.role)) || !user) return;

    getModelReliability(token)
      .then((data) => {
        setModelReliability(data);
        setModelReliabilityError(null);
      })
      .catch(() => {
        setModelReliabilityError("Impossible de charger la fiabilité par modèle pour le moment.");
      });
  }, [user]);

  // Tendances : compare la periode selectionnee a la periode de meme duree
  // qui la precede. Aucune tendance si la periode n'est pas bornee des deux
  // cotes.
  useEffect(() => {
    const token = getToken();
    if (!token || (user && !DASHBOARD_ROLES.has(user.role)) || !user) return;

    const prev = previousPeriod({ from: fromDate, to: toDate });
    if (!prev) return;
    const key = `${fromDate}/${toDate}`;

    getDashboardStats(token, { from: prev.from, to: prev.to })
      .then((data) => setPrevious({ key, stats: data }))
      .catch(() => setPrevious(null));
  }, [user, fromDate, toDate]);

  // Prochain SLA a echeance : uniquement si un vrai ticket ouvert avec une
  // echeance existe.
  useEffect(() => {
    const token = getToken();
    if (!token || (user && !DASHBOARD_ROLES.has(user.role)) || !user) return;

    Promise.all([getTickets(token, { status: "NEW" }), getTickets(token, { status: "IN_PROGRESS" })])
      .then(([newTickets, inProgressTickets]) => {
        const withDeadline = [...newTickets, ...inProgressTickets]
          .filter((t): t is TicketRecord & { slaDueAt: string } => t.slaDueAt !== null)
          .sort((a, b) => new Date(a.slaDueAt).getTime() - new Date(b.slaDueAt).getTime());
        setNextSlaTicket(withDeadline[0] ?? null);
      })
      .catch(() => setNextSlaTicket(null));
  }, [user]);

  useEffect(() => {
    const token = getToken();
    if (!token || (user && !DASHBOARD_ROLES.has(user.role)) || !user) return;

    getRagQualityMetrics(token)
      .then((data) => {
        setRagMetrics(data);
        setRagMetricsError(null);
      })
      .catch(() => {
        setRagMetricsError(
          "Impossible de charger les indicateurs qualité de la recherche pour le moment.",
        );
      });
  }, [user]);

  async function handleExport(exportFormat: DashboardExportFormat) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setExportError(null);
    setExportingFormat(exportFormat);

    try {
      const { blob, filename } = await exportDashboardReport(token, exportFormat, {
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Impossible d'exporter le rapport pour le moment.");
    } finally {
      setExportingFormat(null);
    }
  }

  if (user && !DASHBOARD_ROLES.has(user.role)) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Tableau de bord" />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>
              Le tableau de bord est réservé aux rôles superviseur et administrateur.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  const hasTrendPeriod = previousPeriod(period) !== null;
  const prevStats = hasTrendPeriod && previous?.key === `${fromDate}/${toDate}` ? previous.stats : null;

  const resolutionRateOf = (s: DashboardStats) =>
    s.totalOpen + s.totalResolved > 0 ? (s.totalResolved / (s.totalOpen + s.totalResolved)) * 100 : null;
  const delta = (current: number | null | undefined, before: number | null | undefined) =>
    current === null || current === undefined || before === null || before === undefined
      ? null
      : current - before;

  const resolutionRate = stats ? resolutionRateOf(stats) : null;
  const periodLabel = formatPeriod(period);
  const slaRate = stats?.slaComplianceRate ?? null;
  const pointDelta = (n: number) => `${formatDecimal(n)} pt`;

  // Cartes KPI : meme structure, la carte SLA ne rejoint la rangee que
  // lorsqu'elle n'a pas de donnee (sinon elle vit dans la bande navy).
  interface KpiDef {
    key: string;
    icon: LucideIcon;
    label: string;
    fullLabel?: string;
    value: string | null;
    emptyMessage: string;
    trend: { delta: number | null; goodWhen: "up" | "down"; format: (n: number) => string };
    footer?: ReactNode;
    meter?: number | null;
  }

  const kpis: KpiDef[] = stats
    ? [
        ...(slaRate === null
          ? [
              {
                key: "sla",
                icon: ShieldCheck,
                label: "SLA respecté",
                value: null,
                emptyMessage: "Aucune donnée SLA sur cette période",
                trend: { delta: null, goodWhen: "up" as const, format: pointDelta },
                footer: (
                  <Link
                    href="/admin/sla-policies"
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Voir les politiques SLA
                  </Link>
                ),
              },
            ]
          : []),
        {
          key: "open",
          icon: Ticket,
          label: "Tickets ouverts",
          value: formatInteger(stats.totalOpen),
          emptyMessage: "",
          trend: { delta: delta(stats.totalOpen, prevStats?.totalOpen), goodWhen: "down", format: formatInteger },
        },
        {
          key: "resolved",
          icon: CheckCircle2,
          label: "Tickets résolus",
          value: formatInteger(stats.totalResolved),
          emptyMessage: "",
          trend: {
            delta: delta(stats.totalResolved, prevStats?.totalResolved),
            goodWhen: "up",
            format: formatInteger,
          },
        },
        {
          key: "resolution-rate",
          icon: Gauge,
          label: "Taux de résolution",
          value: resolutionRate === null ? null : formatPercent(resolutionRate),
          emptyMessage: "Aucun ticket sur cette période",
          trend: {
            delta: delta(resolutionRate, prevStats ? resolutionRateOf(prevStats) : null),
            goodWhen: "up",
            format: pointDelta,
          },
          meter: resolutionRate,
        },
        {
          key: "avg-time",
          icon: Timer,
          label: "Délai moyen",
          fullLabel: "Délai moyen de résolution",
          value: stats.averageResolutionHours === null ? null : formatDuration(stats.averageResolutionHours),
          emptyMessage: "Aucun ticket résolu sur cette période",
          trend: {
            delta: delta(stats.averageResolutionHours, prevStats?.averageResolutionHours),
            goodWhen: "down",
            format: formatDuration,
          },
        },
        {
          key: "ai-correction",
          icon: Wand2,
          label: "Correction IA",
          fullLabel: "Tickets IA corrigés manuellement",
          value: stats.aiCorrectionRate === null ? null : formatPercent(stats.aiCorrectionRate),
          emptyMessage: "Aucun ticket créé via l'assistant IA",
          trend: {
            delta: delta(stats.aiCorrectionRate, prevStats?.aiCorrectionRate),
            goodWhen: "down",
            format: pointDelta,
          },
        },
      ]
    : [];

  const maxTechnicianCount = stats ? Math.max(1, ...stats.byTechnician.map((entry) => entry.count)) : 1;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Tableau de bord" />

      <main className="@container mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <div className="flex flex-col gap-6">
          <PeriodToolbar
            period={period}
            onPeriodChange={setPeriod}
            canExport={stats !== null}
            exportingFormat={exportingFormat}
            onExport={handleExport}
          />

          {exportError ? (
            <Alert variant="destructive">
              <AlertDescription>{exportError}</AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : stats === null ? (
            <div className="flex flex-col gap-6" aria-busy="true" aria-label="Chargement des statistiques">
              <Skeleton className="h-44 rounded-xl" />
              <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @5xl:grid-cols-5 md:gap-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <KpiCardSkeleton key={i} />
                ))}
              </div>
            </div>
          ) : (
            <>
              {slaRate !== null ? (
                <ServiceStateBand
                  slaRate={slaRate}
                  slaDelta={delta(slaRate, prevStats?.slaComplianceRate)}
                  periodLabel={periodLabel}
                  nextSlaTicket={nextSlaTicket}
                />
              ) : nextSlaTicket?.slaDueAt ? (
                <Card className="flex-row flex-wrap items-center gap-x-4 gap-y-1 px-4">
                  <Timer className="size-4 text-muted-foreground" aria-hidden="true" />
                  <h2 className="text-sm font-medium text-muted-foreground">Prochaine échéance SLA</h2>
                  <Link
                    href={`/tickets/${nextSlaTicket.id}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {nextSlaTicket.reference} — {nextSlaTicket.title}
                  </Link>
                  <SlaCountdown
                    dueAt={nextSlaTicket.slaDueAt}
                    className="font-mono text-lg tabular-nums text-foreground"
                  />
                </Card>
              ) : null}

              <section aria-label={`Indicateurs clés, ${periodLabel}`}>
                <ul
                  className={
                    kpis.length === 6
                      ? "grid grid-cols-2 gap-3 @xl:grid-cols-3 md:gap-4"
                      : "grid grid-cols-2 gap-3 @xl:grid-cols-3 @5xl:grid-cols-5 md:gap-4"
                  }
                >
                  {kpis.map((kpi) => (
                    <li key={kpi.key} className="min-w-0">
                      <KpiCard
                        icon={kpi.icon}
                        label={kpi.label}
                        fullLabel={kpi.fullLabel}
                        value={kpi.value}
                        emptyMessage={kpi.emptyMessage}
                        trend={
                          kpi.trend.delta !== null ? (
                            <Trend
                              delta={kpi.trend.delta}
                              goodWhen={kpi.trend.goodWhen}
                              formatDelta={kpi.trend.format}
                            />
                          ) : null
                        }
                        footer={kpi.footer}
                      >
                        {kpi.meter !== undefined && kpi.meter !== null ? (
                          <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                            <div
                              className="h-full rounded-full bg-signal-moss"
                              style={{ width: `${Math.min(100, Math.max(0, kpi.meter))}%` }}
                            />
                          </div>
                        ) : null}
                      </KpiCard>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
                <SectionCard title="Répartition par catégorie" description={`Tickets par catégorie · ${periodLabel}`}>
                  {stats.byCategory.length === 0 ? (
                    <EmptyState
                      icon={BarChart3}
                      message="Aucun ticket sur cette période"
                      description="Élargissez la période pour voir la répartition."
                    />
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={stats.byCategory} accessibilityLayer>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis
                          dataKey="categoryName"
                          tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                          axisLine={{ stroke: "var(--color-border)" }}
                          tickLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          width={32}
                        />
                        <Tooltip
                          cursor={{ fill: "var(--color-muted)" }}
                          contentStyle={{
                            background: "var(--color-popover)",
                            border: "1px solid var(--color-border)",
                            borderRadius: "var(--radius-md)",
                            color: "var(--color-popover-foreground)",
                            fontSize: 12,
                          }}
                          labelStyle={{ color: "var(--color-popover-foreground)" }}
                          itemStyle={{ color: "var(--color-popover-foreground)" }}
                        />
                        <Bar dataKey="count" name="Tickets" radius={[4, 4, 0, 0]} maxBarSize={48}>
                          {stats.byCategory.map((entry) => (
                            <Cell key={entry.categoryId} fill={categoryColor(entry.categoryName)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </SectionCard>

                <SectionCard title="Charge par technicien" description="Tickets actifs assignés à chaque technicien">
                  {stats.byTechnician.length === 0 ? (
                    <EmptyState
                      icon={Users}
                      message="Aucun ticket assigné"
                      description="Les tickets assignés à un technicien apparaîtront ici."
                      action={
                        <Link href="/tickets" className={buttonVariants({ variant: "outline", size: "sm" })}>
                          Voir les tickets
                        </Link>
                      }
                    />
                  ) : (
                    <ul className="flex flex-col divide-y divide-border">
                      {stats.byTechnician.map((entry, i) => (
                        <li key={entry.technicianId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                          <InitialsAvatar name={entry.technicianName} index={i} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{entry.technicianName}</p>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${(entry.count / maxTechnicianCount) * 100}%` }}
                              />
                            </div>
                          </div>
                          <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                            {entry.count} actif{entry.count > 1 ? "s" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
              </div>
            </>
          )}

          <SectionCard
            title="Fiabilité par modèle d'équipement"
            description="Tickets des 90 derniers jours comparés aux 90 jours précédents, pour anticiper les remplacements."
          >
            {modelReliabilityError ? (
              <Alert variant="destructive">
                <AlertDescription>{modelReliabilityError}</AlertDescription>
              </Alert>
            ) : modelReliability === null ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : modelReliability.length === 0 ? (
              <EmptyState
                icon={Boxes}
                message="Aucun équipement avec un fabricant et un modèle renseignés"
                description="Renseignez le fabricant et le modèle dans l'inventaire pour suivre leur fiabilité."
                action={
                  <Link
                    href="/admin/configuration-items"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Ouvrir l&apos;inventaire
                  </Link>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Modèle</TableHead>
                      <TableHead className="text-right">Équipements</TableHead>
                      <TableHead className="text-right">Tickets (90 j)</TableHead>
                      <TableHead className="text-right">90 j précédents</TableHead>
                      <TableHead className="text-right">Tendance</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modelReliability.map((entry) => {
                      const trend = formatTrend(entry);
                      return (
                        <TableRow key={entry.modelId}>
                          <TableCell className="font-medium">
                            {entry.manufacturerName} {entry.modelName}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{entry.ciCount}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {entry.recentTicketCount}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {entry.previousTicketCount}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {trend ?? <span className="font-sans text-muted-foreground">Aucun ticket</span>}
                          </TableCell>
                          <TableCell>
                            {entry.atRisk ? (
                              <Badge variant="destructive">À risque</Badge>
                            ) : (
                              <Badge variant="secondary">Stable</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Qualité de la recherche"
            description="Indicateurs calculés à partir des recherches réellement effectuées dans la base de connaissances."
          >
            {ragMetricsError ? (
              <Alert variant="destructive">
                <AlertDescription>{ragMetricsError}</AlertDescription>
              </Alert>
            ) : ragMetrics === null ? (
              <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @5xl:grid-cols-5 md:gap-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <KpiCardSkeleton key={i} />
                ))}
              </div>
            ) : ragMetrics.totalSearches === 0 ? (
              <EmptyState
                icon={Search}
                message="Aucune recherche effectuée pour le moment"
                description="Les indicateurs apparaîtront après les premières recherches dans la base de connaissances."
                action={
                  <Link href="/knowledge" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Ouvrir la base de connaissances
                  </Link>
                }
              />
            ) : (
              <div className="flex flex-col gap-6">
                <ul className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @5xl:grid-cols-5 md:gap-4">
                  <li className="min-w-0">
                    <KpiCard
                      icon={Search}
                      label="Recherches"
                      fullLabel="Recherches effectuées"
                      value={formatInteger(ragMetrics.totalSearches)}
                      emptyMessage=""
                    />
                  </li>
                  <li className="min-w-0">
                    <KpiCard
                      icon={Timer}
                      label="Temps de réponse"
                      fullLabel="Temps moyen de recherche"
                      value={ragMetrics.avgLatencyMs === null ? null : formatLatency(ragMetrics.avgLatencyMs)}
                      emptyMessage="Pas encore mesuré"
                    />
                  </li>
                  <li className="min-w-0">
                    <KpiCard
                      icon={Gauge}
                      label="Confiance"
                      fullLabel="Score moyen de confiance"
                      value={ragMetrics.avgConfidence === null ? null : formatRatio(ragMetrics.avgConfidence)}
                      emptyMessage="Pas encore mesuré"
                    />
                  </li>
                  <li className="min-w-0">
                    <KpiCard
                      icon={CheckCircle2}
                      label="Pertinence"
                      fullLabel="Réponses jugées pertinentes"
                      value={
                        ragMetrics.relevantResponseRate === null
                          ? null
                          : formatRatio(ragMetrics.relevantResponseRate)
                      }
                      emptyMessage="Aucun retour des utilisateurs"
                    />
                  </li>
                  <li className="min-w-0">
                    <KpiCard
                      icon={Wand2}
                      label="Coût IA"
                      fullLabel="Coût des appels IA"
                      value={`${formatDecimal(ragMetrics.aiCost.totalTokenCost)} $`}
                      emptyMessage=""
                    />
                  </li>
                </ul>

                <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
                  <div className="min-w-0">
                    <h3 className="mb-2 text-sm font-medium">Documents les plus consultés</h3>
                    {ragMetrics.topDocuments.length === 0 ? (
                      <EmptyState message="Aucune source renvoyée pour le moment." className="py-6" />
                    ) : (
                      <div className="overflow-hidden rounded-md border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Titre</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead className="text-right">Fois renvoyé</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {ragMetrics.topDocuments.map((doc) => (
                              <TableRow key={doc.originId}>
                                <TableCell className="font-medium">{doc.title}</TableCell>
                                <TableCell>{doc.sourceType}</TableCell>
                                <TableCell className="text-right font-mono tabular-nums">
                                  {doc.timesReturned}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <h3 className="mb-2 text-sm font-medium">Documents jamais renvoyés par une recherche</h3>
                    {ragMetrics.staleDocuments.length === 0 ? (
                      <EmptyState icon={CheckCircle2} message="Aucun document inutilisé détecté." className="py-6" />
                    ) : (
                      <div className="overflow-hidden rounded-md border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Titre</TableHead>
                              <TableHead>Niveau</TableHead>
                              <TableHead>Ajouté le</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {ragMetrics.staleDocuments.map((doc) => (
                              <TableRow key={doc.id}>
                                <TableCell className="font-medium">{doc.title}</TableCell>
                                <TableCell>{doc.knowledgeLevel}</TableCell>
                                <TableCell>{dateTimeFormatter.format(new Date(doc.createdAt))}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </main>
    </div>
  );
}
