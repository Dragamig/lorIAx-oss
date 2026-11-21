"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Loader2, ArrowLeft } from "lucide-react";

interface TemplateOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
}

export default function NewDocumentInSpacePage() {
  const t = useTranslations("space");
  const tNew = useTranslations("newDocument");
  const params = useParams<{ spaceSlug: string }>();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTemplates(data);
      })
      .catch(() => {});
  }, []);

  async function handleCreate() {
    if (!title.trim() || !params.spaceSlug) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/spaces/${params.spaceSlug}/documents`, {
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
        router.push(`/s/${params.spaceSlug}/${doc.id}`);
      } else {
        toast.error(doc?.error || tNew("errors.createError"));
        setLoading(false);
      }
    } catch {
      toast.error(tNew("errors.createError"));
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="max-w-2xl mx-auto px-8 pt-8 pb-4">
        <Link
          href={`/s/${params.spaceSlug}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("newDoc.backToSpace")}
        </Link>
        <h1 className="text-2xl font-bold mb-6">{t("newDoc.title")}</h1>
      </div>

      {/* Ligne titre + bouton — sticky pendant le scroll */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-2xl mx-auto px-8 py-3 flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="doc-title">{t("newDoc.titleLabel")}</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("newDoc.titlePlaceholder")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) handleCreate();
              }}
            />
          </div>
          <Button
            onClick={handleCreate}
            disabled={!title.trim() || loading}
            className="shrink-0 mb-0.5"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            {t("newDoc.createButton")}
          </Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-8 py-6">
        <div className="space-y-6">

          {templates.length > 0 && (() => {
          const categories = Array.from(new Set(templates.map((tmpl) => tmpl.category || "autre")));
          return (
            <div className="space-y-4">
              <Label>{t("newDoc.templateLabel")}</Label>
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
                    <p className="font-medium">{t("newDoc.emptyTemplateName")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("newDoc.emptyTemplateDescription")}
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
                      {t(`newDoc.categories.${cat}`, { defaultValue: cat })}
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

        </div>
      </div>
    </div>
  );
}
