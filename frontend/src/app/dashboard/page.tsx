"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  ApiError,
  exportDashboardReport,
  getDashboardStats,
  getModelReliability,
  type DashboardExportFormat,
  type DashboardStats,
  type ModelReliabilityEntry,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
            <Input
              id="dashboard-from-date"
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => setFromDate(event.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashboard-to-date">Au</Label>
            <Input
              id="dashboard-to-date"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => setToDate(event.target.value)}
              className="w-40"
            />
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
                {exportingFormat === "csv" ? "Export..." : "Exporter en CSV"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("pdf")}
                disabled={exportingFormat !== null}
              >
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
          <p className="text-sm text-muted-foreground">Chargement des statistiques...</p>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Card>
                <CardHeader>
                  <CardDescription>SLA respecté</CardDescription>
                  <CardTitle className="text-3xl">
                    {formatPercentage(stats.slaComplianceRate)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Tickets ouverts</CardDescription>
                  <CardTitle className="text-3xl">{stats.totalOpen}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Tickets résolus</CardDescription>
                  <CardTitle className="text-3xl">{stats.totalResolved}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Temps moyen de résolution</CardDescription>
                  <CardTitle className="text-3xl">
                    {formatResolutionTime(stats.averageResolutionHours)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Correction manuelle IA</CardDescription>
                  <CardTitle className="text-3xl">
                    {formatPercentage(stats.aiCorrectionRate)}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Répartition par catégorie</CardTitle>
                  <CardDescription>Nombre de tickets par catégorie</CardDescription>
                </CardHeader>
                <CardContent>
                  {stats.byCategory.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Aucun ticket pour le moment.
                    </p>
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
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Aucun ticket assigné pour le moment.
                    </p>
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
                  <p className="py-8 text-center text-sm text-muted-foreground">Chargement...</p>
                ) : modelReliability.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Aucun équipement avec un fabricant/modèle renseigné pour le moment.
                  </p>
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
          </div>
        )}
      </main>
    </div>
  );
}
