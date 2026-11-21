"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  Globe,
  Shield,
  Server,
  Users,
  Loader2,
  Network,
  MousePointerClick,
  TriangleAlert,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModuleActivationNotice } from "@/components/admin/module-activation-notice";
import { AdminSaveBar } from "@/components/admin/floating-save-button";

interface SystemSettings {
  appName: string;
  appUrl: string;
  allowRegistration: boolean;
  defaultRole: string;
}

interface LdapSettings {
  ldapEnabled: boolean;
  ldapUrl: string;
  ldapBindDn: string;
  ldapBindPassword: string;
  ldapBaseDn: string;
  ldapSearchFilter: string;
  ldapNameAttribute: string;
  ldapEmailAttribute: string;
  ldapRejectUnauthorized: boolean;
}

interface RolePermissions {
  canCreateSpaces: boolean;
  canCreatePublicDocs: boolean;
  canCreateTemplates: boolean;
  canInviteMembers: boolean;
}

const defaultSettings: SystemSettings = {
  appName: "LorIAx",
  appUrl: "",
  allowRegistration: true,
  defaultRole: "editor",
};

const defaultLdapSettings: LdapSettings = {
  ldapEnabled: false,
  ldapUrl: "",
  ldapBindDn: "",
  ldapBindPassword: "",
  ldapBaseDn: "",
  ldapSearchFilter: "(mail={{email}})",
  ldapNameAttribute: "cn",
  ldapEmailAttribute: "mail",
  ldapRejectUnauthorized: true,
};

const defaultRolePermissions: Record<string, RolePermissions> = {
  viewer: {
    canCreateSpaces: false,
    canCreatePublicDocs: false,
    canCreateTemplates: false,
    canInviteMembers: false,
  },
  editor: {
    canCreateSpaces: true,
    canCreatePublicDocs: true,
    canCreateTemplates: false,
    canInviteMembers: true,
  },
  admin: {
    canCreateSpaces: true,
    canCreatePublicDocs: true,
    canCreateTemplates: true,
    canInviteMembers: true,
  },
};

const permissionLabels: Record<keyof RolePermissions, { label: string; description: string }> = {
  canCreateSpaces: {
    label: "Créer des espaces",
    description: "Peut créer de nouveaux espaces de travail",
  },
  canCreatePublicDocs: {
    label: "Publier des documents",
    description: "Peut rendre des documents publics à toute l'organisation",
  },
  canCreateTemplates: {
    label: "Gérer les templates",
    description: "Peut créer et modifier des templates globaux",
  },
  canInviteMembers: {
    label: "Inviter des membres",
    description: "Peut ajouter des collaborateurs à ses espaces",
  },
};

/**
 * Mention affichée à la place d'une section que l'API réserve à
 * l'administration d'instance. Afficher les champs en lecture seule serait
 * pire que de les masquer : leurs valeurs seraient celles des constantes de ce
 * fichier, pas celles de l'instance.
 */
