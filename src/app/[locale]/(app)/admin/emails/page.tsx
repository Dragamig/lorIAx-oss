"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Send, Loader2, Server, Cloud, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModuleActivationNotice } from "@/components/admin/module-activation-notice";
import { AdminSaveBar } from "@/components/admin/floating-save-button";

type EmailProvider = "smtp" | "resend";

interface EmailSettings {
  emailEnabled: boolean;
  emailProvider: EmailProvider;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpSecure: boolean;
  resendApiKey: string;
  resendFrom: string;
}

const defaultSettings: EmailSettings = {
  emailEnabled: false,
  emailProvider: "smtp",
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPassword: "",
  smtpFrom: "",
  smtpSecure: false,
  resendApiKey: "",
  resendFrom: "",
};

export default function EmailsConfigPage() {
  /**
   * AZ-08 : les clés `email` et `smtp` sont d'infrastructure. L'API ne les rend
   * plus à un administrateur d'organisation, refuse leur écriture en 403 et
   * refuse aussi les deux tests d'envoi. Sans cette garde, la page affichait
   * une configuration vide (les valeurs par défaut des constantes), annonçait
   * « relais non configuré » alors qu'il l'est, et laissait éditer puis
   * enregistrer des champs qui n'arrivaient jamais en base. On préfère le dire
   * plutôt que de laisser croire.
   */
  const { data: session, status: sessionStatus } = useSession();
  const isInstanceAdmin =
    (session?.user as { globalRole?: string } | undefined)?.globalRole === "super_admin";

  const [settings, setSettings] = useState<EmailSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Snapshot du dernier état enregistré (détection des modifications en attente)
  const [pristine, setPristine] = useState<string | null>(null);
  const currentSnapshot = useMemo(() => JSON.stringify(settings), [settings]);
  const isDirty = pristine !== null && pristine !== currentSnapshot;

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings");
      if (!res.ok) return;
      const data = await res.json();
      if (data.email) {
        setSettings((prev) => ({ ...prev, ...data.email }));
      } else if (data.smtp) {
        const smtp = data.smtp;
        setSettings((prev) => ({
          ...prev,
          emailEnabled: smtp.smtpEnabled ?? false,
          emailProvider: "smtp",
          smtpHost: smtp.smtpHost ?? "",
          smtpPort: String(smtp.smtpPort ?? "587"),
          smtpUser: smtp.smtpUser ?? "",
          smtpPassword: smtp.smtpPassword ?? "",
          smtpFrom: smtp.smtpFrom ?? "",
          smtpSecure: smtp.smtpSecure ?? false,
        }));
      }
    } catch {
      // defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Capturer le snapshot pristine une fois le chargement initial terminé
  useEffect(() => {
    if (loading || pristine !== null) return;
    setPristine(currentSnapshot);
  }, [loading, pristine, currentSnapshot]);

  function update<K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // `emailEnabled` est l'interrupteur du module Emails : il ne s'écrit
          // que depuis /admin/modules, on ne le renvoie pas ici.
          email: {
            emailProvider: settings.emailProvider,
            smtpHost: settings.smtpHost,
            smtpPort: settings.smtpPort,
            smtpUser: settings.smtpUser,
            smtpPassword: settings.smtpPassword,
            smtpFrom: settings.smtpFrom,
            smtpSecure: settings.smtpSecure,
            resendApiKey: settings.resendApiKey,
            resendFrom: settings.resendFrom,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erreur lors de la sauvegarde");
      }
      setPristine(currentSnapshot);
      toast.success("Configuration email sauvegardée");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      await handleSave();
      const endpoint =
        settings.emailProvider === "resend"
          ? "/api/admin/settings/resend-test"
          : "/api/admin/settings/smtp-test";
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (res.ok) toast.success(data.message);
      else toast.error(data.error);
    } catch {
      toast.error("Erreur lors du test");
    } finally {
      setTesting(false);
    }
  }

  const canTest =
    settings.emailProvider === "resend" ? !!settings.resendApiKey : !!settings.smtpHost;

  if (sessionStatus === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isInstanceAdmin) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Provider d&apos;envoi (SMTP ou Resend) : notifications, invitations et
          réinitialisation de mot de passe.
        </p>
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Réglages réservés à l&apos;administration d&apos;instance
            </p>
            <p className="text-xs text-muted-foreground">
              Le relais de messagerie est partagé par toutes les organisations de
              cette instance. Sa configuration et ses tests d&apos;envoi ne sont ni
              lisibles ni modifiables depuis l&apos;administration d&apos;une
              organisation.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <AdminSaveBar
        title="Configuration"
        onSave={handleSave}
        saving={saving}
        isDirty={isDirty}
      >
        <Button
          variant="outline"
          disabled={testing || !canTest || loading}
          onClick={handleTest}
        >
          {testing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Tester la connexion
        </Button>
      </AdminSaveBar>

      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Provider d&apos;envoi (SMTP ou Resend) : notifications, invitations et
          réinitialisation de mot de passe.
        </p>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <ModuleActivationNotice enabled={settings.emailEnabled} moduleName="Emails" />

      <div className="space-y-6">
        <div className="space-y-3">
          <Label className="text-sm font-medium">Provider d&apos;envoi</Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => update("emailProvider", "smtp")}
              className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-colors text-left ${
                settings.emailProvider === "smtp"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/30"
              }`}
            >
              <div
                className={`p-2 rounded-md ${
                  settings.emailProvider === "smtp" ? "bg-primary/10" : "bg-muted"
                }`}
              >
                <Server
                  className={`h-5 w-5 ${
                    settings.emailProvider === "smtp" ? "text-primary" : "text-muted-foreground"
                  }`}
                />
              </div>
              <div>
                <p className="font-medium text-sm">Serveur SMTP</p>
                <p className="text-xs text-muted-foreground">
                  Serveur mail auto-hébergé ou tiers
                </p>
              </div>
            </button>

            <button
              onClick={() => update("emailProvider", "resend")}
              className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-colors text-left ${
                settings.emailProvider === "resend"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/30"
              }`}
            >
              <div
                className={`p-2 rounded-md ${
                  settings.emailProvider === "resend" ? "bg-primary/10" : "bg-muted"
                }`}
              >
                <Cloud
                  className={`h-5 w-5 ${
                    settings.emailProvider === "resend" ? "text-primary" : "text-muted-foreground"
                  }`}
                />
              </div>
              <div>
                <p className="font-medium text-sm">Resend</p>
                <p className="text-xs text-muted-foreground">
                  API cloud pour l&apos;envoi d&apos;emails
                </p>
              </div>
            </button>
          </div>
        </div>

        {settings.emailProvider === "smtp" && (
          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="smtp-host">Serveur SMTP</Label>
                <Input
                  id="smtp-host"
                  value={settings.smtpHost}
                  onChange={(e) => update("smtpHost", e.target.value)}
                  placeholder="smtp.example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  value={settings.smtpPort}
                  onChange={(e) => update("smtpPort", e.target.value)}
                  placeholder="587"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-user">Identifiant</Label>
                <Input
                  id="smtp-user"
                  value={settings.smtpUser}
                  onChange={(e) => update("smtpUser", e.target.value)}
                  placeholder="noreply@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-password">Mot de passe</Label>
                <Input
                  id="smtp-password"
                  type="password"
                  value={settings.smtpPassword}
                  onChange={(e) => update("smtpPassword", e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-from">Expéditeur</Label>
                <Input
                  id="smtp-from"
                  value={settings.smtpFrom}
                  onChange={(e) => update("smtpFrom", e.target.value)}
                  placeholder="LorIAx <noreply@example.com>"
                />
              </div>
              <div className="space-y-2">
                <Label>Connexion sécurisée (TLS)</Label>
                <button
                  onClick={() => update("smtpSecure", !settings.smtpSecure)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.smtpSecure ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.smtpSecure ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        )}

        {settings.emailProvider === "resend" && (
          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="resend-api-key">Clé API Resend</Label>
                <Input
                  id="resend-api-key"
                  type="password"
                  value={settings.resendApiKey}
                  onChange={(e) => update("resendApiKey", e.target.value)}
                  placeholder="re_xxxxxxxxxxxx"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="resend-from">Expéditeur</Label>
                <Input
                  id="resend-from"
                  value={settings.resendFrom}
                  onChange={(e) => update("resendFrom", e.target.value)}
                  placeholder="LorIAx <noreply@votre-domaine.com>"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Obtenez votre clé API sur{" "}
              <a
                href="https://resend.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                resend.com/api-keys
              </a>
              . Le domaine expéditeur doit être vérifié dans votre compte Resend.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
