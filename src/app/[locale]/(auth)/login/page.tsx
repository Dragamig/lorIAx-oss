"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";
import { Link } from "@/i18n/routing";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { LOCALES } from "@/i18n/config";

// Le middleware stocke le pathname complet (avec préfixe locale) dans callbackUrl.
// useRouter() de next-intl re-préfixe la locale → double /fr/fr. On strip le préfixe.
const LOCALE_PREFIX_RE = new RegExp(`^\\/(${LOCALES.join("|")})(\\/)?(.*)`);
function stripLocalePrefix(path: string): string {
  const m = path.match(LOCALE_PREFIX_RE);
  return m ? `/${m[3]}` : path;
}

function LoginForm() {
  const t = useTranslations("auth.login");
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError(t("errors.invalidCredentials"));
      return;
    }

    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
    if (rootDomain) {
      try {
        const res = await fetch("/api/auth/whoami", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { orgSlug?: string | null };
          const currentHost = window.location.host;
          const targetHost = data.orgSlug ? `${data.orgSlug}.${rootDomain}` : null;
          if (targetHost && targetHost !== currentHost) {
            window.location.href = `${window.location.protocol}//${targetHost}${callbackUrl}`;
            return;
          }
        }
      } catch {
        // fallback silencieux : redirection locale
      }
    }

    router.push(stripLocalePrefix(callbackUrl));
    router.refresh();
  }

  const isDev = process.env.NODE_ENV === "development";

  function fillCredentials(email: string, password: string) {
    setEmail(email);
    setPassword(password);
  }

  return (
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
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm rounded-lg p-3">
                {error}
              </div>
            )}

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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("passwordLabel")}</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  {t("forgotPassword")}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
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
            {t("noAccount")}{" "}
            <Link
              href="/register"
              className="text-primary hover:underline font-medium"
            >
              {t("createAccount")}
            </Link>
          </p>
        </CardFooter>
      </Card>

      {isDev && (
        <div className="mt-4 rounded-xl border border-dashed border-loriax-amber/40 bg-loriax-amber/5 p-4">
          <p className="text-xs font-semibold text-loriax-amber mb-3 text-center uppercase tracking-wide">
            {t("devAccountsTitle")}
          </p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => fillCredentials("admin@loriax.dev", "admin123")}
              className="w-full flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <div className="text-left">
                <span className="font-medium">Admin</span>
                <span className="text-muted-foreground ml-2">admin@loriax.dev</span>
              </div>
              <span className="text-xs font-mono text-muted-foreground">admin123</span>
            </button>
            <button
              type="button"
              onClick={() => fillCredentials("user@loriax.dev", "user123")}
              className="w-full flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <div className="text-left">
                <span className="font-medium">User</span>
                <span className="text-muted-foreground ml-2">user@loriax.dev</span>
              </div>
              <span className="text-xs font-mono text-muted-foreground">user123</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  const t = useTranslations("common");
  return (
    <div className="flex-1 flex items-center justify-center bg-muted/30">
      <Suspense fallback={<div className="animate-pulse">{t("loading")}</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
