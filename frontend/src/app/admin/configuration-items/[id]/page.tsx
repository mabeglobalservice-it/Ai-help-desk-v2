"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError,
  getConfigurationItem,
  updateConfigurationItem,
  type CiStatus,
  type ConfigurationItemDetail,
  type Criticality,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { STATUS_DISPLAY } from "@/lib/ticket-display";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const CRITICALITY_OPTIONS: { value: Criticality; label: string }[] = [
  { value: "LOW", label: "Faible" },
  { value: "MEDIUM", label: "Moyenne" },
  { value: "HIGH", label: "Haute" },
  { value: "CRITICAL", label: "Critique" },
];

const STATUS_OPTIONS: { value: CiStatus; label: string }[] = [
  { value: "ACTIVE", label: "Actif" },
  { value: "IN_REPAIR", label: "En réparation" },
  { value: "RETIRED", label: "Retiré" },
];

const dateFormatter = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" });

export default function AdminConfigurationItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const user = useSessionUser();

  const [ci, setCi] = useState<ConfigurationItemDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const isPrivileged = user?.role === "SUPERVISOR" || user?.role === "ADMIN";

  const load = useCallback(
    (token: string) => {
      return getConfigurationItem(token, id)
        .then((data) => {
          setCi(data);
          setLoadError(null);
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
            router.replace("/login");
            return;
          }
          setLoadError("Impossible de charger ce Configuration Item pour le moment.");
        });
    },
    [id, router],
  );

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user && !isPrivileged) return;
    if (!user) return;

    load(token);
  }, [router, user, isPrivileged, load]);

  async function handleFieldChange(field: "status" | "criticality", value: string) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setUpdateError(null);
    setIsUpdating(true);
    try {
      await updateConfigurationItem(token, id, { [field]: value });
      await load(token);
    } catch (err) {
      setUpdateError(
        err instanceof ApiError ? err.message : "Impossible d'enregistrer ce changement pour le moment.",
      );
    } finally {
      setIsUpdating(false);
    }
  }

  const backLink = (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/admin/configuration-items" />}>
      Retour à l&apos;inventaire
    </Button>
  );

  if (user && !isPrivileged) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Configuration Item" action={backLink} />
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
      <AppHeader title="Configuration Item" action={backLink} />

      <main className="mx-auto max-w-3xl px-6 py-8">
        {loadError ? (
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : ci === null ? (
          <p className="text-sm text-muted-foreground">Chargement...</p>
        ) : (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">{ci.name}</CardTitle>
                <CardDescription>
                  {ci.ciType.name} · {ci.inventoryNumber}
                  {ci.serialNumber ? ` · N/S ${ci.serialNumber}` : null}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {updateError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{updateError}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">
                      Criticité
                    </p>
                    <Select
                      value={ci.criticality}
                      onValueChange={(value) => value && handleFieldChange("criticality", value as string)}
                      disabled={isUpdating}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(value: string | null) =>
                            CRITICALITY_OPTIONS.find((option) => option.value === value)?.label ?? ""
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {CRITICALITY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <p className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">
                      Statut
                    </p>
                    <Select
                      value={ci.status}
                      onValueChange={(value) => value && handleFieldChange("status", value as string)}
                      disabled={isUpdating}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(value: string | null) =>
                            STATUS_OPTIONS.find((option) => option.value === value)?.label ?? ""
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Tickets liés</CardTitle>
                <CardDescription>
                  Les incidents concernant cet équipement — utile pour évaluer l&apos;impact d&apos;une
                  panne.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {ci.tickets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucun ticket n&apos;est lié à cet équipement pour le moment.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Référence</TableHead>
                          <TableHead>Titre</TableHead>
                          <TableHead>Statut</TableHead>
                          <TableHead>Créé le</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ci.tickets.map((ticket) => (
                          <TableRow key={ticket.id}>
                            <TableCell>
                              <Link href={`/tickets/${ticket.id}`} className="font-mono text-xs hover:underline">
                                {ticket.reference}
                              </Link>
                            </TableCell>
                            <TableCell>{ticket.title}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{STATUS_DISPLAY[ticket.status].label}</Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {dateFormatter.format(new Date(ticket.createdAt))}
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
