"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { emitSidebarRefresh } from "@/lib/events/sidebar-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Loader2,
  Save,
  Trash2,
  User,
  Users,
  Building2,
  UserPlus,
  Crown,
  X,
  Shield,
  Pencil,
  Eye,
  Clock,
  Palette,
  Check,
  AlertTriangle,
  Tag,
} from "lucide-react";
import { ClassificationBadge } from "@/components/classification-badge";
import { CLASSIFICATION_CONFIG } from "@/lib/auth/classification";
import type { ClassificationLevel } from "@/types";
import { toast } from "sonner";
import { EmojiPickerPopover } from "@/components/emoji-picker-popover";
import { VizHashAvatar } from "@/components/ui/vizhash-avatar";
import { LabelsTab } from "./labels-tab";

interface SpacePresetConfig {
  name: string;
  accentColor: string;
  editorFont: string;
  editorBackground: string;
  contentWidth: string;
  fontSize: string;
  editorPaddingY?: string;
}

interface SpaceData {
  id: string;
  name: string;
  slug: string;
  type: "personal" | "team" | "organization";
  description: string | null;
  icon: string | null;
  classification: ClassificationLevel;
  appearancePreset: SpacePresetConfig | null;
  createdAt: string;
}

interface MemberData {
  id: string;
  level: "viewer" | "editor" | "admin";
  createdAt: string;
  userId: string | null;
  teamId: string | null;
  userName: string | null;
  userEmail: string | null;
  userAvatar: string | null;
  teamName: string | null;
}

interface OwnerData {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: "owner";
}

