"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getAuditLogs, type AuditLogEntry } from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

const ALL_TARGET_TYPES = "ALL";
const TARGET_TYPES = ["User", "Team"];

const ACTION_LABELS: Record<string, string> = {
  USER_CREATED: "Utilisateur créé",
  USER_UPDATED: "Utilisateur modifié",
  TEAM_CREATED: "Équipe créée",
  TEAM_UPDATED: "Équipe modifiée",
};

const dateTimeFormatter = new Intl.DateTimeFormat("fr-CA", {
  dateStyle: "medium",
  timeStyle: "short",
});

// Résumé lisible : ne montre que les champs qui ont changé (ou tous les
// champs de afterState si l'entrée correspond à une création).
function formatStateDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string {
  if (!after) return "—";
  if (!before) {
    return Object.entries(after)
      .map(([key, value]) => `${key} : ${String(value)}`)
      .join(", ");
  }

  const changes = Object.keys(after)
    .filter((key) => before[key] !== after[key])
    .map((key) => `${key} : ${String(before[key])} → ${String(after[key])}`);

  return changes.length > 0 ? changes.join(", ") : "Aucun changement";
}

export default function AdminAuditLogsPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetType, setTargetType] = useState(ALL_TARGET_TYPES);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const hasActiveFilter = targetType !== ALL_TARGET_TYPES || fromDate || toDate;

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user && user.role !== "ADMIN") return;
    if (!user) return;

    getAuditLogs(token, {
      targetType: targetType === ALL_TARGET_TYPES ? undefined : targetType,
      from: fromDate || undefined,
      to: toDate || undefined,
    })
      .then((data) => {
        setEntries(data);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearSession();
          router.replace("/login");
          return;
        }
        setError("Impossible de charger le journal d'audit pour le moment.");
      });
  }, [router, user, targetType, fromDate, toDate]);

  function resetFilters() {
    setTargetType(ALL_TARGET_TYPES);
    setFromDate("");
    setToDate("");
  }

  if (user && user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Journal d'audit" />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>Cette page est réservée aux administrateurs.</AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Journal d'audit" />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Journal d&apos;audit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-6 flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audit-target-type">Type de cible</Label>
                <Select value={targetType} onValueChange={(value) => setTargetType(value ?? ALL_TARGET_TYPES)}>
                  <SelectTrigger id="audit-target-type" className="w-40">
                    <SelectValue placeholder="Toutes">
                      {(value: string | null) => (value && value !== ALL_TARGET_TYPES ? value : "Toutes")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_TARGET_TYPES}>Toutes</SelectItem>
                    {TARGET_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audit-from-date">Du</Label>
                <Input
                  id="audit-from-date"
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="w-40"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audit-to-date">Au</Label>
                <Input
                  id="audit-to-date"
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(event) => setToDate(event.target.value)}
                  className="w-40"
                />
              </div>
              {hasActiveFilter ? (
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Réinitialiser
                </Button>
              ) : null}
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : entries === null ? (
              <p className="text-sm text-muted-foreground">Chargement du journal...</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune entrée pour le moment.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Acteur</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Cible</TableHead>
                      <TableHead>Détails</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {dateTimeFormatter.format(new Date(entry.createdAt))}
                        </TableCell>
                        <TableCell>
                          {entry.actor ? (
                            entry.actor.displayName
                          ) : (
                            <span className="text-muted-foreground">{entry.actorType}</span>
                          )}
                        </TableCell>
                        <TableCell>{ACTION_LABELS[entry.action] ?? entry.action}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {entry.targetType} · <span className="font-mono text-xs">{entry.targetId.slice(0, 8)}</span>
                        </TableCell>
                        <TableCell className="max-w-md text-sm text-muted-foreground">
                          {formatStateDiff(entry.beforeState, entry.afterState)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