function InstanceOnlySection({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">
          Réglages réservés à l&apos;administration d&apos;instance
        </p>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

export function AdminSystemTab() {
  /**
   * Sections d'infrastructure (`auth`, `ldap`) : depuis le correctif AZ-08,
   * elles sont réservées à l'administration d'instance. L'API ne les rend plus
   * à un administrateur d'organisation et refuse EN BLOC un enregistrement qui
   * les porte. Deux conséquences, toutes deux traitées ici.
   *
   * 1. Le corps envoyé ne les porte que si l'appelant peut les écrire, sinon
   *    la page entière deviendrait inenregistrable, y compris les sections qui
   *    reviennent bien à cet admin (nom de l'application, matrice de rôles).
   * 2. Elles ne sont pas RENDUES à qui ne peut pas les lire : sans cela, la
   *    page affichait les valeurs par défaut des constantes ci-dessus comme si
   *    c'était la politique de l'instance, les laissait éditer, puis annonçait
   *    « Paramètres sauvegardés » sans que rien n'ait quitté le navigateur.
   *
   * La condition porte sur le RÔLE, pas sur la présence des clés dans la
   * réponse : une instance fraîche n'a pas encore de ligne `auth` ni `ldap`, et
   * l'administration d'instance doit pouvoir les créer.
   */
  const { data: session, status: sessionStatus } = useSession();
  const isInstanceAdmin =
    (session?.user as { globalRole?: string } | undefined)?.globalRole === "super_admin";

  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);
  // Interrupteurs de modules : lecture seule ici, ils se règlent depuis /admin/modules.
  const [collabEnabled, setCollabEnabled] = useState(true);
  const [ldapSettings, setLdapSettings] = useState<LdapSettings>(defaultLdapSettings);
  const [rolePerms, setRolePerms] = useState(defaultRolePermissions);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingLdap, setTestingLdap] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("...");
  const [showWizardModal, setShowWizardModal] = useState(false);
  const [wizardPassword, setWizardPassword] = useState("");
  const [wizardPasswordVisible, setWizardPasswordVisible] = useState(false);
  const [wizardVerifying, setWizardVerifying] = useState(false);
  const [wizardError, setWizardError] = useState("");

  // Snapshot du dernier état enregistré (détection des modifications en attente)
  const [pristine, setPristine] = useState<string | null>(null);
  const currentSnapshot = useMemo(
    () => JSON.stringify({ settings, ldapSettings, rolePerms }),
    [settings, ldapSettings, rolePerms]
  );
  const isDirty = pristine !== null && pristine !== currentSnapshot;

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setAppVersion(data.version || "dev"))
      .catch(() => {});
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings");
      if (!res.ok) return;
      const data = await res.json();

      if (data.general) {
        setSettings((prev) => ({ ...prev, ...data.general }));
      }
      if (data.auth) {
        setSettings((prev) => ({
          ...prev,
          allowRegistration: data.auth.allowRegistration ?? prev.allowRegistration,
          defaultRole: data.auth.defaultRole ?? prev.defaultRole,
        }));
      }
      if (typeof data.collab?.collabEnabled === "boolean") {
        setCollabEnabled(data.collab.collabEnabled);
      }
      if (data.ldap) {
        setLdapSettings((prev) => ({ ...prev, ...data.ldap }));
      }
      if (data.rolePermissions) {
        setRolePerms((prev) => ({
          ...prev,
          ...data.rolePermissions,
        }));
      }
    } catch {
      // Use defaults on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && !settings.appUrl) {
      setSettings((prev) => ({ ...prev, appUrl: window.location.origin }));
    }
    loadSettings();
  }, [loadSettings, settings.appUrl]);

  // Capturer le snapshot pristine une fois le chargement initial terminé.
  // On attend que `appUrl` soit renseignée : l'effet ci-dessus la remplit avec
  // l'origine courante quand l'API n'en fournit pas, ce qui marquerait sinon la
  // page comme modifiée dès l'ouverture.
  useEffect(() => {
    if (loading || pristine !== null || !settings.appUrl) return;
    setPristine(currentSnapshot);
  }, [loading, pristine, currentSnapshot, settings.appUrl]);

  function updateSetting<K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function updateLdap<K extends keyof LdapSettings>(key: K, value: LdapSettings[K]) {
    setLdapSettings((prev) => ({ ...prev, [key]: value }));
  }

  function toggleRolePerm(role: string, perm: keyof RolePermissions) {
    setRolePerms((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [perm]: !prev[role][perm],
      },
    }));
  }

  async function handleWizardConfirm() {
    setWizardError("");
    setWizardVerifying(true);
    try {
      const res = await fetch("/api/admin/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: wizardPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        setWizardError(data.error || "Mot de passe incorrect");
        return;
      }
      window.location.href = "/setup";
    } catch {
      setWizardError("Erreur réseau, veuillez réessayer");
    } finally {
      setWizardVerifying(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      // `ldapEnabled` est l'interrupteur du module LDAP : il ne s'écrit que
      // depuis /admin/modules, on ne le renvoie pas ici. Idem pour la clé
      // `collab`, qui ne porte que l'interrupteur du module Collaboration.
      const { ldapEnabled: _ldapEnabled, ...ldapConfig } = ldapSettings;
      const payload: Record<string, unknown> = {
        general: {
          appName: settings.appName,
          appUrl: settings.appUrl,
        },
        rolePermissions: rolePerms,
      };
      // On ne réémet une section d'infrastructure que si l'appelant a le droit
      // de l'écrire (cf. le commentaire de `isInstanceAdmin`).
      if (isInstanceAdmin) {
        payload.auth = {
          allowRegistration: settings.allowRegistration,
          defaultRole: settings.defaultRole,
        };
        payload.ldap = ldapConfig;
      }

      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erreur lors de la sauvegarde");
      }

      setPristine(currentSnapshot);
      toast.success("Paramètres sauvegardés");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  if (loading || sessionStatus === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <AdminSaveBar
        title="Paramètres système"
        label="Enregistrer les paramètres"
        onSave={handleSave}
        saving={saving}
        isDirty={isDirty}
      />

      <p className="text-sm text-muted-foreground">
        Configuration générale de l&apos;application.
      </p>

      {/* Général */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Général</h3>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="app-name">Nom de l&apos;application</Label>
            <Input
              id="app-name"
              value={settings.appName}
              onChange={(e) => updateSetting("appName", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="app-url">URL de l&apos;application</Label>
            <Input
              id="app-url"
              value={settings.appUrl}
              onChange={(e) => updateSetting("appUrl", e.target.value)}
              placeholder="https://loriax.example.com"
            />
          </div>
        </div>
      </section>

      {/* Authentification */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Authentification</h3>
        </div>

        {!isInstanceAdmin && (
          <InstanceOnlySection text="La politique d'inscription et le rôle par défaut valent pour toutes les organisations de cette instance. Ils ne sont ni lisibles ni modifiables depuis l'administration d'une organisation." />
        )}

        {isInstanceAdmin && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Inscription ouverte</p>
              <p className="text-xs text-muted-foreground">
                Permettre aux nouveaux utilisateurs de créer un compte
              </p>
            </div>
            <button
              onClick={() => updateSetting("allowRegistration", !settings.allowRegistration)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.allowRegistration ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.allowRegistration ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="default-role">Rôle par défaut des nouveaux utilisateurs</Label>
            <select
              id="default-role"
              value={settings.defaultRole}
              onChange={(e) => updateSetting("defaultRole", e.target.value)}
              className="px-3 py-2 rounded-md border border-input bg-background text-sm"
            >
              <option value="viewer">Lecteur</option>
              <option value="editor">Éditeur</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>
        </div>
        )}
      </section>

      {/* Collaboration temps réel */}
      <section id="collaboration" className="space-y-4 scroll-mt-24">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <MousePointerClick className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Collaboration temps réel</h3>
        </div>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Permet l&apos;édition simultanée de documents par plusieurs utilisateurs (WebSocket).
            À désactiver en cas de problèmes de performance ou de rendu.
          </p>

          <ModuleActivationNotice enabled={collabEnabled} moduleName="Collaboration temps réel" />

          {!collabEnabled && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                La collaboration est désactivée. Les documents seront verrouillés individuellement
                lorsqu&apos;un utilisateur les modifie (mode verrou pessimiste). Les curseurs
                temps réel et la co-édition ne seront pas disponibles.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* LDAP / Annuaire */}
      <section id="ldap" className="space-y-4 scroll-mt-24">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Network className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">LDAP / Annuaire</h3>
        </div>

        {!isInstanceAdmin && (
          <InstanceOnlySection text="L'annuaire d'entreprise et son compte de service sont partagés par toute l'instance. Leur configuration et leur test de connexion ne sont ni lisibles ni modifiables depuis l'administration d'une organisation." />
        )}

        {isInstanceAdmin && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Permet aux utilisateurs de se connecter via un annuaire LDAP / Active Directory.
            La configuration ci-dessous reste modifiable module éteint, pour pouvoir le préparer
            avant de l&apos;allumer.
          </p>

          <ModuleActivationNotice enabled={ldapSettings.ldapEnabled} moduleName="LDAP / Annuaire" />

          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="ldap-url">URL du serveur LDAP</Label>
                <Input
                  id="ldap-url"
                  value={ldapSettings.ldapUrl}
                  onChange={(e) => updateLdap("ldapUrl", e.target.value)}
                  placeholder="ldaps://ldap.example.com:636"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ldap-bind-dn">Bind DN (compte de service)</Label>
                <Input
                  id="ldap-bind-dn"
                  value={ldapSettings.ldapBindDn}
                  onChange={(e) => updateLdap("ldapBindDn", e.target.value)}
                  placeholder="cn=admin,dc=example,dc=com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ldap-bind-password">Mot de passe Bind</Label>
                <Input
                  id="ldap-bind-password"
                  type="password"
                  value={ldapSettings.ldapBindPassword}
                  onChange={(e) => updateLdap("ldapBindPassword", e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ldap-base-dn">Base DN</Label>
                <Input
                  id="ldap-base-dn"
                  value={ldapSettings.ldapBaseDn}
                  onChange={(e) => updateLdap("ldapBaseDn", e.target.value)}
                  placeholder="dc=example,dc=com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ldap-filter">Filtre de recherche</Label>
                <Input
                  id="ldap-filter"
                  value={ldapSettings.ldapSearchFilter}
                  onChange={(e) => updateLdap("ldapSearchFilter", e.target.value)}
                  placeholder="(mail={{email}})"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ldap-name-attr">Attribut nom</Label>
                <Input
                  id="ldap-name-attr"
                  value={ldapSettings.ldapNameAttribute}
                  onChange={(e) => updateLdap("ldapNameAttribute", e.target.value)}
                  placeholder="cn"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ldap-email-attr">Attribut email</Label>
                <Input
                  id="ldap-email-attr"
                  value={ldapSettings.ldapEmailAttribute}
                  onChange={(e) => updateLdap("ldapEmailAttribute", e.target.value)}
                  placeholder="mail"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateLdap("ldapRejectUnauthorized", !ldapSettings.ldapRejectUnauthorized)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    ldapSettings.ldapRejectUnauthorized ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      ldapSettings.ldapRejectUnauthorized ? "translate-x-4.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <span className="text-sm text-muted-foreground">Vérifier le certificat TLS</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={testingLdap || !ldapSettings.ldapUrl}
                onClick={async () => {
                  setTestingLdap(true);
                  try {
                    await handleSave();
                    const res = await fetch("/api/admin/settings/ldap-test", {
                      method: "POST",
                    });
                    const data = await res.json();
                    if (res.ok) {
                      toast.success(data.message);
                    } else {
                      toast.error(data.error);
                    }
                  } catch {
                    toast.error("Erreur lors du test LDAP");
                  } finally {
                    setTestingLdap(false);
                  }
                }}
              >
                {testingLdap ? (
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                ) : (
                  <Network className="h-3.5 w-3.5 mr-2" />
                )}
                Tester la connexion
              </Button>
            </div>
          </div>
        </div>
        )}
      </section>

      {/* Permissions par rôle */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Permissions par rôle</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Permission</th>
                {(["viewer", "editor", "admin"] as const).map((role) => (
                  <th key={role} className="text-center py-2 px-4 font-medium text-muted-foreground">
                    {{
                      viewer: "Lecteur",
                      editor: "Éditeur",
                      admin: "Admin",
                    }[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(permissionLabels) as Array<keyof RolePermissions>).map((perm) => (
                <tr key={perm} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4">
                    <p className="font-medium">{permissionLabels[perm].label}</p>
                    <p className="text-xs text-muted-foreground">
                      {permissionLabels[perm].description}
                    </p>
                  </td>
                  {(["viewer", "editor", "admin"] as const).map((role) => (
                    <td key={role} className="text-center py-3 px-4">
                      <button
                        onClick={() => toggleRolePerm(role, perm)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          rolePerms[role][perm] ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            rolePerms[role][perm] ? "translate-x-4.5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Les permissions IA (chat, playground, logs) sont gérées dans la{" "}
          <a href="/admin/ai/settings" className="text-primary hover:underline">section Intelligence artificielle</a>.
        </p>
      </section>

      {/* Zone dangereuse */}
      <div className="flex items-center gap-2 pt-2">
        <TriangleAlert className="h-4 w-4 text-destructive" />
        <span className="text-sm font-semibold text-destructive uppercase tracking-wide">Zone dangereuse</span>
      </div>

      {/* Configuration initiale */}
      <section className="space-y-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 border-b border-destructive/20 pb-2">
          <MousePointerClick className="h-4 w-4 text-destructive/70" />
          <h3 className="font-medium text-destructive/90">Configuration initiale</h3>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Assistant de configuration</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Relancer le wizard pour reconfigurer l&apos;identité, les utilisateurs et les espaces.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setWizardPassword("");
              setWizardError("");
              setShowWizardModal(true);
            }}
          >
            <MousePointerClick className="h-4 w-4 mr-2" />
            Relancer le wizard
          </Button>
        </div>
      </section>

      {/* Modale confirmation mot de passe */}
      {showWizardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <TriangleAlert className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Confirmer votre identité</h2>
                <p className="text-xs text-muted-foreground">Saisissez votre mot de passe administrateur pour continuer.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wizard-password">Mot de passe</Label>
              <div className="relative">
                <Input
                  id="wizard-password"
                  type={wizardPasswordVisible ? "text" : "password"}
                  value={wizardPassword}
                  onChange={(e) => { setWizardPassword(e.target.value); setWizardError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleWizardConfirm()}
                  placeholder="••••••••"
                  autoFocus
                  className={wizardError ? "border-destructive pr-10" : "pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setWizardPasswordVisible((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {wizardPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {wizardError && (
                <p className="text-xs text-destructive">{wizardError}</p>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowWizardModal(false)}
                disabled={wizardVerifying}
              >
                Annuler
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleWizardConfirm}
                disabled={!wizardPassword || wizardVerifying}
              >
                {wizardVerifying ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <MousePointerClick className="h-4 w-4 mr-2" />
                )}
                Accéder au wizard
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Informations système */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Informations système</h3>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="p-3 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground">Version</p>
            <p className="text-sm font-medium">{appVersion}</p>
          </div>
          <div className="p-3 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground">Framework</p>
            <p className="text-sm font-medium">Next.js 16</p>
          </div>
          <div className="p-3 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground">Base de données</p>
            <p className="text-sm font-medium">PostgreSQL 16</p>
          </div>
        </div>
      </section>
    </div>
  );
}
