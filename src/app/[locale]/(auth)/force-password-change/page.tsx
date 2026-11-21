"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";

export default function ForcePasswordChangePage() {
  const t = useTranslations("auth.forcePasswordChange");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("errors.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("errors.passwordMismatch"));
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/force-reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      // La session courante est invalidée côté serveur (rotation post-reset) :
      // on déconnecte proprement et on renvoie vers la connexion avec un message.
      await signOut({ callbackUrl: "/login?message=password_changed" });
      return;
    } else {
      setLoading(false);
      const data = await res.json().catch(() => ({}));
      setError(data.error || t("errors.default"));
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Input
          type="password"
          placeholder={t("passwordPlaceholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <Input
          type="password"
          placeholder={t("confirmPlaceholder")}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? t("submitting") : t("submit")}
        </Button>
      </form>
    </div>
  );
}
