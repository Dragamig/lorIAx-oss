"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";
import { Link } from "@/i18n/routing";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, CheckCircle } from "lucide-react";
import { useTranslations } from "next-intl";

function ResetPasswordForm() {
  const t = useTranslations("auth.resetPassword");
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    if (password.length < 8) {
      setError(t("errors.passwordTooShort"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t("errors.default"));
      } else {
        setSuccess(true);
        setTimeout(() => router.push("/login"), 3000);
      }
    } catch {
      setError(t("errors.networkError"));
    }

    setLoading(false);
  }

  if (!token) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-destructive mb-4">
          {t("invalidToken")}
        </p>
        <Link href="/forgot-password" className="text-primary hover:underline text-sm font-medium">
          {t("requestNew")}
        </Link>
      </div>
    );
  }

  return (
    <>
      {success ? (
        <div className="text-center py-4">
          <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-4" />
          <p className="text-sm text-foreground font-medium mb-2">
            {t("successTitle")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("successDescription")}
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {t("description")}
          </p>

          <div className="space-y-2">
            <Label htmlFor="password">{t("passwordLabel")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              placeholder={t("passwordPlaceholder")}
              minLength={8}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">{t("confirmLabel")}</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder={t("confirmPlaceholder")}
              minLength={8}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? t("submitting") : t("submit")}
          </Button>
        </form>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("auth.resetPassword");
  return (
    <div className="flex-1 flex items-center justify-center bg-muted/30">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 flex flex-col items-center gap-4">
          <Image src="/mascotte.svg" alt="LorIAx" width={80} height={80} priority />
          <h1 className="text-3xl font-bold text-foreground">LorIAx</h1>
          <p className="text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Suspense fallback={<div className="animate-pulse text-center py-4">{t("loading")}</div>}>
              <ResetPasswordForm />
            </Suspense>
          </CardContent>

          <CardFooter className="justify-center">
            <p className="text-sm text-muted-foreground">
              <Link
                href="/login"
                className="text-primary hover:underline font-medium"
              >
                {t("backToLogin")}
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
