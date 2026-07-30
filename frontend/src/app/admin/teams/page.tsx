"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  createTeam,
  getTicketCategories,
  getTeams,
  updateTeam,
  type Team,
  type TicketCategory,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
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

const NO_CATEGORY = "NONE";

const dateFormatter = new Intl.DateTimeFormat("fr-CA", {
  dateStyle: "medium",
});

export default function AdminTeamsPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(NO_CATEGORY);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPrivileged = user?.role === "SUPERVISOR" || user?.role === "ADMIN";

  const loadTeams = useCallback(
    (token: string) => {
      return getTeams(token)
        .then((data) => {
          setTeams(data);
          setLoadError(null);
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
            router.replace("/login");
            return;
          }
          setLoadError("Impossible de charger les équipes pour le moment.");
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

    loadTeams(token);
    getTicketCategories(token)
      .then(setCategories)
      .catch(() => {
        // best-effort: category dropdown just stays empty
      });
  }, [router, user, isPrivileged, loadTeams]);

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
      await createTeam(token, {
        name,
        categoryId: categoryId === NO_CATEGORY ? undefined : categoryId,
      });
      setName("");
      setCategoryId(NO_CATEGORY);
      await loadTeams(token);
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Impossible de créer l'équipe pour le moment.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCategoryChange(team: Team, newCategoryId: string) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setRowError(null);
    try {
      await updateTeam(token, team.id, {
        categoryId: newCategoryId === NO_CATEGORY ? null : newCategoryId,
      });
      await loadTeams(token);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Impossible de modifier la catégorie pour le moment.");
    }
  }

  if (user && !isPrivileged) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Équipes" />
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
      <AppHeader title="Équipes" />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Créer une équipe</CardTitle>
              <CardDescription>
                Associer une catégorie permet de suggérer automatiquement un technicien de cette
                équipe lors de la création d&apos;un ticket dans cette catégorie.
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
                  <Label htmlFor="new-team-name">Nom</Label>
                  <Input
                    id="new-team-name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex. Réseau & Infrastructure"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-team-category">Catégorie associée</Label>
                  <Select value={categoryId} onValueChange={(value) => setCategoryId(value ?? NO_CATEGORY)}>
                    <SelectTrigger id="new-team-category" className="w-full">
                      <SelectValue placeholder="Aucune catégorie">
                        {(value: string | null) =>
                          value && value !== NO_CATEGORY
                            ? (categories.find((category) => category.id === value)?.name ??
                              "Aucune catégorie")
                            : "Aucune catégorie"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CATEGORY}>Aucune catégorie</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={isSubmitting || !name.trim()}>
                    {isSubmitting ? "Création..." : "Créer l'équipe"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Équipes</CardTitle>
            </CardHeader>
            <CardContent>
              {rowError ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{rowError}</AlertDescription>
                </Alert>
              ) : null}
              {loadError ? (
                <Alert variant="destructive">
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
              ) : teams === null ? (
                <p className="text-sm text-muted-foreground">Chargement des équipes...</p>
              ) : teams.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune équipe pour le moment.</p>
              ) : (
                <div className="overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nom</TableHead>
                        <TableHead>Catégorie associée</TableHead>
                        <TableHead>Membres</TableHead>
                        <TableHead>Créée le</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teams.map((team) => (
                        <TableRow key={team.id}>
                          <TableCell className="font-medium">{team.name}</TableCell>
                          <TableCell>
                            <Select
                              value={team.categoryId ?? NO_CATEGORY}
                              onValueChange={(value) => value && handleCategoryChange(team, value)}
                            >
                              <SelectTrigger className="w-48">
                                <SelectValue placeholder="Aucune catégorie">
                                  {(value: string | null) =>
                                    value && value !== NO_CATEGORY
                                      ? (categories.find((category) => category.id === value)?.name ??
                                        "Aucune catégorie")
                                      : "Aucune catégorie"
                                  }
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_CATEGORY}>Aucune catégorie</SelectItem>
                                {categories.map((category) => (
                                  <SelectItem key={category.id} value={category.id}>
                                    {category.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{team._count.members}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {dateFormatter.format(new Date(team.createdAt))}
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
