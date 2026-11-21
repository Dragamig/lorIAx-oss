"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/use-session";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// API slugs (stable, never translated) — i18n-ignore
const CATEGORY_SLUGS = [
  { value: "réunion", icon: "📅" }, // i18n-ignore — API slug
  { value: "projet", icon: "🎯" },
  { value: "commercial", icon: "🤝" },
  { value: "documentation", icon: "📖" },
  { value: "savoir", icon: "💡" },
  { value: "personnel", icon: "👤" },
  { value: "résolution", icon: "🔍" }, // i18n-ignore — API slug
  { value: "rapport", icon: "📊" },
  { value: "général", icon: "📝" }, // i18n-ignore — API slug
];

interface SaveAsTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentTitle: string;
  documentContent: string;
  spaceId: string;
}

export function SaveAsTemplateDialog({
  open,
  onOpenChange,
  documentTitle,
  documentContent,
  spaceId,
}: SaveAsTemplateDialogProps) {
  const t = useTranslations("document");
  const user = useCurrentUser();
  const isAdmin =
    user?.globalRole === "admin" || user?.globalRole === "super_admin";

  const [name, setName] = useState(documentTitle);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("général"); // i18n-ignore — API slug
  const [icon, setIcon] = useState("📄");
  const [isGlobal, setIsGlobal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          content: documentContent,
          icon: (icon.trim() || "📄").slice(0, 4),
          category,
          isGlobal: isAdmin ? isGlobal : false,
          spaceId: isAdmin && isGlobal ? undefined : (spaceId?.trim() || undefined),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("saveAsTemplateDialog.toasts.createError"));
        return;
      }

      toast.success(t("saveAsTemplateDialog.toasts.created"));
      onOpenChange(false);
      setDescription("");
      setCategory("général"); // i18n-ignore — API slug
      setIcon("📄");
      setIsGlobal(false);
    } catch {
      toast.error(t("saveAsTemplateDialog.toasts.networkError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      setName(documentTitle);
      setDescription("");
      setCategory("général"); // i18n-ignore — API slug
      setIcon("📄");
      setIsGlobal(false);
    }
    onOpenChange(newOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("saveAsTemplateDialog.title")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5 w-16 flex-shrink-0">
              <Label htmlFor="template-icon">
                {t("saveAsTemplateDialog.iconLabel")}
              </Label>
              <Input
                id="template-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={4}
                className="text-center text-lg"
                placeholder="📄"
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <Label htmlFor="template-name">
                {t("saveAsTemplateDialog.nameLabel")}
              </Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("saveAsTemplateDialog.namePlaceholder")}
                required
                autoFocus
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-description">
              {t("saveAsTemplateDialog.descriptionLabel")}{" "}
              <span className="text-muted-foreground font-normal">
                {t("saveAsTemplateDialog.descriptionOptional")}
              </span>
            </Label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("saveAsTemplateDialog.descriptionPlaceholder")}
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("saveAsTemplateDialog.categoryLabel")}</Label>
            <Select value={category} onValueChange={(v) => { if (v) setCategory(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_SLUGS.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.icon}{" "}
                    {t(`saveAsTemplateDialog.categories.${cat.value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isAdmin && (
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {t("saveAsTemplateDialog.globalTemplate")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("saveAsTemplateDialog.globalTemplateHint")}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isGlobal}
                onClick={() => setIsGlobal(!isGlobal)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isGlobal ? "bg-primary" : "bg-input"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${
                    isGlobal ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("saveAsTemplateDialog.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting
                ? t("saveAsTemplateDialog.saving")
                : t("saveAsTemplateDialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
