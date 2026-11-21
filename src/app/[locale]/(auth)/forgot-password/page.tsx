"use client";

import { useState } from "react";
import { Link } from "@/i18n/routing";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, CheckCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth.forgotPassword");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("errors.default"));
      } else {
        setSent(true);
      }
    } catch {
      setError(t("errors.networkError"));
    }

    setLoading(false);
  }

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
            {sent ? (
              <div className="text-center py-4">
                <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-4" />
                <p className="text-sm text-foreground font-medium mb-2">
                  {t("sentTitle")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("sentDescription")}
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
                  <Label htmlFor="email">{t("emailLabel")}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    placeholder={t("emailPlaceholder")}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {loading ? t("submitting") : t("submit")}
                </Button>
              </form>
            )}
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
