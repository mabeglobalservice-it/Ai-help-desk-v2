"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ShieldCheck,
  Ticket,
  CheckCircle2,
  Timer,
  Wand2,
  FileSpreadsheet,
  FileText,
  BarChart3,
  Users,
  Boxes,
  Search,
  Gauge,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ApiError,
  exportDashboardReport,
  getDashboardStats,
  getModelReliability,
  getRagQualityMetrics,
  type DashboardExportFormat,
  type DashboardStats,
  type ModelReliabilityEntry,
  type RagQualityMetrics,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { EmptyState } from "@/components/empty-state";
import { DateField } from "@/components/date-field";
import { CountUp } from "@/components/count-up";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

function formatTrend(entry: ModelReliabilityEntry): string {
  if (entry.trendPercent === null) return entry.recentTicketCount > 0 ? "Nouveau" : "—";
  const sign = entry.trendPercent > 0 ? "+" : "";
  return `${sign}${entry.trendPercent} %`;
}

const DASHBOARD_ROLES = new Set(["SUPERVISOR", "ADMIN"]);

function formatResolutionTime(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} j`;
}

function formatPercentage(rate: number | null): string {
  if (rate === null) return "—";
  return `${rate.toFixed(1)} %`;
}

// getRagQualityMetrics renvoie un ratio 0-1 (relevantResponseRate,
// contrairement à DashboardStats qui renvoie déjà un pourcentage 0-100.
function formatRatio(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${(ratio * 100).toFixed(1)} %`;
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" });

type KpiTone = "primary" | "amber" | "moss" | "slate" | "terracotta";

// Icones des cartes KPI : degrade a deux tons plutot qu'un aplat, sur une
// base douce (opacite 10-25%) pour rester un badge discret, pas un bloc
// sature. "primary" reprend l'exemple terracotta -> corail donne pour SLA ;
// "moss" emeraude -> vert clair pour Tickets resolus.
const KPI_TONE_CLASSES: Record<KpiTone, string> = {
  primary: "bg-gradient-to-br from-terracotta/25 to-signal-rust/15 text-terracotta",
  amber: "bg-gradient-to-br from-signal-amber/25 to-signal-amber/10 text-signal-amber",
  moss: "bg-gradient-to-br from-signal-moss/25 to-signal-moss/10 text-signal-moss",
  slate: "bg-gradient-to-br from-electric/20 to-signal-slate/10 text-signal-slate",
  terracotta: "bg-gradient-to-br from-electric/20 to-terracotta/20 text-terracotta",
};

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  format,
  index,
}: {
  icon: LucideIcon;
  tone: KpiTone;
  label: string;
  value: number | null;
  format: (n: number) => string;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05 }}
      whileHover={{ scale: 1.02, transition: { duration: 0.15 } }}
    >
      <Card className="transition-shadow duration-150 hover:shadow-lg">
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="text-3xl">
            {value === null ? "—" : <CountUp value={value} format={format} />}
          </CardTitle>
          <CardAction>
            <div className={cn("flex size-9 items-center justify-center rounded-full", KPI_TONE_CLASSES[tone])}>
              <Icon className="size-4.5" aria-hidden="true" />
            </div>
          </CardAction>
        </CardHeader>
      </Card>
    </motion.div>
  );
}

function KpiCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-8 w-16" />
        <CardAction>
          <Skeleton className="size-9 rounded-full" />
        </CardAction>
      </CardHeader>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const user = useSessionUser();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<DashboardExportFormat | null>(null);
  const [modelReliability, setModelReliability] = useState<ModelReliabilityEntry[] | null>(null);
  const [modelReliabilityError, setModelReliabilityError] = useState<string | null>(null);
  const [ragMetrics, setRagMetrics] = useState<RagQualityMetrics | null>(null);
  const [ragMetricsError, setRagMetricsError] = useState<string | null>(null);

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

  function resetDateFilter() {
    setFromDate("");
    setToDate("");
  }

  async function handleExport(format: DashboardExportFormat) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setExportError(null);
    setExportingFormat(format);

    try {
      const { blob, filename } = await exportDashboardReport(token, format, {
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

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Tableau de bord" />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashboard-from-date">Du</Label>
            <DateField id="dashboard-from-date" value={fromDate} max={toDate} onChange={setFromDate} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashboard-to-date">Au</Label>
            <DateField id="dashboard-to-date" value={toDate} min={fromDate} onChange={setToDate} />
          </div>
          {fromDate || toDate ? (
            <Button variant="ghost" size="sm" onClick={resetDateFilter}>
              Réinitialiser
            </Button>
          ) : null}

          {stats ? (
            <div className="ml-auto flex items-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("csv")}
                disabled={exportingFormat !== null}
              >
                <FileSpreadsheet />
                {exportingFormat === "csv" ? "Export..." : "Exporter en CSV"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("pdf")}
                disabled={exportingFormat !== null}
              >
                <FileText />
                {exportingFormat === "pdf" ? "Export..." : "Exporter en PDF"}
              </Button>
            </div>
          ) : null}
        </div>

        {exportError ? (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : stats === null ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <KpiCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard
                index={0}
                icon={ShieldCheck}
                tone="primary"
                label="SLA respecté"
                value={stats.slaComplianceRate}
                format={(n) => formatPercentage(n)}
              />
              <KpiCard
                index={1}
                icon={Ticket}
                tone="amber"
                label="Tickets ouverts"
                value={stats.totalOpen}
                format={(n) => String(Math.round(n))}
              />
              <KpiCard
                index={2}
                icon={CheckCircle2}
                tone="moss"
                label="Tickets résolus"
                value={stats.totalResolved}
                format={(n) => String(Math.round(n))}
              />
              <KpiCard
                index={3}
                icon={Timer}
                tone="slate"
                label="Temps moyen de résolution"
                value={stats.averageResolutionHours}
                format={(n) => formatResolutionTime(n)}
              />
              <KpiCard
                index={4}
                icon={Wand2}
                tone="terracotta"
                label="Correction manuelle IA"
                value={stats.aiCorrectionRate}
                format={(n) => formatPercentage(n)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Répartition par catégorie</CardTitle>
                  <CardDescription>Nombre de tickets par catégorie</CardDescription>
                </CardHeader>
                <CardContent>
                  {stats.byCategory.length === 0 ? (
                    <EmptyState icon={BarChart3} message="Aucun ticket pour le moment." />
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={stats.byCategory}>
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
                        />
                        <Bar dataKey="count" name="Tickets" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Répartition par technicien</CardTitle>
                  <CardDescription>Tickets assignés à chaque technicien</CardDescription>
                </CardHeader>
                <CardContent>
                  {stats.byTechnician.length === 0 ? (
                    <EmptyState icon={Users} message="Aucun ticket assigné pour le moment." />
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(260, stats.byTechnician.length * 40)}>
                      <BarChart data={stats.byTechnician} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                        <XAxis
                          type="number"
                          allowDecimals={false}
                          tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                          axisLine={{ stroke: "var(--color-border)" }}
                          tickLine={false}
                        />
                        <YAxis
                          type="category"
                          dataKey="technicianName"
                          width={110}
                          tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
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
                        />
                        <Bar dataKey="count" name="Tickets" fill="var(--color-chart-2)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Fiabilité par modèle d&apos;équipement</CardTitle>
                <CardDescription>
                  US-27 : tendance du nombre de tickets par modèle sur 90 jours, pour anticiper les
                  remplacements.
                </CardDescription>
              </CardHeader>
              <CardContent>
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
                    message="Aucun équipement avec un fabricant/modèle renseigné pour le moment."
                  />
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Modèle</TableHead>
                          <TableHead>Équipements</TableHead>
                          <TableHead>Tickets (90j)</TableHead>
                          <TableHead>Tickets (90j précédents)</TableHead>
                          <TableHead>Tendance</TableHead>
                          <TableHead>Statut</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {modelReliability.map((entry) => (
                          <TableRow key={entry.modelId}>
                            <TableCell className="font-medium">
                              {entry.manufacturerName} {entry.modelName}
                            </TableCell>
                            <TableCell>{entry.ciCount}</TableCell>
                            <TableCell>{entry.recentTicketCount}</TableCell>
                            <TableCell>{entry.previousTicketCount}</TableCell>
                            <TableCell>{formatTrend(entry)}</TableCell>
                            <TableCell>
                              {entry.atRisk ? (
                                <Badge variant="destructive">À risque</Badge>
                              ) : (
                                <Badge variant="secondary">Stable</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Qualité de la recherche RAG</CardTitle>
                <CardDescription>
                  docs/10-architecture-rag.md §12 : indicateurs calculés à partir des recherches
                  réellement effectuées (aucune valeur estimée).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {ragMetricsError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{ragMetricsError}</AlertDescription>
                  </Alert>
                ) : ragMetrics === null ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <KpiCardSkeleton key={i} />
                    ))}
                  </div>
                ) : ragMetrics.totalSearches === 0 ? (
                  <EmptyState icon={Search} message="Aucune recherche effectuée pour le moment." />
                ) : (
                  <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                      <KpiCard
                        index={0}
                        icon={Search}
                        tone="primary"
                        label="Recherches effectuées"
                        value={ragMetrics.totalSearches}
                        format={(n) => String(Math.round(n))}
                      />
                      <KpiCard
                        index={1}
                        icon={Timer}
                        tone="slate"
                        label="Temps moyen de recherche"
                        value={ragMetrics.avgLatencyMs}
                        format={(n) => formatLatency(n)}
                      />
                      <KpiCard
                        index={2}
                        icon={Gauge}
                        tone="amber"
                        label="Score moyen de confiance"
                        value={ragMetrics.avgConfidence}
                        format={(n) => formatRatio(n)}
                      />
                      <KpiCard
                        index={3}
                        icon={CheckCircle2}
                        tone="moss"
                        label="Réponses pertinentes"
                        value={ragMetrics.relevantResponseRate}
                        format={(n) => formatRatio(n)}
                      />
                      <KpiCard
                        index={4}
                        icon={Wand2}
                        tone="terracotta"
                        label="Coût des appels IA"
                        value={ragMetrics.aiCost.totalTokenCost}
                        format={(n) => `${n.toFixed(2)} $`}
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-sm font-medium">
                          Documents les plus consultés
                        </h3>
                        {ragMetrics.topDocuments.length === 0 ? (
                          <EmptyState message="Aucune source renvoyée pour le moment." className="py-6" />
                        ) : (
                          <div className="overflow-hidden rounded-md border border-border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Titre</TableHead>
                                  <TableHead>Type</TableHead>
                                  <TableHead>Fois renvoyé</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {ragMetrics.topDocuments.map((doc) => (
                                  <TableRow key={doc.originId}>
                                    <TableCell className="font-medium">{doc.title}</TableCell>
                                    <TableCell>{doc.sourceType}</TableCell>
                                    <TableCell>{doc.timesReturned}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>

                      <div>
                        <h3 className="mb-2 text-sm font-medium">
                          Documents obsolètes (jamais renvoyés par une recherche)
                        </h3>
                        {ragMetrics.staleDocuments.length === 0 ? (
                          <EmptyState icon={CheckCircle2} message="Aucun document obsolète détecté." className="py-6" />
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
                                    <TableCell>
                                      {dateTimeFormatter.format(new Date(doc.createdAt))}
                                    </TableCell>
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
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
