"use client";

import type { ReactNode } from "react";
import { AlertCircle, Clock, Download, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TipButton } from "./debug-shared";

/** Vue publique d'un import, telle que renvoyée par /api/integrations/tally/imports. */
export interface TallyImportView {
  id: string;
  automationId: string;
  formId: string;
  mode: "simulate" | "real";
  status: "pending" | "running" | "completed" | "cancelled" | "failed";
  cap: number;
  total: number;
  processed: number;
  created: number;
  completed: number;
  ignored: number;
  errors: number;
  skipped: number;
  errorMessage: string | null;
}

export const isActiveImport = (i: TallyImportView) => i.status === "pending" || i.status === "running";

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** Bandeau d'alerte (erreur ou avertissement), annoncé aux lecteurs d'écran. */
export function TallyAlert({
  tone,
  title,
  children,
  action,
}: {
  tone: "error" | "warn";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const cls =
    tone === "error"
      ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
      : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100";
  const Icon = tone === "error" ? AlertCircle : Clock;
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-md border p-2 text-xs ${cls}`}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <b className="block font-semibold">{title}</b>
        {children}
      </div>
      {action}
    </div>
  );
}

/** Compteurs trouvées / déjà importées / à importer. */
export function TallyCounter({ total, imported, toImport }: { total: number; imported: number; toImport: number }) {
  const cell = (n: number, label: string, accent?: boolean) => (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        accent
          ? "border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-950"
          : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <b className="block text-base font-semibold tabular-nums">{n}</b>
      <span className="text-[11px] text-neutral-600 dark:text-neutral-400">{label}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-2" aria-live="polite">
      {cell(total, plural(total, "réponse trouvée", "réponses trouvées"))}
      {cell(imported, plural(imported, "déjà importée", "déjà importées"))}
      {cell(toImport, "à importer", true)}
    </div>
  );
}

/** Règles de dédoublonnage appliquées par l'import. */
export function TallyDedupeRule() {
  return (
    <p className="text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
      <b>Doublon exact</b> (réponse Tally déjà importée, ou contact identique sur tous les champs) : ignoré.
      <br />
      <b>Doublon incomplet</b> (même mail, champs manquants d&apos;un côté) : seuls les champs vides sont complétés,
      aucune valeur existante n&apos;est écrasée.
    </p>
  );
}

/** Progression d'un import en cours, avec bouton d'arrêt. */
export function TallyProgress({
  imp,
  cancelling,
  onCancel,
}: {
  imp: TallyImportView;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const known = imp.total > 0;
  const total = Math.max(imp.total, imp.processed, 1);
  const pct = known ? Math.min(100, Math.round((imp.processed / total) * 100)) : 0;
  return (
    <div className="space-y-2">
      <div role="status" aria-live="polite" className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          <b>{imp.mode === "real" ? "Import en cours" : "Simulation en cours"}</b>
          <span className="flex-1" />
          <span className="font-mono tabular-nums">
            {imp.processed} sur {imp.total || "…"}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={known ? total : undefined}
          aria-valuenow={known ? imp.processed : undefined}
          aria-label="Progression de l'import"
          className="h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"
        >
          <div
            className={`h-full bg-blue-600 transition-[width] dark:bg-blue-400 ${known ? "" : "w-1/3 animate-pulse"}`}
            style={known ? { width: `${pct}%` } : undefined}
          />
        </div>
      </div>
      <TipButton
        label={cancelling ? "Arrêt demandé" : "Annuler l'import"}
        tip="Arrêter avant la prochaine réponse, les réponses déjà traitées restent importées"
        icon={<X className="size-3.5" />}
        onClick={onCancel}
        disabled={cancelling}
        disabledReason="L'arrêt est déjà demandé, il sera pris en compte avant la prochaine réponse"
      />
    </div>
  );
}

/** Récapitulatif d'un import terminé, annulé ou échoué. */
export function TallyRecap({ imp, onOpenHistory }: { imp: TallyImportView; onOpenHistory?: () => void }) {
  const real = imp.mode === "real";
  const cell = (n: number, label: string, tone: string) => (
    <div className={`rounded-md border px-2 py-1.5 ${tone}`}>
      <b className="block text-base font-semibold tabular-nums">{n}</b>
      <span className="text-[11px]">{label}</span>
    </div>
  );
  const neutral = "border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300";
  const unknown = Math.max(0, imp.processed - imp.created - imp.completed - imp.ignored - imp.errors);
  const treated = imp.created + imp.completed;
  return (
    <section aria-label={real ? "Récapitulatif de l'import" : "Récapitulatif de la simulation"} className="space-y-2">
      <h4 className="flex items-center gap-2 text-xs font-semibold">
        {real ? "Récapitulatif de l'import" : "Récapitulatif de la simulation"}
        {!real && (
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            Rien n&apos;a été écrit
          </span>
        )}
      </h4>
      {imp.status === "cancelled" && (
        <TallyAlert tone="warn" title="Import annulé">
          {imp.processed} {plural(imp.processed, "réponse traitée", "réponses traitées")} avant l&apos;arrêt.
          {real ? " Les réponses traitées restent importées." : ""}
        </TallyAlert>
      )}
      {imp.status === "failed" && (
        <TallyAlert tone="error" title="Import interrompu">
          {imp.errorMessage ?? "Une erreur a arrêté l'import."}
        </TallyAlert>
      )}
      {imp.status === "completed" && imp.errorMessage && (
        <TallyAlert tone="warn" title="Import partiel">
          {imp.errorMessage}
        </TallyAlert>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {cell(imp.created, real ? "contacts créés" : "contacts à créer", "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300")}
        {cell(imp.completed, real ? "contacts complétés" : "contacts à compléter", "border-violet-300 text-violet-800 dark:border-violet-800 dark:text-violet-300")}
        {cell(imp.ignored, "ignorées (doublons exacts)", neutral)}
        {cell(imp.errors, plural(imp.errors, "erreur", "erreurs"), imp.errors > 0 ? "border-red-300 text-red-800 dark:border-red-800 dark:text-red-300" : neutral)}
        {unknown > 0 && cell(unknown, "résultat inconnu", neutral)}
        {imp.skipped > 0 && cell(imp.skipped, "déjà importées ou hors plafond", neutral)}
      </div>
      <p className="text-[11px] text-neutral-600 dark:text-neutral-400">
        {treated} {plural(treated, "réponse", "réponses")} {real ? "passée" : "à passer"} dans le scénario.
        {real && onOpenHistory && treated > 0 && (
          <>
            {" "}
            <button
              type="button"
              onClick={onOpenHistory}
              className="rounded text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300"
            >
              Voir les exécutions de source Import dans l&apos;historique
            </button>
          </>
        )}
      </p>
    </section>
  );
}

/** Modale d'avertissement avant un import réel. */
export function TallyRealImportDialog({
  open,
  count,
  cap,
  onClose,
  onConfirm,
}: {
  open: boolean;
  count: number;
  cap: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const n = Math.min(count, cap);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Importer {n} {plural(n, "réponse", "réponses")} ?
          </DialogTitle>
          <DialogDescription>
            Des contacts, demandes, interactions et tâches vont être créés ou complétés dans vos bases. Chaque réponse
            importée produit une exécution de source Import, visible dans l&apos;historique.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          Les doublons exacts sont ignorés. Pour un même mail, seuls les champs vides sont complétés. Une réponse en
          erreur n&apos;arrête pas les suivantes.
          {count > cap && ` Un import traite au plus ${cap} réponses, relancez pour la suite.`}
        </p>
        <DialogFooter>
          <TipButton label="Annuler" tip="Fermer sans importer (Échap)" icon={<X className="size-3.5" />} onClick={onClose} />
          <TipButton
            label={`Importer ${n} ${plural(n, "réponse", "réponses")}`}
            tip="Lancer l'import réel"
            icon={<Download className="size-3.5" />}
            variant="primary"
            onClick={onConfirm}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
