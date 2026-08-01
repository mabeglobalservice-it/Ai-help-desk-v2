"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  createScript,
  getScripts,
  type Script,
  type ScriptLanguage,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

const LANGUAGES: ScriptLanguage[] = ["POWERSHELL", "CMD", "BASH", "PYTHON"];

// docs/06-cas-utilisation.md UC-022 (sidebar Administrateur : "Gérer les
// modèles d'automatisation"), docs/11-documentation-api.md §8. Un script est
// sensible par défaut (RM-01) : seul un Administrateur peut le marquer non
// sensible, ce qui autorise son exécution directe sans approbation.
export default function AdminAutomationScriptsPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [language, setLanguage] = useState<ScriptLanguage>("POWERSHELL");
  const [content, setContent] = useState("");
  const [isSensitive, setIsSensitive] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAdmin = user?.role === "ADMIN";

  const loadScripts = useCallback(
    (token: string) => {
      return getScripts(token)
        .then((data) => {
          setScripts(data);
          setLoadError(null);
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
            router.replace("/login");
            return;
          }
          setLoadError("Impossible de charger les scripts pour le moment.");
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

    loadScripts(token);
  }, [router, user, isAdmin, loadScripts]);

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
      await createScript(token, { name, language, content, isSensitive });
      setName("");
      setContent("");
      setIsSensitive(true);
      await loadScripts(token);
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Impossible de créer le script pour le moment.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (user && !isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Scripts d'automatisation" />
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
      <AppHeader title="Scripts d'automatisation" />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Ajouter un script</CardTitle>
              <CardDescription>
                Marqué sensible par défaut : une action sensible ne peut être exécutée qu&apos;après
                approbation (RM-01). Ne décochez que pour une action réversible et sans impact de
                sécurité (ex. redémarrer un service, vider un cache).
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
                  <Label htmlFor="script-name">Nom</Label>
                  <Input
                    id="script-name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex. Redémarrer le service de spouleur"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="script-language">Langage</Label>
                  <Select value={language} onValueChange={(value) => value && setLanguage(value as ScriptLanguage)}>
                    <SelectTrigger id="script-language" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((lang) => (
                        <SelectItem key={lang} value={lang}>
                          {lang}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="script-content">Contenu</Label>
                  <Textarea
                    id="script-content"
                    required
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    placeholder="Restart-Service -Name Spooler -Force"
                    rows={4}
                    className="font-mono text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={isSensitive}
                    onChange={(event) => setIsSensitive(event.target.checked)}
                  />
                  Action sensible (approbation requise avant exécution)
                </label>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={isSubmitting || !name.trim() || !content.trim()}>
                    {isSubmitting ? "Création..." : "Ajouter le script"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Scripts disponibles</CardTitle>
            </CardHeader>
            <CardContent>
              {loadError ? (
                <Alert variant="destructive">
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
              ) : scripts === null ? (
                <p className="text-sm text-muted-foreground">Chargement des scripts...</p>
              ) : scripts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun script pour le moment.</p>
              ) : (
                <div className="overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nom</TableHead>
                        <TableHead>Langage</TableHead>
                        <TableHead>Sensibilité</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scripts.map((script) => (
                        <TableRow key={script.id}>
                          <TableCell className="font-medium">{script.name}</TableCell>
                          <TableCell className="text-muted-foreground">{script.language}</TableCell>
                          <TableCell>
                            {script.isSensitive ? (
                              <Badge variant="destructive">Sensible</Badge>
                            ) : (
                              <Badge variant="secondary">Non sensible</Badge>
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
      </main>
    </div>
  );
}
