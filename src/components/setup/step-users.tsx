"use client";

import { useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  ArrowRight,
  ArrowLeft,
  Users,
  UserPlus,
  Upload,
  Download,
  Network,
  X,
  Shield,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { parseCsvUsers, type ParsedUser } from "@/lib/setup/csv-parser";
import type { SetupData } from "@/app/[locale]/(setup)/setup/page";
import { setupFetch } from "@/lib/setup/client";

// ── Types ──────────────────────────────────────────────────────

interface StepUsersProps {
  data: SetupData;
  onUpdate: (users: SetupData["users"]) => void;
  onNext: () => void;
  onBack?: () => void;
}

interface LocalUser {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "admin" | "editor" | "viewer";
  password: string;
  team: string;
}

type AddTab = "manual" | "csv" | "ldap";

// ── Constants ──────────────────────────────────────────────────

const ROLE_BADGE_COLORS: Record<string, string> = {
  super_admin: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  admin: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  editor: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  viewer: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

// CSV template columns are invariant (parsed by csv-parser which expects these specific column names)
const CSV_TEMPLATE = "nom,email,role,mot_de_passe,equipe\nJean Dupont,jean@example.com,editor,,Direction\nMarie Martin,marie@example.com,viewer,,Support";

function generateId(): string {
  return crypto.randomUUID();
}

function generatePassword(length = 12): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join("");
}

// ── Component ──────────────────────────────────────────────────

export function StepUsers({ data: _data, onUpdate, onNext, onBack }: StepUsersProps) {
  const t = useTranslations("setup.users");

  const ROLE_OPTIONS = [
    { value: "admin" as const, label: t("roles.admin") },
    { value: "editor" as const, label: t("roles.editor") },
    { value: "viewer" as const, label: t("roles.viewer") },
  ];

  const ROLE_LABELS: Record<string, string> = {
    super_admin: t("roles.superAdmin"),
    admin: t("roles.admin"),
    editor: t("roles.editor"),
    viewer: t("roles.viewer"),
  };

  // Super admin state
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
  const [adminDone, setAdminDone] = useState(false);

  // Manual add form state
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualRole, setManualRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [manualTeam, setManualTeam] = useState("");

  // Users list
  const [usersList, setUsersList] = useState<LocalUser[]>([]);

  // Active tab
  const [activeTab, setActiveTab] = useState<AddTab>("manual");

  // CSV state
  const [csvPreview, setCsvPreview] = useState<ParsedUser[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // LDAP state
  const [ldapUrl, setLdapUrl] = useState("");
  const [ldapBindDn, setLdapBindDn] = useState("");
  const [ldapBindPassword, setLdapBindPassword] = useState("");
  const [ldapBaseDn, setLdapBaseDn] = useState("");
  const [ldapSearchFilter, setLdapSearchFilter] = useState("(mail={{email}})");
  const [ldapNameAttr, setLdapNameAttr] = useState("cn");
  const [ldapEmailAttr, setLdapEmailAttr] = useState("mail");
  const [ldapRejectUnauthorized, setLdapRejectUnauthorized] = useState(true);
  const [ldapSaving, setLdapSaving] = useState(false);
  const [ldapSaved, setLdapSaved] = useState(false);

  // Credentials export state
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [createdUsers, setCreatedUsers] = useState<SetupData["users"]>([]);

  // Global state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── Super admin ──────────────────────────────────────────────

  function handleAdminConfirm() {
    if (!adminName.trim() || !adminEmail.trim() || !adminPassword.trim()) return;
    if (adminPassword.length < 12) {
      setError(t("errors.passwordTooShort"));
      return;
    }
    if (adminPassword !== adminPasswordConfirm) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    const adminUser: LocalUser = {
      id: generateId(),
      name: adminName.trim(),
      email: adminEmail.trim().toLowerCase(),
      role: "super_admin",
      password: adminPassword,
      team: "",
    };

    setUsersList((prev) => {
      // Replace existing super admin if any
      const filtered = prev.filter((u) => u.role !== "super_admin");
      return [adminUser, ...filtered];
    });
    setAdminDone(true);
    setError("");
  }

  // ── Manual add ──────────────────────────────────────────────

  function handleManualAdd() {
    if (!manualName.trim() || !manualEmail.trim()) return;

    const email = manualEmail.trim().toLowerCase();
    if (usersList.some((u) => u.email === email)) {
      setError(t("errors.emailDuplicate", { email }));
      return;
    }

    const password = generatePassword();
    const user: LocalUser = {
      id: generateId(),
      name: manualName.trim(),
      email,
      role: manualRole,
      password,
      team: manualTeam.trim(),
    };

    setUsersList((prev) => [...prev, user]);
    setManualName("");
    setManualEmail("");
    setManualRole("editor");
    setManualTeam("");
    setError("");
  }

  // ── CSV ──────────────────────────────────────────────────────

  const handleCsvFile = useCallback((file: File) => {
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      const result = parseCsvUsers(text);
      setCsvPreview(result.users);
      setCsvErrors(result.errors);
    };
    reader.readAsText(file);
  }, []);

  function handleCsvImport() {
    if (csvPreview.length === 0) return;

    const existingEmails = new Set(usersList.map((u) => u.email));
    const newUsers: LocalUser[] = [];
    const skipped: string[] = [];

    for (const pu of csvPreview) {
      if (existingEmails.has(pu.email)) {
        skipped.push(pu.email);
        continue;
      }
      newUsers.push({
        id: generateId(),
        name: pu.name,
        email: pu.email,
        role: pu.role,
        password: pu.password,
        team: pu.team,
      });
      existingEmails.add(pu.email);
    }

    setUsersList((prev) => [...prev, ...newUsers]);
    setCsvPreview([]);
    setCsvErrors([]);
    setCsvFileName("");

    if (skipped.length > 0) {
      setError(t("errors.emailsSkipped", { count: skipped.length }));
    } else {
      setError("");
    }
  }

  function downloadCsvTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modele-utilisateurs.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── LDAP ─────────────────────────────────────────────────────

  async function handleLdapSave() {
    if (!ldapUrl.trim() || !ldapBaseDn.trim()) {
      setError(t("errors.ldapRequired"));
      return;
    }

    setLdapSaving(true);
    setError("");

    try {
      const res = await setupFetch("/api/setup/users/ldap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ldapEnabled: true,
          ldapUrl: ldapUrl.trim(),
          ldapBindDn: ldapBindDn.trim(),
          ldapBindPassword: ldapBindPassword,
          ldapBaseDn: ldapBaseDn.trim(),
          ldapSearchFilter: ldapSearchFilter.trim(),
          ldapNameAttribute: ldapNameAttr.trim(),
          ldapEmailAttribute: ldapEmailAttr.trim(),
          ldapRejectUnauthorized,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t("errors.ldapSaveError"));
      }

      setLdapSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.ldapSaveError"));
    } finally {
      setLdapSaving(false);
    }
  }

  // ── Remove user ──────────────────────────────────────────────

  function removeUser(id: string) {
    const user = usersList.find((u) => u.id === id);
    if (user?.role === "super_admin") {
      setAdminDone(false);
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
    }
    setUsersList((prev) => prev.filter((u) => u.id !== id));
  }

  // ── Submit ───────────────────────────────────────────────────

  async function handleNext() {
    if (!adminDone || usersList.length === 0) {
      setError(t("errors.superAdminRequired"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        users: usersList.map((u) => ({
          name: u.name,
          email: u.email,
          role: u.role,
          password: u.password,
          team: u.team || undefined,
        })),
      };

      const res = await setupFetch("/api/setup/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t("errors.createError"));
      }

      const result = await res.json();

      // Map created users to SetupData format
      const setupUsers: SetupData["users"] = result.created.map(
        (c: { id: string; email: string; name: string }, i: number) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          role: usersList[i]?.role || "editor",
          team: usersList[i]?.team || undefined,
          generatedPassword: usersList[i]?.password,
        })
      );

      onUpdate(setupUsers);
      setCreatedUsers(setupUsers);

      // S'il y a des utilisateurs avec mot de passe généré (hors super admin),
      // afficher l'écran de téléchargement des identifiants
      const hasGeneratedPasswords = usersList.some(
        (u) => u.role !== "super_admin" && u.password
      );
      if (hasGeneratedPasswords) {
        setCredentialsReady(true);
      } else {
        onNext();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unexpectedError"));
    } finally {
      setSaving(false);
    }
  }

  // ── Drag & drop handlers ─────────────────────────────────────

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
      handleCsvFile(file);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  // ── Export CSV des identifiants ───────────────────────────────

  function downloadCredentialsCsv() {
    const header = "nom,email,role,mot_de_passe,equipe";
    const rows = usersList
      .filter((u) => u.role !== "super_admin")
      .map(
        (u) =>
          `"${u.name}","${u.email}","${u.role}","${u.password}","${u.team || ""}"`
      );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "identifiants-utilisateurs.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ───────────────────────────────────────────────────

  const otherUsers = usersList.filter((u) => u.role !== "super_admin");

  // Écran de téléchargement des identifiants
  if (credentialsReady) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
          <h2 className="text-2xl font-bold">{t("credentials.title")}</h2>
          <p className="text-muted-foreground mt-1">
            {t("credentials.description", { count: createdUsers.length })}
          </p>
        </div>

        <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm text-amber-700 dark:text-amber-300 font-medium mb-3">
            {t("credentials.warning")}
          </p>
          <Button onClick={downloadCredentialsCsv} className="gap-2 w-full">
            <Download className="h-4 w-4" />
            {t("credentials.download")}
          </Button>
        </div>

        <div className="flex justify-end">
          <Button onClick={onNext} className="gap-2">
            <ArrowRight className="h-4 w-4" />
            {t("credentials.continue")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <Users className="h-12 w-12 text-primary mx-auto mb-3" />
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("description")}
        </p>
      </div>

      {/* ── Section 1 : Super Admin ─────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Shield className="h-4 w-4 text-red-500" />
          <h3 className="font-medium">{t("superAdminSection")}</h3>
          <span className="text-xs text-muted-foreground">{t("superAdminRequired")}</span>
        </div>

        {adminDone ? (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{usersList.find((u) => u.role === "super_admin")?.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {usersList.find((u) => u.role === "super_admin")?.email}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const admin = usersList.find((u) => u.role === "super_admin");
                if (admin) {
                  setAdminName(admin.name);
                  setAdminEmail(admin.email);
                  setAdminPassword(admin.password);
                }
                setAdminDone(false);
              }}
              className="text-muted-foreground"
            >
              {t("modify")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/30">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="admin-name">{t("fields.fullName")}</Label>
                <Input
                  id="admin-name"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder={t("placeholders.adminName")}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-email">{t("fields.email")}</Label>
                <Input
                  id="admin-email"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder={t("placeholders.adminEmail")}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="admin-password">{t("fields.password")}</Label>
                <Input
                  id="admin-password"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder={t("placeholders.password")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-password-confirm">{t("fields.passwordConfirm")}</Label>
                <Input
                  id="admin-password-confirm"
                  type="password"
                  value={adminPasswordConfirm}
                  onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                  placeholder={t("placeholders.passwordRepeat")}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleAdminConfirm}
                disabled={!adminName.trim() || !adminEmail.trim() || !adminPassword.trim() || !adminPasswordConfirm.trim()}
              >
                {t("validateSuperAdmin")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ── Section 2 : Ajouter d'autres utilisateurs ──────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <UserPlus className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">{t("addUsersSection")}</h3>
          <span className="text-xs text-muted-foreground">{t("addUsersOptional")}</span>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {[
            { id: "manual" as const, label: t("tabs.manual"), icon: UserPlus },
            { id: "csv" as const, label: t("tabs.csv"), icon: Upload },
            { id: "ldap" as const, label: t("tabs.ldap"), icon: Network },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab: Manuel */}
        {activeTab === "manual" && (
          <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/30">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="manual-name">{t("fields.fullName")}</Label>
                <Input
                  id="manual-name"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder={t("placeholders.manualName")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-email">{t("fields.email")}</Label>
                <Input
                  id="manual-email"
                  type="email"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder={t("placeholders.manualEmail")}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="manual-role">{t("fields.role")}</Label>
                <select
                  id="manual-role"
                  value={manualRole}
                  onChange={(e) => setManualRole(e.target.value as "admin" | "editor" | "viewer")}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-team">{t("fields.team")}</Label>
                <Input
                  id="manual-team"
                  value={manualTeam}
                  onChange={(e) => setManualTeam(e.target.value)}
                  placeholder={t("placeholders.team")}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("autoPassword")}
            </p>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={handleManualAdd}
                disabled={!manualName.trim() || !manualEmail.trim()}
                className="gap-1.5"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {t("add")}
              </Button>
            </div>
          </div>
        )}

        {/* Tab: CSV */}
        {activeTab === "csv" && (
          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {t("csvColumns")}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadCsvTemplate}
                className="gap-1.5 shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                {t("csvTemplate")}
              </Button>
            </div>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed border-border cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {csvFileName
                  ? t("csvFile", { name: csvFileName })
                  : t("csvDropzone")}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCsvFile(file);
                }}
              />
            </div>

            {/* CSV Errors */}
            {csvErrors.length > 0 && (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">
                    {t("csvValidationErrors", { count: csvErrors.length })}
                  </p>
                </div>
                <ul className="text-xs text-red-600 dark:text-red-400 space-y-0.5 ml-6">
                  {csvErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* CSV Preview */}
            {csvPreview.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  {t("csvDetected", { count: csvPreview.length })}
                </p>
                <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{t("table.name")}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{t("table.email")}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{t("table.role")}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{t("table.team")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreview.map((u, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5">{u.name}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{u.email}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE_COLORS[u.role] || ROLE_BADGE_COLORS.viewer}`}>
                              {ROLE_LABELS[u.role] || u.role}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{u.team || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCsvPreview([]);
                      setCsvErrors([]);
                      setCsvFileName("");
                    }}
                  >
                    {t("cancel")}
                  </Button>
                  <Button size="sm" onClick={handleCsvImport} className="gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" />
                    {t("csvImport", { count: csvPreview.length })}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab: LDAP */}
        {activeTab === "ldap" && (
          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
            <p className="text-sm text-muted-foreground">
              {t("ldapDescription")}
            </p>

            {ldapSaved ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    {t("ldapSaved")}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-500">
                    {t("ldapServer", { url: ldapUrl })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLdapSaved(false)}
                  className="text-muted-foreground"
                >
                  {t("modify")}
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ldap-url">{t("ldapUrl")}</Label>
                    <Input
                      id="ldap-url"
                      value={ldapUrl}
                      onChange={(e) => setLdapUrl(e.target.value)}
                      placeholder="ldaps://ldap.example.com:636"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ldap-bind-dn">{t("ldapBindDn")}</Label>
                      <Input
                        id="ldap-bind-dn"
                        value={ldapBindDn}
                        onChange={(e) => setLdapBindDn(e.target.value)}
                        placeholder="cn=admin,dc=example,dc=com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ldap-bind-pwd">{t("ldapBindPassword")}</Label>
                      <Input
                        id="ldap-bind-pwd"
                        type="password"
                        value={ldapBindPassword}
                        onChange={(e) => setLdapBindPassword(e.target.value)}
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ldap-base-dn">{t("ldapBaseDn")}</Label>
                      <Input
                        id="ldap-base-dn"
                        value={ldapBaseDn}
                        onChange={(e) => setLdapBaseDn(e.target.value)}
                        placeholder="dc=example,dc=com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ldap-filter">{t("ldapFilter")}</Label>
                      <Input
                        id="ldap-filter"
                        value={ldapSearchFilter}
                        onChange={(e) => setLdapSearchFilter(e.target.value)}
                        placeholder="(mail={{email}})"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ldap-name-attr">{t("ldapNameAttr")}</Label>
                      <Input
                        id="ldap-name-attr"
                        value={ldapNameAttr}
                        onChange={(e) => setLdapNameAttr(e.target.value)}
                        placeholder="cn"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ldap-email-attr">{t("ldapEmailAttr")}</Label>
                      <Input
                        id="ldap-email-attr"
                        value={ldapEmailAttr}
                        onChange={(e) => setLdapEmailAttr(e.target.value)}
                        placeholder="mail"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setLdapRejectUnauthorized(!ldapRejectUnauthorized)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        ldapRejectUnauthorized ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          ldapRejectUnauthorized ? "translate-x-4.5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <span className="text-sm text-muted-foreground">
                      {t("ldapVerifyTls")}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleLdapSave}
                    disabled={ldapSaving || !ldapUrl.trim() || !ldapBaseDn.trim()}
                    className="gap-1.5"
                  >
                    {ldapSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Network className="h-3.5 w-3.5" />
                    )}
                    {t("ldapSave")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Section 3: Added users list ──────────────────────── */}
      {otherUsers.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium">
              {t("addedUsersSection")}
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                ({otherUsers.length})
              </span>
            </h3>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{t("table.name")}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{t("table.email")}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{t("table.role")}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{t("table.team")}</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {otherUsers.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{u.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE_COLORS[u.role] || ROLE_BADGE_COLORS.viewer}`}>
                        <Shield className="h-2.5 w-2.5" />
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{u.team || "—"}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => removeUser(u.id)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={t("removeUserAria")}
                        title={t("removeUserAria")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Error ───────────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400 whitespace-pre-line">{error}</p>
        </div>
      )}

      {/* ── Submit ──────────────────────────────────────────── */}
      <div className="flex justify-between">
        {onBack && (
          <Button variant="ghost" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t("previous")}
          </Button>
        )}
        <div className="ml-auto">
          <Button
            onClick={handleNext}
            disabled={saving || !adminDone}
            className="gap-2"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {t("next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
