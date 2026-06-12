import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { login, register } from "@/lib/api/auth";
import { PageShell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  head: () => ({ meta: [{ title: "Sign in — X-VAULT" }] }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const qc = useQueryClient();

  const onSuccess = async () => {
    await qc.invalidateQueries();
    navigate({ to: redirect || "/" });
  };
  const doLogin = useMutation({
    mutationFn: () => login({ data: { email: form.email, password: form.password } }),
    onSuccess,
    onError: (e: Error) => toast.error(e.message),
  });
  const doRegister = useMutation({
    mutationFn: () => {
      let refCode: string | undefined;
      if (typeof window !== "undefined") {
        try {
          refCode = localStorage.getItem("ref_code") ?? undefined;
        } catch {
          /* ignore */
        }
      }
      return register({ data: { ...form, refCode } });
    },
    onSuccess,
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = doLogin.isPending || doRegister.isPending;

  return (
    <PageShell>
      <div className="max-w-sm mx-auto py-10">
        <div className="bg-card border border-border rounded-lg p-6 space-y-5">
          <div className="flex gap-1 bg-secondary rounded-lg p-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 text-xs font-bold py-2 rounded-md tracking-wide ${
                  mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {m === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
              </button>
            ))}
          </div>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              if (mode === "login") doLogin.mutate();
              else doRegister.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
              />
            </div>
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Username</Label>
                <Input
                  required
                  minLength={3}
                  maxLength={24}
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="display name (public)"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Password</Label>
              <Input
                type="password"
                required
                minLength={mode === "register" ? 8 : 1}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={mode === "register" ? "min. 8 characters" : "••••••••"}
              />
            </div>
            <Button type="submit" className="w-full font-bold" disabled={busy}>
              {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="text-[10px] text-muted-foreground leading-relaxed border-t border-border pt-4">
            <p className="font-bold mb-1">Demo accounts (password: Password123!)</p>
            <p>buyer@xvault.test · goldrush@xvault.test (seller)</p>
            <p>admin@xvault.test · finance@xvault.test · support@xvault.test</p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
