"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError,
  addCiRelationship,
  getCiImpact,
  getConfigurationItem,
  getConfigurationItems,
  removeCiRelationship,
  updateConfigurationItem,
  type CiImpactResult,
  type CiStatus,
  type ConfigurationItem,
  type ConfigurationItemDetail,
  type Criticality,
  type RelationshipType,
} from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const RELATIONSHIP_TYPE_OPTIONS: { value: RelationshipType; label: string }[] = [
  { value: "DEPENDS_ON", label: "Dépend de" },
  { value: "HOSTS", label: "Héberge" },
  { value: "RUNS_ON", label: "Fonctionne sur" },
  { value: "CONNECTS_TO", label: "Connecté à" },
];

const RELATIONSHIP_TYPE_LABELS: Record<RelationshipType, string> = {
  DEPENDS_ON: "Dépend de",
  HOSTS: "Héberge",
  RUNS_ON: "Fonctionne sur",
  CONNECTS_TO: "Connecté à",
};

const dateFormatter = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" });
// La garantie est une date calendaire (pas un horodatage) : on force UTC pour
// éviter qu'un fuseau local négatif ne l'affiche un jour plus tôt.
const calendarDateFormatter = new Intl.DateTimeFormat("fr-CA", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export default function AdminConfigurationItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const user = useSessionUser();

  const [ci, setCi] = useState<ConfigurationItemDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const [impact, setImpact] = useState<CiImpactResult | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);

  const [allCis, setAllCis] = useState<ConfigurationItem[]>([]);
  const [newDependentId, setNewDependentId] = useState("");
  const [newRelationshipType, setNewRelationshipType] = useState<RelationshipType>("RUNS_ON");
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [isSavingRelationship, setIsSavingRelationship] = useState(false);

  const [isEditingWarranty, setIsEditingWarranty] = useState(false);
  const [warrantyProvider, setWarrantyProvider] = useState("");
  const [warrantyStartDate, setWarrantyStartDate] = useState("");
  const [warrantyEndDate, setWarrantyEndDate] = useState("");
  const [warrantyReferenceNumber, setWarrantyReferenceNumber] = useState("");
  const [warrantyError, setWarrantyError] = useState<string | null>(null);
  const [isSavingWarranty, setIsSavingWarranty] = useState(false);

  const [isEditingLicense, setIsEditingLicense] = useState(false);
  const [licenseVendor, setLicenseVendor] = useState("");
  const [licenseExpiresAt, setLicenseExpiresAt] = useState("");
  const [licensePurchasedAt, setLicensePurchasedAt] = useState("");
  const [licenseReferenceNumber, setLicenseReferenceNumber] = useState("");
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [isSavingLicense, setIsSavingLicense] = useState(false);

  const isViewer =
    user?.role === "TECHNICIAN" || user?.role === "SUPERVISOR" || user?.role === "ADMIN";
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

  const loadImpact = useCallback(
    (token: string) => {
      return getCiImpact(token, id)
        .then((data) => {
          setImpact(data);
          setImpactError(null);
        })
        .catch((err) => {
          setImpactError(
            err instanceof ApiError ? err.message : "Impossible de charger l'analyse d'impact.",
          );
        });
    },
    [id],
  );

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (user && !isViewer) return;
    if (!user) return;

    load(token);
    loadImpact(token);
    if (isPrivileged) {
      getConfigurationItems(token)
        .then(setAllCis)
        .catch(() => {
          // best-effort: the dependent-CI dropdown just stays empty
        });
    }
  }, [router, user, isViewer, isPrivileged, load, loadImpact]);

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

  async function handleAddRelationship() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!newDependentId) return;

    setRelationshipError(null);
    setIsSavingRelationship(true);
    try {
      await addCiRelationship(token, id, {
        childCiId: newDependentId,
        relationshipType: newRelationshipType,
      });
      setNewDependentId("");
      await Promise.all([load(token), loadImpact(token)]);
    } catch (err) {
      setRelationshipError(
        err instanceof ApiError ? err.message : "Impossible d'ajouter cette relation pour le moment.",
      );
    } finally {
      setIsSavingRelationship(false);
    }
  }

  async function handleRemoveRelationship(relationshipId: string) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setRelationshipError(null);
    try {
      await removeCiRelationship(token, id, relationshipId);
      await Promise.all([load(token), loadImpact(token)]);
    } catch (err) {
      setRelationshipError(
        err instanceof ApiError ? err.message : "Impossible de retirer cette relation pour le moment.",
      );
    }
  }

  function startEditingWarranty() {
    setWarrantyProvider(ci?.warranty?.provider ?? "");
    setWarrantyStartDate(ci?.warranty?.startDate.slice(0, 10) ?? "");
    setWarrantyEndDate(ci?.warranty?.endDate.slice(0, 10) ?? "");
    setWarrantyReferenceNumber(ci?.warranty?.referenceNumber ?? "");
    setWarrantyError(null);
    setIsEditingWarranty(true);
  }

  async function handleSaveWarranty() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setWarrantyError(null);
    setIsSavingWarranty(true);
    try {
      await updateConfigurationItem(token, id, {
        warranty: {
          provider: warrantyProvider,
          startDate: warrantyStartDate,
          endDate: warrantyEndDate,
          referenceNumber: warrantyReferenceNumber || undefined,
        },
      });
      setIsEditingWarranty(false);
      await load(token);
    } catch (err) {
      setWarrantyError(
        err instanceof ApiError ? err.message : "Impossible d'enregistrer la garantie pour le moment.",
      );
    } finally {
      setIsSavingWarranty(false);
    }
  }

  async function handleClearWarranty() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setWarrantyError(null);
    setIsSavingWarranty(true);
    try {
      await updateConfigurationItem(token, id, { clearWarranty: true });
      setIsEditingWarranty(false);
      await load(token);
    } catch (err) {
      setWarrantyError(
        err instanceof ApiError ? err.message : "Impossible de retirer la garantie pour le moment.",
      );
    } finally {
      setIsSavingWarranty(false);
    }
  }

  function startEditingLicense() {
    setLicenseVendor(ci?.license?.vendor ?? "");
    setLicenseExpiresAt(ci?.license?.expiresAt.slice(0, 10) ?? "");
    setLicensePurchasedAt(ci?.license?.purchasedAt?.slice(0, 10) ?? "");
    setLicenseReferenceNumber(ci?.license?.referenceNumber ?? "");
    setLicenseError(null);
    setIsEditingLicense(true);
  }

  async function handleSaveLicense() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLicenseError(null);
    setIsSavingLicense(true);
    try {
      await updateConfigurationItem(token, id, {
        license: {
          vendor: licenseVendor,
          expiresAt: licenseExpiresAt,
          purchasedAt: licensePurchasedAt || undefined,
          referenceNumber: licenseReferenceNumber || undefined,
        },
      });
      setIsEditingLicense(false);
      await load(token);
    } catch (err) {
      setLicenseError(
        err instanceof ApiError ? err.message : "Impossible d'enregistrer la licence pour le moment.",
      );
    } finally {
      setIsSavingLicense(false);
    }
  }

  async function handleClearLicense() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLicenseError(null);
    setIsSavingLicense(true);
    try {
      await updateConfigurationItem(token, id, { clearLicense: true });
      setIsEditingLicense(false);
      await load(token);
    } catch (err) {
      setLicenseError(
        err instanceof ApiError ? err.message : "Impossible de retirer la licence pour le moment.",
      );
    } finally {
      setIsSavingLicense(false);
    }
  }

  const backLink = (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/admin/configuration-items" />}>
      Retour à l&apos;inventaire
    </Button>
  );

  if (user && !isViewer) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Configuration Item" action={backLink} />
        <main className="mx-auto max-w-lg px-6 py-16">
          <Alert>
            <AlertDescription>
              Cette page est réservée aux techniciens, superviseurs et administrateurs.
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
                  {ci.manufacturer
                    ? ` · ${ci.manufacturer.name}${ci.model ? ` ${ci.model.name}` : ""}`
                    : null}
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
                    {isPrivileged ? (
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
                    ) : (
                      <p className="text-sm">
                        {CRITICALITY_OPTIONS.find((option) => option.value === ci.criticality)?.label}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">
                      Statut
                    </p>
                    {isPrivileged ? (
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
                    ) : (
                      <p className="text-sm">
                        {STATUS_OPTIONS.find((option) => option.value === ci.status)?.label}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Garantie</CardTitle>
                <CardDescription>
                  US-24 : à consulter avant de décider de réparer ou de remplacer cet équipement.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {warrantyError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{warrantyError}</AlertDescription>
                  </Alert>
                ) : null}

                {isEditingWarranty ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="warranty-provider">Fournisseur</Label>
                        <Input
                          id="warranty-provider"
                          value={warrantyProvider}
                          onChange={(event) => setWarrantyProvider(event.target.value)}
                          placeholder="Ex. Dell ProSupport"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="warranty-reference">Référence (optionnel)</Label>
                        <Input
                          id="warranty-reference"
                          value={warrantyReferenceNumber}
                          onChange={(event) => setWarrantyReferenceNumber(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="warranty-start">Début</Label>
                        <Input
                          id="warranty-start"
                          type="date"
                          value={warrantyStartDate}
                          onChange={(event) => setWarrantyStartDate(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="warranty-end">Fin</Label>
                        <Input
                          id="warranty-end"
                          type="date"
                          value={warrantyEndDate}
                          onChange={(event) => setWarrantyEndDate(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={
                          isSavingWarranty ||
                          !warrantyProvider.trim() ||
                          !warrantyStartDate ||
                          !warrantyEndDate
                        }
                        onClick={handleSaveWarranty}
                      >
                        {isSavingWarranty ? "Enregistrement..." : "Enregistrer"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSavingWarranty}
                        onClick={() => setIsEditingWarranty(false)}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : ci.warranty ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      {ci.warranty.provider}
                      {ci.warranty.referenceNumber ? ` (${ci.warranty.referenceNumber})` : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Du {calendarDateFormatter.format(new Date(ci.warranty.startDate))} au{" "}
                      {calendarDateFormatter.format(new Date(ci.warranty.endDate))}
                    </p>
                    <Badge variant={new Date(ci.warranty.endDate) >= new Date() ? "secondary" : "destructive"}>
                      {new Date(ci.warranty.endDate) >= new Date() ? "Sous garantie" : "Garantie expirée"}
                    </Badge>
                    {isPrivileged ? (
                      <div className="flex gap-2 pt-2">
                        <Button variant="outline" size="sm" onClick={startEditingWarranty}>
                          Modifier
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSavingWarranty}
                          onClick={handleClearWarranty}
                        >
                          Retirer
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Aucune garantie enregistrée.</p>
                    {isPrivileged ? (
                      <Button variant="outline" size="sm" onClick={startEditingWarranty}>
                        Ajouter une garantie
                      </Button>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Licence</CardTitle>
                <CardDescription>
                  US-23 : consulter la date d&apos;expiration pour anticiper le renouvellement.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {licenseError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{licenseError}</AlertDescription>
                  </Alert>
                ) : null}

                {isEditingLicense ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="license-vendor">Éditeur</Label>
                        <Input
                          id="license-vendor"
                          value={licenseVendor}
                          onChange={(event) => setLicenseVendor(event.target.value)}
                          placeholder="Ex. Microsoft"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="license-reference">Référence (optionnel)</Label>
                        <Input
                          id="license-reference"
                          value={licenseReferenceNumber}
                          onChange={(event) => setLicenseReferenceNumber(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="license-purchased">Achat (optionnel)</Label>
                        <Input
                          id="license-purchased"
                          type="date"
                          value={licensePurchasedAt}
                          onChange={(event) => setLicensePurchasedAt(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="license-expires">Expiration</Label>
                        <Input
                          id="license-expires"
                          type="date"
                          value={licenseExpiresAt}
                          onChange={(event) => setLicenseExpiresAt(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={isSavingLicense || !licenseVendor.trim() || !licenseExpiresAt}
                        onClick={handleSaveLicense}
                      >
                        {isSavingLicense ? "Enregistrement..." : "Enregistrer"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSavingLicense}
                        onClick={() => setIsEditingLicense(false)}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : ci.license ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      {ci.license.vendor}
                      {ci.license.referenceNumber ? ` (${ci.license.referenceNumber})` : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Expire le {calendarDateFormatter.format(new Date(ci.license.expiresAt))}
                    </p>
                    {(() => {
                      const expiresAt = new Date(ci.license.expiresAt);
                      const now = new Date();
                      const soonThreshold = new Date(now);
                      soonThreshold.setDate(soonThreshold.getDate() + 60);
                      const isExpired = expiresAt < now;
                      const isExpiringSoon = !isExpired && expiresAt <= soonThreshold;
                      return (
                        <Badge variant={isExpired ? "destructive" : isExpiringSoon ? "outline" : "secondary"}>
                          {isExpired
                            ? "Licence expirée"
                            : isExpiringSoon
                              ? "Expire bientôt"
                              : "Valide"}
                        </Badge>
                      );
                    })()}
                    {isPrivileged ? (
                      <div className="flex gap-2 pt-2">
                        <Button variant="outline" size="sm" onClick={startEditingLicense}>
                          Modifier
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSavingLicense}
                          onClick={handleClearLicense}
                        >
                          Retirer
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Aucune licence enregistrée.</p>
                    {isPrivileged ? (
                      <Button variant="outline" size="sm" onClick={startEditingLicense}>
                        Ajouter une licence
                      </Button>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Dépendances</CardTitle>
                <CardDescription>
                  Ce que cet équipement héberge/dépend (docs/08 §4.3) — la base d&apos;une analyse
                  d&apos;impact fiable.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {relationshipError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{relationshipError}</AlertDescription>
                  </Alert>
                ) : null}

                <div>
                  <p className="mb-2 text-sm font-medium">Dépend de</p>
                  {ci.relationshipsAsChild.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucune dépendance renseignée.</p>
                  ) : (
                    <ul className="space-y-1">
                      {ci.relationshipsAsChild.map((rel) => (
                        <li key={rel.id} className="text-sm">
                          {RELATIONSHIP_TYPE_LABELS[rel.relationshipType]} :{" "}
                          <Link
                            href={`/admin/configuration-items/${rel.parent.id}`}
                            className="hover:underline"
                          >
                            {rel.parent.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pour ajouter une dépendance, ouvrez la fiche de l&apos;équipement dont celui-ci
                    dépend et ajoutez-le comme équipement dépendant depuis là-bas.
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium">En dépendent</p>
                  {ci.relationshipsAsParent.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Aucun équipement ne dépend de celui-ci pour le moment.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {ci.relationshipsAsParent.map((rel) => (
                        <li key={rel.id} className="flex items-center justify-between text-sm">
                          <span>
                            {RELATIONSHIP_TYPE_LABELS[rel.relationshipType]} :{" "}
                            <Link
                              href={`/admin/configuration-items/${rel.child.id}`}
                              className="hover:underline"
                            >
                              {rel.child.name}
                            </Link>
                          </span>
                          {isPrivileged ? (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => handleRemoveRelationship(rel.id)}
                            >
                              Retirer
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {isPrivileged ? (
                  <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">Équipement dépendant</p>
                      <Select value={newDependentId} onValueChange={(value) => setNewDependentId(value ?? "")}>
                        <SelectTrigger className="w-56">
                          <SelectValue placeholder="Choisir un équipement">
                            {(value: string | null) =>
                              allCis.find((item) => item.id === value)?.name ?? "Choisir un équipement"
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {allCis
                            .filter((item) => item.id !== id)
                            .map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">Type</p>
                      <Select
                        value={newRelationshipType}
                        onValueChange={(value) => value && setNewRelationshipType(value as RelationshipType)}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue>
                            {(value: string | null) =>
                              RELATIONSHIP_TYPE_OPTIONS.find((option) => option.value === value)?.label
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {RELATIONSHIP_TYPE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      size="sm"
                      disabled={isSavingRelationship || !newDependentId}
                      onClick={handleAddRelationship}
                    >
                      {isSavingRelationship ? "Ajout..." : "Ajouter"}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Analyse d&apos;impact</CardTitle>
                <CardDescription>
                  En cas d&apos;incident sur cet équipement : quels autres équipements et quels
                  employés sont potentiellement affectés (docs/08 §4.3).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {impactError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{impactError}</AlertDescription>
                  </Alert>
                ) : impact === null ? (
                  <p className="text-sm text-muted-foreground">Chargement de l&apos;analyse d&apos;impact...</p>
                ) : (
                  <>
                    <div>
                      <p className="mb-2 text-sm font-medium">
                        Équipements impactés ({impact.impactedCis.length})
                      </p>
                      {impact.impactedCis.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Aucun autre équipement ne dépend de celui-ci.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {impact.impactedCis.map((entry) => (
                            <li key={entry.ci.id} className="text-sm">
                              <Link href={`/admin/configuration-items/${entry.ci.id}`} className="hover:underline">
                                {entry.ci.name}
                              </Link>{" "}
                              <span className="text-muted-foreground">
                                ({RELATIONSHIP_TYPE_LABELS[entry.relationshipType]})
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium">
                        Tickets ouverts concernés ({impact.affectedTickets.length})
                      </p>
                      {impact.affectedTickets.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Aucun ticket ouvert n&apos;est actuellement lié à ces équipements.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {impact.affectedTickets.map((ticket) => (
                            <li key={ticket.id} className="text-sm">
                              <Link href={`/tickets/${ticket.id}`} className="hover:underline">
                                {ticket.reference}
                              </Link>{" "}
                              — {ticket.title} ({ticket.employee.displayName})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
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
