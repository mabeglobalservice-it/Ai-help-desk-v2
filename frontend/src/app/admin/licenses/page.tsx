"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, getLicenses, type LicenseListEntry, type LicenseStatus } from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

const LICENSE_ROLES = new Set(["SUPERVISOR", "ADMIN"]);

const STATUS_LABELS: Record<LicenseStatus, string> = {
  EXPIRED: "Expirée",
  EXPIRING_SOON: "Expire bientôt",
  VALID: "Valide",
};

const calendarDateFormatter = new Intl.DateTimeFormat("fr-CA", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function statusBadgeVariant(status: LicenseStatus): "destructive" | "outline" | "secondary" {
  if (status === "EXPIRED") return "destructive";
  if (status === "EXPIRING_SOON") return "outline";
  return "secondary";
}

export default function AdminLicensesPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [entries, setEntries] = useState<LicenseListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user && !LICENSE_ROLES.has(user.role)) return;
    if (!user) return;

    getLicenses(token)
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
        setError("Impossible de charger les licences pour le moment.");
      });
  }, [router, user]);

  if (user && !LICENSE_ROLES.has(user.role)) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Licences" />
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
      <AppHeader title="Licences" />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Licences et dates d&apos;expiration</CardTitle>
            <CardDescription>
              US-23 : triées par échéance la plus proche, pour anticiper les renouvellements.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : entries === null ? (
              <p className="text-sm text-muted-foreground">Chargement...</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune licence enregistrée pour le moment.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Équipement</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Éditeur</TableHead>
                      <TableHead>Expiration</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.ci.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/admin/configuration-items/${entry.ci.id}`}
                            className="hover:underline"
                          >
                            {entry.ci.name}
                          </Link>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {entry.ci.inventoryNumber}
                          </span>
                        </TableCell>
                        <TableCell>{entry.ci.ciType.name}</TableCell>
                        <TableCell>
                          {entry.license.vendor}
                          {entry.license.referenceNumber ? ` (${entry.license.referenceNumber})` : null}
                        </TableCell>
                        <TableCell>
                          {calendarDateFormatter.format(new Date(entry.license.expiresAt))}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(entry.status)}>
                            {STATUS_LABELS[entry.status]}
                          </Badge>
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
