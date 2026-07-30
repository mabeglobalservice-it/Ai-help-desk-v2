"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  createUser,
  getDepartments,
  getTeams,
  getUsers,
  updateUser,
  type AdminUser,
  type Department,
  type Role,
  type Team,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { useSessionUser } from "@/lib/use-session-user";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const ROLES: Role[] = ["EMPLOYEE", "TECHNICIAN", "SUPERVISOR", "ADMIN"];
const ROLE_LABELS: Record<Role, string> = {
  EMPLOYEE: "Employé",
  TECHNICIAN: "Technicien",
  SUPERVISOR: "Superviseur",
  ADMIN: "Admin",
};
const NO_DEPARTMENT = "NONE";
const NO_TEAM = "NONE";

const dateFormatter = new Intl.DateTimeFormat("fr-CA", {
  dateStyle: "medium",
});

export default function AdminUsersPage() {
  const router = useRouter();
  const user = useSessionUser();

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("EMPLOYEE");
  const [departmentId, setDepartmentId] = useState(NO_DEPARTMENT);
  const [teamId, setTeamId] = useState(NO_TEAM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadUsers = useCallback(
    (token: string) => {
      return getUsers(token)
        .then((data) => {
          setUsers(data);
          setLoadError(null);
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearSession();
            router.replace("/login");
            return;
          }
          setLoadError("Impossible de charger les utilisateurs pour le moment.");
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
    if (user && user.role !== "ADMIN") return;
    if (!user) return;

    loadUsers(token);
    getDepartments(token)
      .then(setDepartments)
      .catch(() => {
        // best-effort: department dropdown just stays empty
      });
    getTeams(token)
      .then(setTeams)
      .catch(() => {
        // best-effort: team dropdown just stays empty
      });
  }, [router, user, loadUsers]);

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
      await createUser(token, {
        email,
        password,
        displayName,
        role,
        departmentId: departmentId === NO_DEPARTMENT ? undefined : departmentId,
        teamId: teamId === NO_TEAM ? undefined : teamId,
      });
      setDisplayName("");
      setEmail("");
      setPassword("");
      setRole("EMPLOYEE");
      setDepartmentId(NO_DEPARTMENT);
      setTeamId(NO_TEAM);
      await loadUsers(token);
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Impossible de créer l'utilisateur pour le moment.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRoleChange(targetUser: AdminUser, newRole: Role) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setRowError(null);
    try {
      await updateUser(token, targetUser.id, { role: newRole });
      await loadUsers(token);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Impossible de modifier le rôle pour le moment.");
    }
  }

  async function handleTeamChange(targetUser: AdminUser, newTeamId: string) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setRowError(null);
    try {
      await updateUser(token, targetUser.id, { teamId: newTeamId === NO_TEAM ? null : newTeamId });
      await loadUsers(token);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Impossible de modifier l'équipe pour le moment.");
    }
  }

  async function handleToggleActive(targetUser: AdminUser) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setRowError(null);
    try {
      await updateUser(token, targetUser.id, { isActive: !targetUser.isActive });
      await loadUsers(token);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Impossible de modifier le statut pour le moment.");
    }
  }

  if (user && user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Utilisateurs" />
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
      <AppHeader title="Utilisateurs" />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Créer un utilisateur</CardTitle>
              <CardDescription>
                L&apos;utilisateur pourra se connecter immédiatement avec ces identifiants.
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
                  <Label htmlFor="new-user-name">Nom</Label>
                  <Input
                    id="new-user-name"
                    required
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Ex. Nathalie Tremblay"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-user-email">Email</Label>
                  <Input
                    id="new-user-email"
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="nathalie@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-user-password">Mot de passe</Label>
                  <Input
                    id="new-user-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="8 caractères minimum"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-user-role">Rôle</Label>
                  <Select value={role} onValueChange={(value) => setRole((value ?? "EMPLOYEE") as Role)}>
                    <SelectTrigger id="new-user-role" className="w-full">
                      <SelectValue placeholder="Choisir un rôle">
                        {(value: string | null) => (value ? ROLE_LABELS[value as Role] : "Choisir un rôle")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="new-user-department">Département</Label>
                  <Select
                    value={departmentId}
                    onValueChange={(value) => setDepartmentId(value ?? NO_DEPARTMENT)}
                  >
                    <SelectTrigger id="new-user-department" className="w-full">
                      <SelectValue placeholder="Aucun département">
                        {(value: string | null) =>
                          value && value !== NO_DEPARTMENT
                            ? (departments.find((department) => department.id === value)?.name ??
                              "Aucun département")
                            : "Aucun département"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_DEPARTMENT}>Aucun département</SelectItem>
                      {departments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="new-user-team">Équipe</Label>
                  <Select value={teamId} onValueChange={(value) => setTeamId(value ?? NO_TEAM)}>
                    <SelectTrigger id="new-user-team" className="w-full">
                      <SelectValue placeholder="Aucune équipe">
                        {(value: string | null) =>
                          value && value !== NO_TEAM
                            ? (teams.find((team) => team.id === value)?.name ?? "Aucune équipe")
                            : "Aucune équipe"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TEAM}>Aucune équipe</SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Création..." : "Créer l'utilisateur"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Utilisateurs</CardTitle>
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
              ) : users === null ? (
                <p className="text-sm text-muted-foreground">Chargement des utilisateurs...</p>
              ) : (
                <div className="overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nom</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Rôle</TableHead>
                        <TableHead>Département</TableHead>
                        <TableHead>Équipe</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead>Créé le</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((rowUser) => (
                        <TableRow key={rowUser.id}>
                          <TableCell className="font-medium">{rowUser.displayName}</TableCell>
                          <TableCell className="text-muted-foreground">{rowUser.email}</TableCell>
                          <TableCell>
                            <Select
                              value={rowUser.role}
                              onValueChange={(value) => value && handleRoleChange(rowUser, value as Role)}
                            >
                              <SelectTrigger className="w-36">
                                <SelectValue placeholder="Rôle">
                                  {(value: string | null) => (value ? ROLE_LABELS[value as Role] : "Rôle")}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {ROLES.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {ROLE_LABELS[r]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {rowUser.department?.name ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={rowUser.teamId ?? NO_TEAM}
                              onValueChange={(value) => value && handleTeamChange(rowUser, value)}
                            >
                              <SelectTrigger className="w-40">
                                <SelectValue placeholder="Aucune équipe">
                                  {(value: string | null) =>
                                    value && value !== NO_TEAM
                                      ? (teams.find((team) => team.id === value)?.name ?? "Aucune équipe")
                                      : "Aucune équipe"
                                  }
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_TEAM}>Aucune équipe</SelectItem>
                                {teams.map((team) => (
                                  <SelectItem key={team.id} value={team.id}>
                                    {team.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Badge variant={rowUser.isActive ? "secondary" : "destructive"}>
                              {rowUser.isActive ? "Actif" : "Inactif"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {dateFormatter.format(new Date(rowUser.createdAt))}
                          </TableCell>
                          <TableCell>
                            <Button variant="outline" size="sm" onClick={() => handleToggleActive(rowUser)}>
                              {rowUser.isActive ? "Désactiver" : "Activer"}
                            </Button>
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
