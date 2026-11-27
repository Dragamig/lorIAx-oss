"use client";

import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { UsageEntry } from "@/lib/media/usage-links";
import { ActionButton } from "../../action-button";
import { canEncodeWebp, type ExportFormat } from "../render";
import { saveErrorKey, saveRetouched, type SaveMode, type SaveOutcome } from "../save-flow";
import { notifySaveOutcome } from "../save-toasts";

export interface SavePanelMedia {
  id: string;
  filename: string;
  mimeType: string;
  spaceId: string | null;
  folderId: string | null;
  currentVersion: number;
  /** Le fichier d'origine porte une position GPS (EXIF) : conservée dans la copie. */
  hasLocation?: boolean;
}

export interface SavePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  media: SavePanelMedia;
  /** Droit d'écriture sur l'original : condition de la nouvelle version. */
  canWriteOriginal: boolean;
  /** Espaces où l'utilisateur peut écrire (vide : lecture seule, rien à enregistrer). */
  spaces: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  /** Autorise « Hors espace » comme destination. */
  allowNoSpace?: boolean;
  getBlob: (format: ExportFormat, quality: number) => Promise<Blob>;
  userId?: string;
  onSaved: (outcome: Exclude<SaveOutcome, { kind: "error" }>) => void;
  /** Appelé quand « Annuler » d'un toast d'enregistrement a réussi (rafraîchit la médiathèque). */
  onUndone?: () => void;
  /** Injection pour les tests. */
  save?: typeof saveRetouched;
}

type Usages = { entries: UsageEntry[]; hiddenCount: number };
type UsageState = { status: "idle" | "loading" | "error" } | { status: "ok"; data: Usages };

const NONE = "__none__";
const FIELD =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function stemOf(filename: string): string {
  return filename.replace(/\.[^./]+$/, "");
}

