"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getAiAgents,
  getAiProviders,
  setActiveAiProvider,
  toggleAiAgent,
  type AiAgent,
  type AiAgentName,
  type AiProviderConfig,
  type AiProviderName,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const AGENT_LABELS: Record<AiAgentName, string> = {
  DIAGNOSTIC: "Diagnostic",
  DOCUMENTATION: "Documentation",
  AUTOMATION: "Automation",
  SUPERVISOR: "Manager (superviseur)",
  INVENTORY: "Inventory",
  HELPDESK: "Help Desk",
};

const PROVIDER_LABELS: Record<AiProviderName, string> = {
  CLAUDE: "Claude (Anthropic)",
  OPENAI: "OpenAI",
  AZURE_OPENAI: "Azure OpenAI",
};

export default function AdminAiAgentsPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [agents, setAgents] = useState<AiAgent[] | null>(null);
  const [providers, setProviders] = useState<AiProviderConfig[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentActionError, setAgentActionError] = useState<string | null>(null);
  const [providerActionError, setProviderActionError] = useState<string | null>(null);
  const [togglingAgentId, setTogglingAgentId] = useState<string | null>(null);
  const [activatingProvider, setActivatingProvider] = useState<AiProviderName | null>(null);

  const isAdmin = user?.role === "ADMIN";

  const load = useCallback(
    (token: string) => {
      return Promise.all([getAiAgents(token), getAiProviders(token)])
        .then(([agentsData, providersData]) => {
          setAgents(agentsData);
          setProviders(providersData);
          setLoadError(null);
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
            router.replace("/login");
            return;
          }
          setLoadError("Impossible de charger les agents IA pour le moment.");
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

  async function handleToggleAgent(agent: AiAgent) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setAgentActionError(null);
    setTogglingAgentId(agent.id);
    try {
      await toggleAiAgent(token, agent.id);
      await load(token);
    } catch (err) {
      setAgentActionError(
        err instanceof ApiError ? err.message : "Impossible de modifier cet agent pour le moment.",
      );
    } finally {
      setTogglingAgentId(null);
    }
  }

  async function handleActivateProvider(provider: AiProviderName) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setProviderActionError(null);
    setActivatingProvider(provider);
    try {
      await setActiveAiProvider(token, provider);
      await load(token);
    } catch (err) {
      setProviderActionError(
        err instanceof ApiError ? err.message : "Impossible de changer de fournisseur pour le moment.",
      );
    } finally {
      setActivatingProvider(null);
    }
  }

  if (user && !isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Agents IA" />
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
      <AppHeader title="Agents IA" />

      <main className="mx-auto max-w-3xl px-6 py-8">
        {loadError ? (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Agents</CardTitle>
              <CardDescription>
                docs/11 §6 : active ou désactive un agent IA. DIAGNOSTIC, DOCUMENTATION et
                AUTOMATION appellent réellement le fournisseur IA ; MANAGER et INVENTORY sont des
                fonctionnalités déjà en lecture seule (leur bascule n&apos;a pas d&apos;effet) et
                HELP DESK n&apos;est pas encore implémenté.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {agents === null ? (
                <p className="text-sm text-muted-foreground">Chargement...</p>
              ) : (
                <>
                  {agentActionError ? (
                    <Alert variant="destructive" className="mb-4">
                      <AlertDescription>{agentActionError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="overflow-hidden rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Agent</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Statut</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agents.map((agent) => (
                          <TableRow key={agent.id}>
                            <TableCell className="font-medium">
                              {AGENT_LABELS[agent.name]}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {agent.description}
                            </TableCell>
                            <TableCell>
                              <Badge variant={agent.isActive ? "secondary" : "outline"}>
                                {agent.isActive ? "Actif" : "Désactivé"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={togglingAgentId === agent.id}
                                onClick={() => handleToggleAgent(agent)}
                              >
                                {togglingAgentId === agent.id
                                  ? "..."
                                  : agent.isActive
                                    ? "Désactiver"
                                    : "Activer"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Fournisseur IA actif</CardTitle>
              <CardDescription>
                docs/11 §6 : change le fournisseur sans redéploiement. Seul Claude a une
                intégration réelle — choisir OpenAI ou Azure OpenAI force le mode dégradé (RM-05)
                pour tous les agents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {providers === null ? (
                <p className="text-sm text-muted-foreground">Chargement...</p>
              ) : (
                <>
                  {providerActionError ? (
                    <Alert variant="destructive" className="mb-4">
                      <AlertDescription>{providerActionError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="overflow-hidden rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fournisseur</TableHead>
                          <TableHead>Statut</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {providers.map((providerConfig) => (
                          <TableRow key={providerConfig.id}>
                            <TableCell className="font-medium">
                              {PROVIDER_LABELS[providerConfig.provider]}
                            </TableCell>
                            <TableCell>
                              <Badge variant={providerConfig.isActive ? "secondary" : "outline"}>
                                {providerConfig.isActive ? "Actif" : "Inactif"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={
                                  providerConfig.isActive ||
                                  activatingProvider === providerConfig.provider
                                }
                                onClick={() => handleActivateProvider(providerConfig.provider)}
                              >
                                {activatingProvider === providerConfig.provider
                                  ? "..."
                                  : "Activer"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
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
