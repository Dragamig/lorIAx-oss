"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Loader2,
  User,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { EmojiPickerPopover } from "@/components/emoji-picker-popover";

// Stable preset identifiers (not translated — used as keys to derive labels from t()).
type PresetId = "hr" | "communication" | "commercial" | "catalogs" | "training" | "technical" | "knowledge";

const PRESET_IDS: PresetId[] = ["hr", "communication", "commercial", "catalogs", "training", "technical", "knowledge"];

const PRESET_ICONS: Record<PresetId, string> = {
  hr: "👥",
  communication: "📢",
  commercial: "💼",
  catalogs: "📦",
  training: "🎓",
  technical: "🔧",
  knowledge: "📚",
};

interface CreateSpaceDialogProps {
  onCreated?: () => void;
}

export function CreateSpaceDialog({ onCreated }: CreateSpaceDialogProps) {
  const t = useTranslations("shell.createSpaceDialog");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [type, setType] = useState<"personal" | "team" | "organization">("personal");
  const [selectedPresetId, setSelectedPresetId] = useState<PresetId | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Space type definitions (labels from t() so they follow the active locale).
  const spaceTypes = [
    {
      value: "personal" as const,
      label: t("spaceTypes.personal"),
      description: t("spaceTypes.personalDesc"),
      icon: User,
    },
    {
      value: "organization" as const,
      label: t("spaceTypes.organization"),
      description: t("spaceTypes.organizationDesc"),
      icon: Building2,
    },
  ];

  // Preset definitions (names and descriptions from t()).
  const spacePresets = PRESET_IDS.map((id) => ({
    id,
    name: t(`presets.${id}`),
    description: t(`presets.${id}Desc`),
    icon: PRESET_ICONS[id],
  }));

  function reset() {
    setName("");
    setDescription("");
    setIcon(null);
    setType("personal");
    setSelectedPresetId(null);
    setError("");
    setLoading(false);
  }

  async function handleCreate() {
    if (!name.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          description: description.trim() || undefined,
          icon: icon || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("toasts.createError"));
        setLoading(false);
        return;
      }

      const space = await res.json().catch(() => ({}));
      if (!space?.slug) {
        setError(t("toasts.createError"));
        setLoading(false);
        return;
      }
      toast.success(t("toasts.createSuccess"));
      setOpen(false);
      reset();
      onCreated?.();
      router.push(`/s/${space.slug}`);
    } catch {
      toast.error(t("toasts.networkError"));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="h-6 w-6" title={t("trigger")} data-tour="sidebar-new-space" />
        }
      >
        <Plus className="h-3.5 w-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="space-name">{t("nameLabel")}</Label>
            <div className="flex items-center gap-2">
              <EmojiPickerPopover
                value={icon}
                onChange={setIcon}
                size="md"
              />
              <Input
                id="space-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSelectedPresetId(null);
                }}
                placeholder={t("namePlaceholder")}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) handleCreate();
                }}
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="space-description">{t("descriptionLabel")}</Label>
            <Input
              id="space-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("typeLabel")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {spaceTypes.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => setType(st.value)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all ${
                    type === st.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <st.icon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs font-medium">{st.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Quick preset templates */}
          {type !== "personal" && (
            <div className="space-y-2">
              <Label>{t("templatesLabel")}</Label>
              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                {spacePresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setName(preset.name);
                      setDescription(preset.description);
                      setIcon(preset.icon);
                      setSelectedPresetId(preset.id);
                    }}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-sm transition-colors ${
                      selectedPresetId === preset.id
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-accent border border-transparent"
                    }`}
                  >
                    <span className="text-base">{preset.icon}</span>
                    <span className="truncate">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {loading ? t("creating") : t("createButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
