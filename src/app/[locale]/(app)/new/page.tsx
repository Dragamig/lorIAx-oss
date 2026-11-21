"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";

interface SpaceOption {
  id: string;
  name: string;
  slug: string;
  type: string;
}

interface TemplateOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
}

export default function NewDocumentPage() {
  const t = useTranslations("newDocument");
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedTemplate = searchParams.get("template");
  const [title, setTitle] = useState("");
  const [selectedSpace, setSelectedSpace] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(preselectedTemplate);
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryLabels: Record<string, string> = {
    "réunion": t("categories.réunion"),
    "projet": t("categories.projet"),
    "commercial": t("categories.commercial"),
    "documentation": t("categories.documentation"),
    "savoir": t("categories.savoir"),
    "personnel": t("categories.personnel"),
    "résolution": t("categories.résolution"),
    "rapport": t("categories.rapport"),
    "général": t("categories.général"),
    "autre": t("categories.autre"),
  };

  useEffect(() => {
    fetch("/api/spaces")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setSpaces(data);
          // Pre-select personal space, or first space with "perso" in slug
          const personal = data.find((s: SpaceOption) => s.type === "personal" || s.slug.startsWith("perso-"));
          setSelectedSpace(personal?.slug || (data.length > 0 ? data[0].slug : ""));
        }
      });
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setTemplates(data);
          // Pre-fill title from template name if preselected.
          if (preselectedTemplate) {
            const tmpl = data.find((tmpl: TemplateOption) => tmpl.id === preselectedTemplate);
            if (tmpl) setTitle((cur) => cur || tmpl.name);
          }
        }
      });
  }, [preselectedTemplate]);

  async function handleCreate() {
    if (!title.trim() || !selectedSpace) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${selectedSpace}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          content: "",
          templateId: selectedTemplate,
        }),
      });

      const doc = await res.json().catch(() => null);
      if (res.ok && doc?.id) {
        router.push(`/s/${selectedSpace}/${doc.id}`);
      } else {
        setError(doc?.error || t("errors.createError"));
        setLoading(false);
      }
    } catch {
      setError(t("errors.networkError"));
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="max-w-2xl mx-auto px-8 pt-8 pb-4">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>

      {/* Ligne titre + bouton — sticky pendant le scroll */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-2xl mx-auto px-8 py-3 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1.5">
              {t("titleLabel")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("titlePlaceholder")}
              autoFocus
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) handleCreate();
              }}
            />
          </div>
          <Button
            onClick={handleCreate}
            disabled={!title.trim() || !selectedSpace || loading}
            className="shrink-0 mb-0.5"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            {t("createButton")}
          </Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-8 py-6">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-1.5">{t("spaceLabel")}</label>
            <select
              value={selectedSpace}
              onChange={(e) => setSelectedSpace(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {templates.length > 0 && (() => {
          const categories = Array.from(new Set(templates.map((tmpl) => tmpl.category || "autre")));
          return (
            <div className="space-y-4">
              <label className="block text-sm font-medium">
                {t("templateLabel")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-sm text-left transition-all ${
                    !selectedTemplate
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <span className="text-lg shrink-0">📄</span>
                  <div>
                    <p className="font-medium">{t("emptyTemplate")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("emptyTemplateHint")}
                    </p>
                  </div>
                </button>
              </div>
              {categories.map((cat) => {
                const catTemplates = templates.filter((tmpl) => (tmpl.category || "autre") === cat);
                if (catTemplates.length === 0) return null;
                return (
                  <div key={cat} className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {categoryLabels[cat] ?? cat}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {catTemplates.map((tmpl) => (
                        <button
                          key={tmpl.id}
                          onClick={() => setSelectedTemplate(tmpl.id)}
                          className={`flex items-center gap-3 p-3 rounded-lg border text-sm text-left transition-all ${
                            selectedTemplate === tmpl.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/30"
                          }`}
                        >
                          <span className="text-lg shrink-0">{tmpl.icon || "📝"}</span>
                          <div>
                            <p className="font-medium">{tmpl.name}</p>
                            {tmpl.description && (
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {tmpl.description}
                              </p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            {error}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
