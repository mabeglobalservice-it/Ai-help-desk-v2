"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getIntegrations,
  getSystemSettings,
  setIntegrationEnabled,
  updateSystemSettings,
  type IntegrationStatus,
  type SystemSettings,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AdminSettingsPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [organizationName, setOrganizationName] = useState("");
  const [maxClarifyingTurns, setMaxClarifyingTurns] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [togglingIntegration, setTogglingIntegration] = useState<string | null>(null);

  const isAdmin = user?.role === "ADMIN";

  const load = useCallback(
    (token: string) => {
      return Promise.all([getSystemSettings(token), getIntegrations(token)])
        .then(([settingsData, integrationsData]) => {
          setSettings(settingsData);
          setOrganizationName(settingsData.organizationName);
          setMaxClarifyingTurns(String(settingsData.maxClarifyingTurns));
          setIntegrations(integrationsData);
          setLoadError(null);
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
            router.replace("/login");
            return;
          }
          setLoadError("Impossible de charger la configuration pour le moment.");
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
    if (user && !isAdmin) return;
    if (!user) return;

    load(token);
  }, [router, user, isAdmin, load]);

  async function handleSaveSettings() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    const turns = Number(maxClarifyingTurns);
    setSettingsError(null);
    setSettingsSaved(false);
    setIsSavingSettings(true);
    try {
      const updated = await updateSystemSettings(token, {
        organizationName: organizationName.trim(),
        maxClarifyingTurns: turns,
      });
      setSettings(updated);
      setSettingsSaved(true);
    } catch (err) {
      setSettingsError(
        err instanceof ApiError ? err.message : "Impossible d'enregistrer la configuration pour le moment.",
      );
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleToggleIntegration(integration: IntegrationStatus) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setIntegrationError(null);
    setTogglingIntegration(integration.name);
    try {
      await setIntegrationEnabled(token, integration.name, !integration.enabled);
      await load(token);
    } catch (err) {
      setIntegrationError(
        err instanceof ApiError ? err.message : "Impossible de modifier cette intégration pour le moment.",
      );
    } finally {
      setTogglingIntegration(null);
    }
  }

  if (user && !isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Configuration" />
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
      <AppHeader title="Configuration" />

      <main className="mx-auto max-w-3xl px-6 py-8">
        {loadError ? (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Paramètres système</CardTitle>
              <CardDescription>
                docs/11 §12 (GET/PATCH /admin/settings) : réglages globaux réellement utilisés
                ailleurs dans l&apos;application.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings === null ? (
                <p className="text-sm text-muted-foreground">Chargement...</p>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="organization-name">Nom de l&apos;organisation</Label>
                    <Input
                      id="organization-name"
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      placeholder="AI Help Desk"
                    />
                    <p className="text-xs text-muted-foreground">
                      Utilisé dans le sujet et le pied de page des emails de notification.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-clarifying-turns">
                      Questions de clarification max. (Agent Help Desk)
                    </Label>
                    <Input
                      id="max-clarifying-turns"
                      type="number"
                      min={1}
                      max={10}
                      value={maxClarifyingTurns}
                      onChange={(e) => setMaxClarifyingTurns(e.target.value)}
                      className="max-w-32"
                    />
                    <p className="text-xs text-muted-foreground">
                      docs/09 §3.2 : nombre de questions posées avant qu&apos;un diagnostic ne soit
                      forcé, quelle que soit la confiance.
                    </p>
                  </div>
                  {settingsError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{settingsError}</AlertDescription>
                    </Alert>
                  ) : null}
                  {settingsSaved ? (
                    <Alert>
                      <AlertDescription>Configuration enregistrée.</AlertDescription>
                    </Alert>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={isSavingSettings || !organizationName.trim()}
                    onClick={handleSaveSettings}
                  >
                    {isSavingSettings ? "Enregistrement..." : "Enregistrer"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Intégrations</CardTitle>
              <CardDescription>
                docs/11 §12 (GET/PATCH /admin/integrations) : statut des intégrations câblées dans
                ce projet. Microsoft Graph et Intune (docs/03 §3.4/§3.5) ne sont pas implémentés et
                apparaissent tels quels, sans bascule possible.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {integrations === null ? (
                <p className="text-sm text-muted-foreground">Chargement...</p>
              ) : (
                <>
                  {integrationError ? (
                    <Alert variant="destructive" className="mb-4">
                      <AlertDescription>{integrationError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="overflow-hidden rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Intégration</TableHead>
                          <TableHead>Configurée</TableHead>
                          <TableHead>Statut</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {integrations.map((integration) => {
                          const toggleable = ["TEAMS", "SLACK", "EMAIL"].includes(integration.name);
                          return (
                            <TableRow key={integration.name}>
                              <TableCell className="font-medium">{integration.label}</TableCell>
                              <TableCell>
                                <Badge variant={integration.configured ? "secondary" : "outline"}>
                                  {integration.configured ? "Oui" : "Non"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={integration.enabled ? "secondary" : "outline"}>
                                  {integration.enabled ? "Activée" : "Désactivée"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {toggleable ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={togglingIntegration === integration.name}
                                    onClick={() => handleToggleIntegration(integration)}
                                  >
                                    {togglingIntegration === integration.name
                                      ? "..."
                                      : integration.enabled
                                        ? "Désactiver"
                                        : "Activer"}
                                  </Button>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
