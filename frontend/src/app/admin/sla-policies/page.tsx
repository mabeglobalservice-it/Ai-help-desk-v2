"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getSlaPolicies,
  updateSlaPolicy,
  type SlaPolicy,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AdminSlaPoliciesPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [policies, setPolicies] = useState<SlaPolicy[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [savingPriorityId, setSavingPriorityId] = useState<string | null>(null);

  const isPrivileged = user?.role === "SUPERVISOR" || user?.role === "ADMIN";

  const loadPolicies = useCallback(
    (token: string) => {
      return getSlaPolicies(token)
        .then((data) => {
          setPolicies(data);
          setDrafts(
            Object.fromEntries(
              data.map((policy) => [policy.priorityId, String(policy.resolutionHours)]),
            ),
          );
          setLoadError(null);
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
            router.replace("/login");
            return;
          }
          setLoadError("Impossible de charger les politiques SLA pour le moment.");
        });
    },
    [router],
  );

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user && !isPrivileged) return;
    if (!user) return;

    loadPolicies(token);
  }, [router, user, isPrivileged, loadPolicies]);

  async function handleSave(policy: SlaPolicy) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const draft = drafts[policy.priorityId];
    const resolutionHours = Number(draft);
    if (!Number.isInteger(resolutionHours) || resolutionHours < 1) {
      setRowErrors((prev) => ({
        ...prev,
        [policy.priorityId]: "Le délai doit être un nombre entier d'heures, supérieur à 0.",
      }));
      return;
    }

    setRowErrors((prev) => ({ ...prev, [policy.priorityId]: "" }));
    setSavingPriorityId(policy.priorityId);
    try {
      await updateSlaPolicy(token, policy.priorityId, resolutionHours);
      await loadPolicies(token);
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [policy.priorityId]:
          err instanceof ApiError ? err.message : "Impossible d'enregistrer ce délai pour le moment.",
      }));
    } finally {
      setSavingPriorityId(null);
    }
  }

  if (user && !isPrivileged) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Politiques SLA" />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>
              Cette page est réservée aux superviseurs et administrateurs.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Politiques SLA" />

      <main className="mx-auto max-w-3xl px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Délai de résolution par priorité</CardTitle>
            <CardDescription>
              Un ticket dont le délai est dépassé sans prise en charge est automatiquement
              escaladé. Une modification ne s&apos;applique qu&apos;aux tickets créés après
              l&apos;enregistrement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadError ? (
              <Alert variant="destructive">
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            ) : policies === null ? (
              <p className="text-sm text-muted-foreground">Chargement des politiques SLA...</p>
            ) : policies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune politique SLA configurée.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Priorité</TableHead>
                      <TableHead>Délai de résolution (heures)</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policies.map((policy) => {
                      const isDirty = drafts[policy.priorityId] !== String(policy.resolutionHours);
                      const rowError = rowErrors[policy.priorityId];
                      return (
                        <TableRow key={policy.id}>
                          <TableCell className="font-medium">{policy.priority.name}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Input
                                type="number"
                                min={1}
                                step={1}
                                className="w-24"
                                value={drafts[policy.priorityId] ?? ""}
                                onChange={(event) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [policy.priorityId]: event.target.value,
                                  }))
                                }
                              />
                              {rowError ? (
                                <span className="text-xs text-destructive">{rowError}</span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              disabled={!isDirty || savingPriorityId === policy.priorityId}
                              onClick={() => handleSave(policy)}
                            >
                              {savingPriorityId === policy.priorityId ? "Enregistrement..." : "Enregistrer"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
