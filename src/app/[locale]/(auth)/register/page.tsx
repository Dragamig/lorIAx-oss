"use client";

import { useState } from "react";
import { useRouter, Link } from "@/i18n/routing";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { getClientSlots } from "@/lib/modules/hooks.client";
import { ClosedRegistrationCard } from "@/components/auth/closed-registration-card";
import { useRegistrationOpen } from "@/hooks/use-registration-open";

export default function RegisterPage() {
  const t = useTranslations("auth.register");
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [needsOrg, setNeedsOrg] = useState(false);
  const [loading, setLoading] = useState(false);
  const { open } = useRegistrationOpen();
  const { CloudSignupLink } = getClientSlots();
  const [closed, setClosed] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNeedsOrg(false);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 403 && data.code === "registration_closed") {
        setClosed(true);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || t("errors.default"));
        setNeedsOrg(Boolean(data.needsOrg));
        setLoading(false);
        return;
      }

      router.push("/check-email?email=" + encodeURIComponent(email));
    } catch {
      setError(t("errors.networkError"));
      setLoading(false);
    }
  }

  const showClosed = open === false || closed;

  return (
    <div className="flex-1 flex items-center justify-center bg-muted/30">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 flex flex-col items-center gap-4">
          <Image
            src="/mascotte.svg"
            alt="LorIAx"
            width={80}
            height={80}
            priority
          />
          <h1 className="text-3xl font-bold text-foreground">LorIAx</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        {open === null && !closed ? (
          <div
            role="status"
            aria-busy="true"
            className="h-72 animate-pulse rounded-xl bg-muted"
          />
        ) : showClosed ? (
          <ClosedRegistrationCard />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="bg-destructive/10 text-destructive text-sm rounded-lg p-3">
                    {error}
                    {needsOrg && CloudSignupLink && (
                      <>
                        {" "}
                        <CloudSignupLink />
                      </>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="name">{t("nameLabel")}</Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                    placeholder={t("namePlaceholder")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">{t("emailLabel")}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder={t("emailPlaceholder")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">{t("passwordLabel")}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder={t("passwordPlaceholder")}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {loading ? t("submitting") : t("submit")}
                </Button>
              </form>
            </CardContent>

            <CardFooter className="justify-center">
              <p className="text-sm text-muted-foreground">
                {t("alreadyAccount")}{" "}
                <Link
                  href="/login"
                  className="text-primary hover:underline font-medium"
                >
                  {t("signIn")}
                </Link>
              </p>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