interface UserSearchResult {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

const levelIcons = {
  viewer: Eye,
  editor: Pencil,
  admin: Shield,
};

// name = slug used as API config value; display label comes from t() in JSX
const spacePresetOptions: (Omit<SpacePresetConfig, "name"> & { id: string })[] = [
  {
    id: "classique",
    accentColor: "blue",
    editorFont: "sans",
    editorBackground: "white",
    contentWidth: "normal",
    fontSize: "normal",
  },
  {
    id: "focus",
    accentColor: "green",
    editorFont: "serif",
    editorBackground: "cream",
    contentWidth: "narrow",
    fontSize: "large",
  },
  {
    id: "redaction",
    accentColor: "purple",
    editorFont: "mono",
    editorBackground: "gray",
    contentWidth: "wide",
    fontSize: "normal",
  },
  {
    id: "style",
    accentColor: "amber",
    editorFont: "garamond",
    editorBackground: "cream",
    contentWidth: "normal",
    fontSize: "normal",
  },
];

const accentPreviewColors: Record<string, string> = {
  coral: "#EB5757",
  amber: "#CB912F",
  blue: "#2F80ED",
  green: "#0F7B6C",
  purple: "#9065B0",
};

function SpaceTypeIcon({ type }: { type: SpaceData["type"] }) {
  const cls = "h-4 w-4";
  switch (type) {
    case "personal":
      return <User className={cls} />;
    case "team":
      return <Users className={cls} />;
    case "organization":
      return <Building2 className={cls} />;
  }
}

function MemberAvatar({ email }: { email: string }) {
  return <VizHashAvatar email={email} size={32} />;
}

export default function SpaceSettingsPage() {
  const t = useTranslations("space");
  const format = useFormatter();
  const params = useParams<{ spaceSlug: string }>();
  const router = useRouter();
  const [space, setSpace] = useState<SpaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  // Members
  const [owner, setOwner] = useState<OwnerData | null>(null);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [newMemberLevel, setNewMemberLevel] = useState<"viewer" | "editor" | "admin">("editor");
  const [spacePreset, setSpacePreset] = useState<SpacePresetConfig | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [classification, setClassification] = useState<ClassificationLevel>("internal");
  const [savingClassification, setSavingClassification] = useState(false);

  useEffect(() => {
    const slug = params.spaceSlug;
    if (!slug) return;

    fetch(`/api/spaces/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.id) {
          setSpace(data);
          setName(data.name);
          setDescription(data.description || "");
          setIcon(data.icon || null);
          setSpacePreset(data.appearancePreset || null);
          setClassification(data.classification || "internal");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.spaceSlug]);

  const loadMembers = useCallback(async () => {
    if (!params.spaceSlug) return;
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/spaces/${params.spaceSlug}/members`);
      if (res.ok) {
        const data = await res.json();
        setOwner(data.owner);
        setMembers(data.members);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMembers(false);
    }
  }, [params.spaceSlug]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // Recherche utilisateurs
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}&limit=5`);
        if (res.ok) {
          const data = await res.json();
          // Exclure les membres existants
          const existingUserIds = new Set(members.map((m) => m.userId).filter(Boolean));
          if (owner) existingUserIds.add(owner.id);
          setSearchResults(data.filter((u: UserSearchResult) => !existingUserIds.has(u.id)));
        }
      } catch {
        // ignore
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery, members, owner]);

  async function handleSave() {
    if (!space || !name.trim()) return;
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch(`/api/spaces/${space.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          icon: icon || "",
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setSpace(updated);
        setMessage(t("settings.generalInfo.saved"));
        setTimeout(() => setMessage(""), 3000);
        // Refléter le nouveau titre / emoji dans la sidebar sans F5
        emitSidebarRefresh();
      } else {
        const data = await res.json();
        setMessage(data.error || t("settings.generalInfo.networkError"));
      }
    } catch {
      setMessage(t("settings.generalInfo.networkError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMember(userId: string) {
    if (!space) return;

    try {
      const res = await fetch(`/api/spaces/${space.slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, level: newMemberLevel }),
      });

      if (res.ok) {
        toast.success(t("settings.toasts.memberAdded"));
        setSearchQuery("");
        setSearchResults([]);
        loadMembers();
      } else {
        const data = await res.json();
        toast.error(data.error || t("settings.toasts.error"));
      }
    } catch {
      toast.error(t("settings.toasts.networkError"));
    }
  }

  async function handleUpdateLevel(permissionId: string, level: "viewer" | "editor" | "admin") {
    if (!space) return;

    try {
      const res = await fetch(`/api/spaces/${space.slug}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionId, level }),
      });

      if (res.ok) {
        setMembers((prev) =>
          prev.map((m) => (m.id === permissionId ? { ...m, level } : m))
        );
        toast.success(t("settings.toasts.permissionUpdated"));
      }
    } catch {
      toast.error(t("settings.toasts.networkError"));
    }
  }

  async function handleRemoveMember(permissionId: string) {
    if (!space) return;

    try {
      const res = await fetch(
        `/api/spaces/${space.slug}/members?permissionId=${permissionId}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.id !== permissionId));
        toast.success(t("settings.toasts.memberRemoved"));
      }
    } catch {
      toast.error(t("settings.toasts.networkError"));
    }
  }

  async function handleDelete() {
    if (!space) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/spaces/${space.slug}`, { method: "DELETE" });
      if (res.ok) {
        emitSidebarRefresh();
        router.push("/");
      } else {
        const data = await res.json();
        setMessage(data.error || t("settings.toasts.error"));
        setDeleting(false);
      }
    } catch {
      setMessage(t("settings.toasts.networkError"));
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">{t("settings.loading")}</div>
      </div>
    );
  }

  if (!space) {
    return (
      <div className="max-w-2xl mx-auto px-8 py-12 text-center">
        <h1 className="text-xl font-bold mb-2">{t("settings.notFoundTitle")}</h1>
        <Button onClick={() => router.push("/")}>{t("notFound.backHome")}</Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-8 py-12">
      <div className="mb-8">
        <Link
          href={`/s/${space.slug}`}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("settings.backToSpace")}
        </Link>
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      </div>

      {/* General info */}
      <section className="space-y-6 mb-10">
        <h2 className="text-lg font-semibold border-b border-border pb-2">
          {t("settings.generalInfo.title")}
        </h2>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="space-name">{t("settings.generalInfo.nameLabel")}</Label>
            <div className="flex items-center gap-2">
              <EmojiPickerPopover
                value={icon}
                onChange={setIcon}
                size="md"
              />
              <Input
                id="space-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="space-desc">{t("settings.generalInfo.descriptionLabel")}</Label>
            <Input
              id="space-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("settings.generalInfo.descriptionPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("settings.generalInfo.typeLabel")}</Label>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <SpaceTypeIcon type={space.type} />
              {t(`settings.types.${space.type}`)}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("settings.generalInfo.slugLabel")}</Label>
            <p className="text-sm text-muted-foreground font-mono">
              {space.slug}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t("settings.generalInfo.createdAtLabel")}</Label>
            <p className="text-sm text-muted-foreground">
              {format.dateTime(new Date(space.createdAt), {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {t("settings.generalInfo.save")}
          </Button>
          {message && (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}
        </div>
      </section>

      {/* Partage et membres — style Google Workspace */}
      {space.type !== "personal" && (
        <section className="space-y-6 mb-10">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h2 className="text-lg font-semibold">{t("settings.access.title")}</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddMember(!showAddMember)}
            >
              <UserPlus className="h-4 w-4 mr-2" />
              {t("settings.access.addButton")}
            </Button>
          </div>

          {/* Formulaire d'ajout */}
          {showAddMember && (
            <div className="p-4 rounded-lg border border-border bg-card space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder={t("settings.access.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1"
                />
                <select
                  value={newMemberLevel}
                  onChange={(e) => setNewMemberLevel(e.target.value as "viewer" | "editor" | "admin")}
                  className="px-3 py-2 rounded-md border border-input bg-background text-sm"
                >
                  <option value="viewer">{t("settings.access.levels.viewer")}</option>
                  <option value="editor">{t("settings.access.levels.editor")}</option>
                  <option value="admin">{t("settings.access.levels.admin")}</option>
                </select>
              </div>

              {searching && (
                <p className="text-xs text-muted-foreground">{t("settings.access.searching")}</p>
              )}

              {searchResults.length > 0 && (
                <div className="space-y-1">
                  {searchResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => handleAddMember(u.id)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent transition-colors text-left"
                    >
                      <MemberAvatar email={u.email || u.name} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {u.email}
                        </p>
                      </div>
                      <UserPlus className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}

              {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("settings.access.noUserFound")}
                </p>
              )}
            </div>
          )}

          {/* Liste des membres */}
          <div className="space-y-1">
            {/* Owner */}
            {owner && (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-accent/30">
                <MemberAvatar email={owner.email} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{owner.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {owner.email}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
                  <Crown className="h-3.5 w-3.5" />
                  {t("settings.access.owner")}
                </div>
              </div>
            )}

            {/* Membres avec permissions */}
            {loadingMembers ? (
              <div className="py-4 text-center text-sm text-muted-foreground animate-pulse">
                {t("settings.access.loadingMembers")}
              </div>
            ) : members.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t("settings.access.noMembers")}
              </p>
            ) : (
              members.map((member) => {
                const _LevelIcon = levelIcons[member.level];
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-accent/50 transition-colors group"
                  >
                    <MemberAvatar email={member.userEmail || member.teamName || "?"} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {member.teamId ? (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {member.teamName}
                          </span>
                        ) : (
                          member.userName
                        )}
                      </p>
                      {member.userEmail && (
                        <p className="text-xs text-muted-foreground truncate">
                          {member.userEmail}
                        </p>
                      )}
                    </div>
                    <select
                      value={member.level}
                      onChange={(e) =>
                        handleUpdateLevel(member.id, e.target.value as "viewer" | "editor" | "admin")
                      }
                      className="px-2 py-1 rounded border border-input bg-background text-xs"
                    >
                      <option value="viewer">{t("settings.access.levels.viewer")}</option>
                      <option value="editor">{t("settings.access.levels.editor")}</option>
                      <option value="admin">{t("settings.access.levels.admin")}</option>
                    </select>
                    <button
                      onClick={() => handleRemoveMember(member.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                      title={t("settings.access.removeAccessAria")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Access level descriptions */}
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
            <p className="flex items-center gap-1.5">
              <Eye className="h-3 w-3" /> <strong>{t("settings.access.levels.viewer")}</strong> — {t("settings.access.levelDescriptions.viewer")}
            </p>
            <p className="flex items-center gap-1.5">
              <Pencil className="h-3 w-3" /> <strong>{t("settings.access.levels.editor")}</strong> — {t("settings.access.levelDescriptions.editor")}
            </p>
            <p className="flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> <strong>{t("settings.access.levels.admin")}</strong> — {t("settings.access.levelDescriptions.admin")}
            </p>
          </div>
        </section>
      )}

      {/* Activity */}
      <section className="mb-10">
        <Link
          href={`/s/${space.slug}/activity`}
          className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:bg-accent/30 transition-colors"
        >
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{t("settings.activityLink.title")}</p>
            <p className="text-xs text-muted-foreground">
              {t("settings.activityLink.subtitle")}
            </p>
          </div>
        </Link>
      </section>

      {/* Security classification */}
      <section className="space-y-4 mb-10">
        <h2 className="text-lg font-semibold border-b border-border pb-2 flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          {t("settings.classification.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.classification.description")}
        </p>

        <div className="grid grid-cols-2 gap-3">
          {(Object.values(CLASSIFICATION_CONFIG) as typeof CLASSIFICATION_CONFIG[ClassificationLevel][]).map((config) => {
            const isActive = classification === config.value;
            const isLowering = CLASSIFICATION_CONFIG[classification] &&
              config.level < CLASSIFICATION_CONFIG[classification].level;
            return (
              <button
                key={config.value}
                onClick={async () => {
                  if (isActive || !space) return;
                  setSavingClassification(true);
                  try {
                    const res = await fetch(`/api/spaces/${space.slug}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ classification: config.value }),
                    });
                    if (res.ok) {
                      setClassification(config.value);
                      toast.success(t("settings.toasts.classificationUpdated", { label: config.label }));
                    }
                  } catch {
                    toast.error(t("settings.toasts.error"));
                  }
                  setSavingClassification(false);
                }}
                disabled={savingClassification}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg border-2 transition-all text-left ${
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30"
                }`}
              >
                <div className="flex items-center gap-2 w-full">
                  <ClassificationBadge classification={config.value} size="sm" />
                  {isActive && (
                    <Check className="h-3.5 w-3.5 text-primary ml-auto shrink-0" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {config.description}
                </p>
                {isLowering && !isActive && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {t("settings.classification.lowering")}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Default appearance */}
      <section className="space-y-4 mb-10">
        <h2 className="text-lg font-semibold border-b border-border pb-2 flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          {t("settings.appearance.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.appearance.description")}
        </p>

        <div className="grid grid-cols-3 gap-3">
          {/* Option "Aucun" */}
          <button
            onClick={async () => {
              setSavingPreset(true);
              try {
                const res = await fetch(`/api/spaces/${space.slug}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ appearancePreset: null }),
                });
                if (res.ok) {
                  setSpacePreset(null);
                  toast.success(t("settings.toasts.presetRemoved"));
                }
              } catch {
                toast.error(t("settings.toasts.error"));
              }
              setSavingPreset(false);
            }}
            disabled={savingPreset}
            className={`flex flex-col items-start gap-2 p-4 rounded-lg border-2 transition-all text-left ${
              !spacePreset
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/30"
            }`}
          >
            <div className="flex items-center gap-2 w-full">
              <div className="w-3 h-3 rounded-full bg-muted shrink-0" />
              <span className="text-sm font-medium">{t("settings.appearance.noPreset")}</span>
              {!spacePreset && (
                <Check className="h-3.5 w-3.5 text-primary ml-auto shrink-0" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.appearance.noPresetDescription")}
            </p>
          </button>

          {/* Presets */}
          {spacePresetOptions.map((preset) => {
            const active =
              spacePreset?.accentColor === preset.accentColor &&
              spacePreset?.editorFont === preset.editorFont &&
              spacePreset?.editorBackground === preset.editorBackground;
            return (
              <button
                key={preset.id}
                onClick={async () => {
                  setSavingPreset(true);
                  const config: SpacePresetConfig = {
                    name: preset.id,
                    accentColor: preset.accentColor,
                    editorFont: preset.editorFont,
                    editorBackground: preset.editorBackground,
                    contentWidth: preset.contentWidth,
                    fontSize: preset.fontSize,
                    editorPaddingY: preset.editorPaddingY ?? "normal",
                  };
                  try {
                    const res = await fetch(`/api/spaces/${space.slug}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ appearancePreset: config }),
                    });
                    if (res.ok) {
                      setSpacePreset(config);
                      toast.success(t("settings.toasts.presetApplied", { name: t(`settings.appearance.presets.${preset.id}.name`) }));
                    }
                  } catch {
                    toast.error(t("settings.toasts.error"));
                  }
                  setSavingPreset(false);
                }}
                disabled={savingPreset}
                className={`flex flex-col items-start gap-2 p-4 rounded-lg border-2 transition-all text-left ${
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30"
                }`}
              >
                <div className="flex items-center gap-2 w-full">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{
                      backgroundColor:
                        accentPreviewColors[preset.accentColor] || "#888",
                    }}
                  />
                  <span className="text-sm font-medium">{t(`settings.appearance.presets.${preset.id}.name`)}</span>
                  {active && (
                    <Check className="h-3.5 w-3.5 text-primary ml-auto shrink-0" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(`settings.appearance.presets.${preset.id}.description`)}
                </p>
              </button>
            );
          })}
        </div>

        {/* Espacement vertical */}
        {spacePreset && (
          <div className="mt-4">
            <p className="text-sm font-medium mb-2">{t("settings.appearance.paddingTitle")}</p>
            <div className="flex gap-2">
              {(["compact", "normal", "spacious"] as const).map((val) => {
                const active = (spacePreset.editorPaddingY ?? "normal") === val;
                return (
                  <button
                    key={val}
                    disabled={savingPreset}
                    onClick={async () => {
                      setSavingPreset(true);
                      const config = { ...spacePreset, editorPaddingY: val };
                      try {
                        const res = await fetch(`/api/spaces/${space.slug}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ appearancePreset: config }),
                        });
                        if (res.ok) {
                          setSpacePreset(config);
                          toast.success(t("settings.toasts.paddingUpdated"));
                        }
                      } catch {
                        toast.error(t("settings.toasts.error"));
                      }
                      setSavingPreset(false);
                    }}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-all ${
                      active
                        ? "border-primary bg-primary/5 text-primary font-medium"
                        : "border-border hover:border-primary/30 text-muted-foreground"
                    }`}
                  >
                    {t(`settings.appearance.padding.${val}`)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Labels de l'espace */}
      <section className="space-y-4 mb-10">
        <h2 className="text-lg font-semibold border-b border-border pb-2 flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          {t("settings.labelsTitle")}
        </h2>
        <LabelsTab spaceSlug={space.slug} />
      </section>

      {/* Zone danger */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-destructive border-b border-destructive/20 pb-2">
          {t("settings.danger.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.danger.description")}
        </p>

        {!confirmDelete ? (
          <Button
            variant="outline"
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t("settings.danger.deleteButton")}
          </Button>
        ) : (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
            <p className="text-sm flex-1">
              {t("settings.danger.confirmText", { name: space.name })}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              {t("settings.danger.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("settings.danger.confirm")}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
