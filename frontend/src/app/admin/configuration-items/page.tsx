"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ApiError,
  createConfigurationItem,
  getCiTypes,
  getConfigurationItems,
  type CiType,
  type ConfigurationItem,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const CRITICALITY_LABELS: Record<string, string> = {
  LOW: "Faible",
  MEDIUM: "Moyenne",
  HIGH: "Haute",
  CRITICAL: "Critique",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  IN_REPAIR: "En réparation",
  RETIRED: "Retiré",
};

export default function AdminConfigurationItemsPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [items, setItems] = useState<ConfigurationItem[] | null>(null);
  const [ciTypes, setCiTypes] = useState<CiType[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [ciTypeId, setCiTypeId] = useState("");
  const [inventoryNumber, setInventoryNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPrivileged = user?.role === "SUPERVISOR" || user?.role === "ADMIN";

  const loadItems = useCallback(
    (token: string) => {
      return getConfigurationItems(token)
        .then((data) => {
          setItems(data);
          setLoadError(null);
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
            router.replace("/login");
            return;
          }
          setLoadError("Impossible de charger l'inventaire pour le moment.");
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

    loadItems(token);
    getCiTypes(token)
      .then(setCiTypes)
      .catch(() => {
        // best-effort: the type dropdown just stays empty
      });
  }, [router, user, isPrivileged, loadItems]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setCreateError(null);
    setIsSubmitting(true);
    try {
      await createConfigurationItem(token, {
        name,
        ciTypeId,
        inventoryNumber,
        serialNumber: serialNumber || undefined,
      });
      setName("");
      setCiTypeId("");
      setInventoryNumber("");
      setSerialNumber("");
      await loadItems(token);
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Impossible de créer ce Configuration Item pour le moment.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (user && !isPrivileged) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Inventaire (CMDB)" />
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
      <AppHeader title="Inventaire (CMDB)" />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Ajouter un Configuration Item</CardTitle>
              <CardDescription>
                Un CI peut ensuite être lié à un ticket pour connaître les incidents qui le
                concernent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {createError ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              ) : null}
              <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={handleCreate} noValidate>
                <div className="space-y-2">
                  <Label htmlFor="new-ci-name">Nom</Label>
                  <Input
                    id="new-ci-name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex. SRV-FICHIERS-01"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-ci-type">Type</Label>
                  <Select value={ciTypeId} onValueChange={(value) => setCiTypeId((value as string) ?? "")}>
                    <SelectTrigger id="new-ci-type" className="w-full">
                      <SelectValue placeholder="Choisir un type">
                        {(value: string | null) =>
                          ciTypes.find((type) => type.id === value)?.name ?? "Choisir un type"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ciTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-ci-inventory">Numéro d&apos;inventaire</Label>
                  <Input
                    id="new-ci-inventory"
                    required
                    value={inventoryNumber}
                    onChange={(event) => setInventoryNumber(event.target.value)}
                    placeholder="Ex. INV-00123"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-ci-serial">Numéro de série (optionnel)</Label>
                  <Input
                    id="new-ci-serial"
                    value={serialNumber}
                    onChange={(event) => setSerialNumber(event.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    type="submit"
                    disabled={isSubmitting || !name.trim() || !ciTypeId || !inventoryNumber.trim()}
                  >
                    {isSubmitting ? "Création..." : "Ajouter"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Configuration Items</CardTitle>
            </CardHeader>
            <CardContent>
              {loadError ? (
                <Alert variant="destructive">
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
              ) : items === null ? (
                <p className="text-sm text-muted-foreground">Chargement de l&apos;inventaire...</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun Configuration Item pour le moment.</p>
              ) : (
                <div className="overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nom</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>N° inventaire</TableHead>
                        <TableHead>Criticité</TableHead>
                        <TableHead>Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/admin/configuration-items/${item.id}`}
                              className="hover:underline"
                            >
                              {item.name}
                            </Link>
                          </TableCell>
                          <TableCell>{item.ciType.name}</TableCell>
                          <TableCell className="font-mono text-xs">{item.inventoryNumber}</TableCell>
                          <TableCell>
                            <Badge variant={item.criticality === "CRITICAL" ? "destructive" : "outline"}>
                              {CRITICALITY_LABELS[item.criticality] ?? item.criticality}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {STATUS_LABELS[item.status] ?? item.status}
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
        </div>
      </main>
    </div>
  );
}