/** Boîte d'enregistrement : dérivé par défaut, nouvelle version en option après lecture des usages. */
export function SavePanel({
  open,
  onOpenChange,
  media,
  canWriteOriginal,
  spaces,
  folders,
  allowNoSpace = false,
  getBlob,
  userId,
  onSaved,
  onUndone,
  save = saveRetouched,
}: SavePanelProps) {
  const t = useTranslations("library.retouch");
  const tUsage = useTranslations("library.usage");
  const locale = useLocale();
  const ids = useId();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<ExportFormat>(media.mimeType === "image/jpeg" ? "jpeg" : "png");
  const [quality, setQuality] = useState(90);
  const [asVersion, setAsVersion] = useState(false);
  const [spaceId, setSpaceId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usages, setUsages] = useState<UsageState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [webpOk, setWebpOk] = useState(true);

  useEffect(() => {
    setWebpOk(canEncodeWebp());
  }, []);

  useEffect(() => {
    if (!open) return;
    setName(t("save.defaultName", { name: stemOf(media.filename) }));
    setAsVersion(false);
    setError(null);
    setBusy(false);
    setQuality(90);
    const own = spaces.find((s) => s.id === media.spaceId);
    setSpaceId(own ? own.id : (spaces[0]?.id ?? (allowNoSpace ? NONE : "")));
    setFolderId(own && media.folderId ? media.folderId : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, media.id]);

  // La liste « Utilisé dans » est chargée avant tout enregistrement en nouvelle version.
  useEffect(() => {
    if (!open || !asVersion) return;
    const ac = new AbortController();
    setUsages({ status: "loading" });
    fetch(`/api/media/${media.id}/usages`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setUsages({ status: "ok", data: (await res.json()) as Usages });
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setUsages({ status: "error" });
        void e;
      });
    return () => ac.abort();
  }, [open, asVersion, media.id, attempt]);

  const mode: SaveMode = asVersion ? "version" : "derived";
  const noTarget = spaces.length === 0 && !allowNoSpace;
  const usagesReady = !asVersion || usages.status === "ok";
  const disabledReason = busy
    ? t("save.busy")
    : name.trim() === ""
      ? t("save.nameRequired")
      : noTarget && !asVersion
        ? t("save.readOnly")
        : !spaceId && !asVersion
          ? t("save.spaceRequired")
          : asVersion && usages.status === "loading"
            ? t("save.usagesLoading")
            : asVersion && usages.status === "error"
              ? t("save.usagesFailed")
              : !usagesReady
                ? t("save.usagesLoading")
                : undefined;

  const submit = async () => {
    if (disabledReason) return;
    setBusy(true);
    setError(null);
    const outcome = await save({
      sourceId: media.id,
      mode,
      name,
      spaceId: asVersion ? media.spaceId : spaceId === NONE ? null : spaceId,
      folderId: asVersion ? null : folderId || null,
      format,
      quality,
      expectedVersion: media.currentVersion,
      getBlob,
      userId,
    });
    setBusy(false);
    notifySaveOutcome(outcome, t, { onUndone });
    if (outcome.kind === "error") {
      setError(t(`save.${saveErrorKey(outcome.status)}`));
      return;
    }
    onOpenChange(false);
    onSaved(outcome);
  };

  const count = usages.status === "ok" ? usages.data.entries.length + usages.data.hiddenCount : 0;
  const versionReason = canWriteOriginal ? undefined : t("save.versionNoWrite");
  const lossy = format !== "png";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" aria-busy={busy}>
        <DialogHeader>
          <DialogTitle>{t("save.title")}</DialogTitle>
          <DialogDescription>{asVersion ? t("save.introVersion") : t("save.introDerived")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-name`}>{t("save.nameLabel")}</Label>
            <input id={`${ids}-name`} className={FIELD} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-format`}>{t("save.formatLabel")}</Label>
              <select id={`${ids}-format`} className={FIELD} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp" disabled={!webpOk} title={webpOk ? undefined : t("save.webpUnsupported")}>
                  WebP
                </option>
              </select>
            </div>
            {lossy ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-quality`}>{t("save.qualityLabel", { value: String(quality) })}</Label>
                <input
                  id={`${ids}-quality`}
                  type="range"
                  min={60}
                  max={100}
                  step={1}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  className="h-8 w-full"
                />
              </div>
            ) : null}
          </div>

          {!asVersion ? (
            <fieldset className="grid grid-cols-2 gap-2" aria-label={t("save.destination")}>
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-space`}>{t("save.spaceLabel")}</Label>
                <select
                  id={`${ids}-space`}
                  className={FIELD}
                  value={spaceId}
                  onChange={(e) => {
                    setSpaceId(e.target.value);
                    setFolderId("");
                  }}
                >
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  {allowNoSpace ? <option value={NONE}>{t("save.noSpace")}</option> : null}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-folder`}>{t("save.folderLabel")}</Label>
                <select id={`${ids}-folder`} className={FIELD} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                  <option value="">{t("save.folderRoot")}</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>
          ) : null}

          <div className="space-y-1">
            <label className="flex items-center gap-2" title={versionReason}>
              <input
                type="checkbox"
                checked={asVersion}
                disabled={Boolean(versionReason) || busy}
                aria-describedby={versionReason ? `${ids}-vreason` : undefined}
                onChange={(e) => setAsVersion(e.target.checked)}
              />
              {t("save.asVersion")}
            </label>
            {versionReason ? (
              <p id={`${ids}-vreason`} className="text-muted-foreground text-xs">
                {versionReason}
              </p>
            ) : null}
          </div>

          {asVersion ? (
            <section aria-label={tUsage("title")} className="space-y-1.5 rounded-lg border border-border p-2">
              <h4 className="text-xs font-semibold">{tUsage("title")}</h4>
              {usages.status === "loading" ? (
                <p role="status" className="text-muted-foreground text-xs">
                  {t("save.usagesLoading")}
                </p>
              ) : null}
              {usages.status === "error" ? (
                <div role="alert" className="flex items-center justify-between gap-2 text-xs">
                  <span>{t("save.usagesFailed")}</span>
                  <ActionButton id="retryVersions" variant="outline" size="sm" showLabel onAction={() => setAttempt((n) => n + 1)} />
                </div>
              ) : null}
              {usages.status === "ok" ? (
                <>
                  {usages.data.entries.length === 0 ? (
                    <p className="text-muted-foreground text-xs">{tUsage("empty")}</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {usages.data.entries.slice(0, 5).map((e) => (
                        <li key={`${e.targetType}:${e.targetId}:${e.context ?? ""}`} className="flex gap-2">
                          <span className="text-muted-foreground shrink-0">{tUsage(`kinds.${e.targetType}`)}</span>
                          <span className="truncate" title={e.title}>
                            {e.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="flex items-start gap-1.5 text-xs">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      {count === 0
                        ? t("save.versionImpactNone")
                        : t("save.versionImpact", { count: new Intl.NumberFormat(locale).format(count) })}
                    </span>
                  </p>
                </>
              ) : null}
            </section>
          ) : null}

          {media.mimeType === "image/gif" ? (
            <p role="note" className="flex items-start gap-1.5 text-xs">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("save.warnAnimated")}
            </p>
          ) : null}
          {media.hasLocation ? (
            <p role="note" className="flex items-start gap-1.5 text-xs">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("save.warnLocation")}
            </p>
          ) : null}

          {busy ? (
            <div role="progressbar" aria-label={t("save.busy")} className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-foreground/70" />
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/50 p-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <ActionButton id="pickerCancel" variant="outline" size="default" showLabel onAction={() => onOpenChange(false)} disabledReason={busy ? t("save.busy") : undefined} />
          <ActionButton id="confirmRetouchSave" variant="default" size="default" showLabel disabledReason={disabledReason} onAction={() => void submit()} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
