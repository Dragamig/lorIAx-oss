"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { toast } from "sonner";
import { Plus, Trash2, X, Loader2, Tag, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LabelBadge } from "@/components/labels/label-badge";
import { useCurrentUser } from "@/hooks/use-session";

interface LabelItem {
  id: string;
  name: string;
  color: string;
  spaceId: string | null;
  isGlobal: boolean;
  createdAt: string;
}

interface LabelsTabProps {
  spaceSlug: string;
}

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#6b7280",
  "#0ea5e9",
];

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

export function LabelsTab({ spaceSlug }: LabelsTabProps) {
  const t = useTranslations("space");
  const user = useCurrentUser();
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [saving, setSaving] = useState(false);

  const canManage =
    user?.globalRole === "admin" || user?.globalRole === "super_admin";

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/spaces/${spaceSlug}/labels`);
      const data = await res.json();
      const spaceLabels = Array.isArray(data)
        ? data.filter((l: LabelItem) => !l.isGlobal)
        : [];
      setLabels(spaceLabels);
    } catch {
      toast.error(t("settings.labelsSection.loadError"));
    }
    setLoading(false);
  }, [spaceSlug, t]);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  function resetForm() {
    setNewName("");
    setNewColor("#6b7280");
    setShowCreate(false);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/spaces/${spaceSlug}/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (res.ok) {
        toast.success(t("settings.toasts.labelCreated"));
        resetForm();
        fetchLabels();
      } else {
        const data = await res.json();
        toast.error(data.error || t("settings.toasts.labelCreateError"));
      }
    } catch {
      toast.error(t("settings.toasts.networkError"));
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm(t("settings.labelsSection.confirmDelete"))) return;
    try {
      const res = await fetch(`/api/spaces/${spaceSlug}/labels/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success(t("settings.toasts.labelDeleted"));
        setLabels((prev) => prev.filter((l) => l.id !== id));
      } else {
        toast.error(t("settings.toasts.labelDeleteError"));
      }
    } catch {
      toast.error(t("settings.toasts.networkError"));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("settings.labelsSection.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Note labels globaux */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-muted/40 text-sm">
        <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-muted-foreground">
          {t("settings.labelsSection.globalNote")}{" "}
          <Link
            href="/admin/labels"
            className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            {t("settings.labelsSection.manageGlobal")}
          </Link>
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">
            {t("settings.labelsSection.spaceLabelsTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("settings.labelsSection.spaceLabelsSubtitle")}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreate(true)} disabled={showCreate} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            {t("settings.labelsSection.newLabelButton")}
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="p-5 rounded-lg border border-border bg-card space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">{t("settings.labelsSection.formTitle")}</h4>
            <button
              onClick={resetForm}
              className="p-1 rounded cursor-pointer hover:bg-accent active:bg-accent/70 active:translate-y-px transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="label-name">{t("settings.labelsSection.nameLabel")}</Label>
            <Input
              id="label-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("settings.labelsSection.namePlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("settings.labelsSection.colorLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setNewColor(color)}
                  className="rounded-full transition-transform hover:scale-110"
                  style={{
                    width: 24,
                    height: 24,
                    backgroundColor: color,
                    outline:
                      newColor === color
                        ? `2px solid ${isLightColor(color) ? "#000" : "#fff"}`
                        : "2px solid transparent",
                    outlineOffset: 2,
                  }}
                  aria-label={color}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div
                className="w-6 h-6 rounded-full border border-border flex-shrink-0"
                style={{ backgroundColor: newColor }}
              />
              <Input
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                placeholder="#6b7280"
                className="font-mono w-32"
                maxLength={7}
              />
              <span className="text-sm text-muted-foreground">
                {t("settings.labelsSection.preview")}
              </span>
              {newName.trim() && (
                <LabelBadge
                  label={{ id: "preview", name: newName, color: newColor }}
                  size="md"
                />
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={resetForm}>
              {t("settings.labelsSection.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={saving || !newName.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("settings.labelsSection.create")}
            </Button>
          </div>
        </div>
      )}

      {/* Liste des labels */}
      {labels.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <Tag className="h-8 w-8 opacity-30" />
          <p className="text-sm">
            {t("settings.labelsSection.empty")}
            {canManage && ` ${t("settings.labelsSection.createHint")}`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {labels.map((label) => (
            <div
              key={label.id}
              className="flex items-center gap-4 p-4 rounded-lg border border-border hover:bg-accent/30 transition-colors"
            >
              <div
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: label.color }}
              />
              <div className="flex-1 min-w-0 flex items-center gap-3">
                <LabelBadge label={label} size="md" />
                <span className="text-xs text-muted-foreground font-mono">
                  {label.color}
                </span>
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(label.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
