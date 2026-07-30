"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, login } from "@/lib/api";
import { saveSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const STATUS_LINES = ["AUTH · EN LIGNE", "TICKETS · SYNCHRONISÉ", "AGENT IA · PRÊT"];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const { accessToken, refreshToken, user } = await login(email, password);
      saveSession(accessToken, refreshToken, user);
      router.push("/tickets");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Email ou mot de passe incorrect."
          : "Impossible de se connecter pour le moment. Réessayez.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-ink px-12 py-10 text-ink-foreground md:flex md:flex-col md:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(0,0,0,0.4))]"
        />
        <div className="relative">
          <p className="font-mono text-xs tracking-[0.25em] text-signal-slate">SYSTÈME</p>
          <h1 className="mt-3 font-sans text-3xl font-semibold tracking-tight">
            AI Help Desk
          </h1>
          <p className="mt-2 max-w-xs text-sm text-ink-foreground/70">
            Support IT interne assisté par IA — diagnostic, tickets et automatisation supervisée.
          </p>
        </div>

        <ul className="relative space-y-2 font-mono text-xs text-signal-slate">
          {STATUS_LINES.map((line, index) => (
            <li
              key={line}
              className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 flex items-center gap-2 border-t border-ink-line pt-2 first:border-t-0 first:pt-0"
              style={{ animationDelay: `${index * 150}ms`, animationDuration: "500ms", animationFillMode: "backwards" }}
            >
              <span className="size-1.5 rounded-full bg-signal-moss" />
              {line}
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 md:hidden">
            <p className="font-mono text-xs tracking-[0.25em] text-muted-foreground">SYSTÈME</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">AI Help Desk</h1>
          </div>

          <Card className="border-border/80">
            <CardHeader>
              <CardTitle className="text-xl">Se connecter</CardTitle>
              <CardDescription>Accédez à votre espace de support IT.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>

                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? "Connexion..." : "Se connecter"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
