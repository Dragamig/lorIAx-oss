"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Trash2, ImagePlus, ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { FONT_GROUPS } from "@/components/editor/extensions/design-constants";
import { mediaIdFromUrl, useMediaPresence } from "@/components/media/use-media-presence";
import { MediaPicker } from "@/components/media/picker/media-picker";
import type { PickedMedia } from "@/components/media/picker/types";
import type { BrandKitData } from "@/lib/studio/brand-kit-schema";

const MAX_LOGOS = 8;

const ALL_FONTS = FONT_GROUPS.flatMap((g) => g.fonts);

export function BrandKitEditor() {
  const [kit, setKit] = useState<BrandKitData | null>(null);
  const kitRef = useRef<BrandKitData | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Espace d'organisation (lisible de tous les membres) qui héberge les logos :
  // un média sans espace ou d'un espace restreint donnerait un 404 aux autres membres.
  const [orgSpaceId, setOrgSpaceId] = useState<string | null | undefined>(undefined);
  const t = useTranslations("brandKit");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [kitRes, orgRes, spacesRes] = await Promise.all([
          fetch("/api/studio/brand-kit"),
          fetch("/api/org/current"),
          fetch("/api/spaces"),
        ]);
        if (cancelled) return;
        if (spacesRes.ok) {
          const list = (await spacesRes.json()) as { id: string; type: string; classification: string }[];
          const orgSpace = Array.isArray(list)
            ? list.find((sp) => sp.type === "organization" && sp.classification !== "secret")
            : undefined;
          if (!cancelled) setOrgSpaceId(orgSpace?.id ?? null);
        } else if (!cancelled) setOrgSpaceId(null);
        if (kitRes.ok) { const data = await kitRes.json(); kitRef.current = data; setKit(data); }
        else setError("Chargement impossible.");
        if (orgRes.ok) {
          const data = await orgRes.json();
          // role null = super_admin global (non membre) → autorisé côté API
          if (!cancelled) setCanEdit(data?.role === "owner" || data?.role === "admin" || data?.role == null);
        }
      } catch {
        if (!cancelled) setError("Chargement impossible.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (updater: (prev: BrandKitData) => BrandKitData): Promise<boolean> => {
    const prev = kitRef.current;
    if (!prev) return false;
    const next = updater(prev);
    kitRef.current = next;
    setKit(next);
    setSaving(true);
    setError(null);
    let ok = false;
    try {
      const res = await fetch("/api/studio/brand-kit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      ok = res.ok;
      if (!res.ok) setError("Enregistrement impossible (droits insuffisants ?)");
    } catch {
      setError("Enregistrement impossible (droits insuffisants ?)");
    } finally {
      setSaving(false);
    }
    return ok;
  }, []);

  const addLogos = useCallback(
    async (items: PickedMedia[]) => {
      const current = kitRef.current;
      if (!current || items.length === 0) return;
      const free = MAX_LOGOS - current.logos.length;
      const existing = new Set(current.logos.map((l) => l.url));
      const added = items
        .map((m) => ({ url: `/api/media/${m.id}`, name: (m.title || m.filename).slice(0, 100) }))
        .filter((l) => !existing.has(l.url))
        .slice(0, Math.max(free, 0));
      if (added.length === 0) {
        toast.error(t("limitReached"));
        return;
      }
      const ok = await save((prev) => ({ ...prev, logos: [...prev.logos, ...added].slice(0, MAX_LOGOS) }));
      if (!ok) {
        toast.error(t("saveFailed"));
        return;
      }
      const urls = new Set(added.map((l) => l.url));
      toast.success(added.length === 1 ? t("logoAdded") : t("logosAdded", { count: added.length }), {
        action: {
          label: t("undo"),
          onClick: () => void save((prev) => ({ ...prev, logos: prev.logos.filter((l) => !urls.has(l.url)) })),
        },
      });
    },
    [save, t]
  );

  const removeLogo = useCallback(
    async (index: number) => {
      const removed = kitRef.current?.logos[index];
      if (!removed) return;
      const ok = await save((prev) => ({ ...prev, logos: prev.logos.filter((_, j) => j !== index) }));
      if (!ok) return;
      toast.success(t("logoRemoved"), {
        action: {
          label: t("undo"),
          onClick: () =>
            void save((prev) =>
              prev.logos.some((l) => l.url === removed.url) || prev.logos.length >= MAX_LOGOS
                ? prev
                : { ...prev, logos: [...prev.logos, removed] }
            ),
        },
      });
    },
    [save, t]
  );

  if (error && !kit) return <p className="text-sm text-destructive">{error}</p>;
  if (!kit) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-8">
      {/* Couleurs */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Couleurs de marque ({kit.colors.length}/12)</h3>
        <div className="flex flex-wrap gap-2">
          {kit.colors.map((color, i) => (
            <div key={`${color}-${i}`} className="group relative">
              <input
                type="color"
                value={color}
                disabled={!canEdit}
                onChange={(e) => {
                  const value = e.target.value;
                  void save((prev) => {
                    const colors = [...prev.colors];
                    colors[i] = value;
                    return { ...prev, colors };
                  });
                }}
                className="h-10 w-10 cursor-pointer rounded border"
                title={color}
              />
              {canEdit && (
                <button
                  onClick={() => void save((prev) => ({ ...prev, colors: prev.colors.filter((_, j) => j !== i) }))}
                  className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-destructive p-0.5 text-white group-hover:block"
                  title="Retirer"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {canEdit && kit.colors.length < 12 && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => void save((prev) => ({ ...prev, colors: [...prev.colors, "#7c3aed"] }))}
              title="Ajouter une couleur"
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
      </section>

      {/* Logos */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Logos ({kit.logos.length}/{MAX_LOGOS})</h3>
        <div className="flex flex-wrap gap-3">
          {kit.logos.map((logo, i) => (
            <div key={`${logo.url}-${i}`} className="group relative rounded border p-2">
              <LogoImage url={logo.url} name={logo.name} missingLabel={t("logoMissing")} />
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void removeLogo(i)}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-1 text-white opacity-0 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 group-hover:opacity-100"
                  title={t("remove")}
                  aria-label={t("remove")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <Hint
              label={
                kit.logos.length >= MAX_LOGOS
                  ? t("limitReached")
                  : orgSpaceId === null
                    ? t("noOrgSpace")
                    : t("chooseLogoHint")
              }
              disabled={kit.logos.length >= MAX_LOGOS || !orgSpaceId}
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => setPickerOpen(true)}
                disabled={kit.logos.length >= MAX_LOGOS || !orgSpaceId}
                aria-label={t("chooseLogoHint")}
              >
                <ImagePlus className="mr-2 h-4 w-4" /> {t("chooseLogo")}
              </Button>
            </Hint>
          )}
        </div>
      </section>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        accept={["image"]}
        mode="multiple"
        max={Math.max(MAX_LOGOS - kit.logos.length, 1)}
        tabs={["library", "upload"]}
        spaceId={orgSpaceId ?? undefined}
        title={t("pickerTitle")}
        onPick={(items) => addLogos(items)}
      />

      {/* Polices */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Polices</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(
            [
              { key: "fontHeading", label: "Police des titres" },
              { key: "fontBody", label: "Police du corps" },
            ] as const
          ).map(({ key, label }) => (
            <label key={key} className="space-y-1 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <select
                value={kit[key] ?? ""}
                disabled={!canEdit}
                onChange={(e) => { const v = e.target.value; void save((prev) => ({ ...prev, [key]: v || null })); }}
                className="w-full rounded-md border bg-background px-3 py-2"
              >
                <option value="">— Aucune —</option>
                {ALL_FONTS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <div className="text-xs text-muted-foreground">
        {saving ? "Enregistrement…" : error ?? (canEdit ? "Modifications enregistrées automatiquement." : "Lecture seule — réservé aux administrateurs.")}
      </div>
    </div>
  );
}

/** Logo du kit : un média à la corbeille ou disparu s'affiche « manquant ». */
function LogoImage({ url, name, missingLabel }: { url: string; name: string; missingLabel: string }) {
  const { missing } = useMediaPresence(mediaIdFromUrl(url));
  if (missing) {
    return (
      <div
        role="img"
        aria-label={`${missingLabel} : ${name}`}
        data-media-missing="true"
        className="flex h-16 w-24 flex-col items-center justify-center rounded border border-dashed border-border bg-muted text-muted-foreground"
      >
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name} className="h-16 w-24 object-contain" />;
}
