"use client";

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookOpen,
  Eye,
  FileText,
  Presentation,
  Table2,
  GitMerge,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { ChatActionsSettings } from "@/lib/ai/chat-actions-settings-shared";

type SubKey = Exclude<keyof ChatActionsSettings, "actionsEnabled">;

const SUBS: {
  key: SubKey;
  name: string;
  desc: string;
  chip: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { key: "readDatabases", name: "Lire les bases", desc: "Consulter, filtrer et compter les lignes. Requis par toutes les autres actions.", chip: "Lecture", Icon: Eye },
  { key: "proposeUpdates", name: "Proposer des modifications de lignes", desc: "Corriger ou compléter des valeurs existantes.", chip: "Modification", Icon: Pencil },
  { key: "proposeDeletes", name: "Proposer des suppressions", desc: "Retirer des lignes obsolètes ou vides.", chip: "Suppression", Icon: Trash2 },
  { key: "proposeMerges", name: "Proposer des fusions de doublons", desc: "Regrouper des lignes qui désignent le même élément.", chip: "Fusion", Icon: GitMerge },
  { key: "proposeCreates", name: "Proposer des créations de lignes", desc: "Ajouter de nouvelles lignes depuis un document ou une demande.", chip: "Création", Icon: Plus },
];

const FILE_KEYS = ["proposeSpreadsheets", "proposeDocuments", "proposePresentations"] as const;

/** Création de fichiers : soumise au seul interrupteur maître, indépendante de la lecture des bases. */
const CREATION_SUBS: {
  key: (typeof FILE_KEYS)[number];
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { key: "proposeSpreadsheets", Icon: Table2 },
  { key: "proposeDocuments", Icon: FileText },
  { key: "proposePresentations", Icon: Presentation },
];

const isFileKey = (key: SubKey): key is (typeof FILE_KEYS)[number] => (FILE_KEYS as readonly string[]).includes(key);

/** Raison pour laquelle une sous-option ne peut pas être réglée, ou `null`. */
export function disabledReason(value: ChatActionsSettings, key: SubKey): string | null {
  if (!value.actionsEnabled) return "Activez d'abord les actions de l'assistant IA.";
  if (key !== "readDatabases" && !isFileKey(key) && !value.readDatabases) return "Nécessite « Lire les bases », désactivé.";
  return null;
}

/** Sous-options réellement actives (dépendances appliquées). */
export function activeSubs(value: ChatActionsSettings): SubKey[] {
  return SUBS.filter((s) => value.actionsEnabled && value[s.key] && !disabledReason(value, s.key)).map((s) => s.key);
}

/**
 * Bascule d'un interrupteur. Activer le maître sans aucune sous-option cochée
 * active la lecture. Retourne le nouvel état et le message du toast.
 */
export function toggleChatAction(
  value: ChatActionsSettings,
  key: keyof ChatActionsSettings,
): { next: ChatActionsSettings; message: string } {
  const next = { ...value, [key]: !value[key] };
  const label = key === "actionsEnabled" ? "Actions de l'assistant IA" : SUBS.find((s) => s.key === key)?.name ?? key;
  let message = `${label} ${next[key] ? "activé" : "désactivé"}`;
  if (key === "readDatabases" && !next.readDatabases) {
    const n = SUBS.filter((s) => s.key !== "readDatabases" && next[s.key]).length;
    if (n > 0) message += `, ${n} autre${n > 1 ? "s" : ""} action${n > 1 ? "s" : ""} suspendue${n > 1 ? "s" : ""}`;
  }
  if (key === "actionsEnabled" && next.actionsEnabled && ![...SUBS, ...CREATION_SUBS].some((s) => next[s.key])) {
    next.readDatabases = true;
    message += ", lecture activée";
  }
  return { next, message };
}

function Switch({
  checked,
  disabled,
  label,
  onClick,
  testId,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Hint label={label} disabled={disabled}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          checked ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
        } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </Hint>
  );
}

function Pill({ tone, children, testId }: { tone: "neutral" | "green" | "amber"; children: string; testId?: string }) {
  const cls =
    tone === "green"
      ? "bg-green-500/15 text-green-700 dark:text-green-400"
      : tone === "amber"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span data-testid={testId} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

export type ChatActionsSectionProps =
  | {
      status: "ready";
      value: ChatActionsSettings;
      onChange: (next: ChatActionsSettings) => void;
      /** `false` : le module Présentations est éteint, l'outil resterait sans effet. */
      presentationsModuleEnabled?: boolean;
    }
  | { status: "error"; message: string; onRetry: () => void };

export function ChatActionsSection(props: ChatActionsSectionProps) {
  const t = useTranslations("admin.ai.creation");
  if (props.status === "error") {
    return (
      <div className="space-y-3" data-testid="chat-actions-error">
        <p className="text-sm font-medium">Assistant IA du chat (/ai)</p>
        <div role="alert" className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-2">
            <p className="text-sm font-medium">Actions de l&apos;assistant IA indisponibles</p>
            <p className="text-xs text-muted-foreground">{props.message}</p>
            <Hint label="Recharger le réglage des actions de l'assistant IA">
              <Button type="button" variant="outline" size="sm" onClick={props.onRetry} aria-label="Réessayer le chargement">
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Réessayer
              </Button>
            </Hint>
          </div>
        </div>
      </div>
    );
  }

  const { value, onChange, presentationsModuleEnabled } = props;
  const on = value.actionsEnabled;
  const active = activeSubs(value);
  const writes = active.filter((k) => k !== "readDatabases").length;

  const change = (key: keyof ChatActionsSettings) => {
    const { next, message: base } = toggleChatAction(value, key);
    const message = isFileKey(key as SubKey) ? t(next[key] ? "files.toggledOn" : "files.toggledOff", { name: t(`files.${key}.name`) }) : base;
    onChange(next);
    toast.success(message, { action: { label: "Annuler", onClick: () => onChange(value) } });
  };

  const badge: { tone: "neutral" | "green" | "amber"; text: string } = !on
    ? { tone: "neutral", text: "FAQ" }
    : writes
      ? { tone: "green", text: "Actions activées" }
      : active.length
        ? { tone: "amber", text: "Lecture seule" }
        : { tone: "neutral", text: "Aucun outil actif" };
  const previewText = !on
    ? "Réponses à partir des documents et de l'aide. Aucun outil de base de données."
    : active.length
      ? "Outils de base de données disponibles. Toute écriture est proposée, jamais appliquée seule."
      : "Aucun outil actif.";

  return (
    <div className="space-y-3" data-testid="chat-actions-section">
      <p className="text-sm font-medium">Assistant IA du chat (/ai)</p>
      <section aria-labelledby="chat-actions-title" className="rounded-lg border bg-card p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Wand2 className={`mt-0.5 h-5 w-5 ${on ? "text-primary" : "text-muted-foreground"}`} />
            <div className="space-y-2">
              <h3 id="chat-actions-title" className="text-lg font-semibold">
                Actions de l&apos;assistant IA
              </h3>
              <p className="text-xs text-muted-foreground">Accès de l&apos;assistant aux outils de base de données depuis le chat.</p>
              <Pill tone={on ? "green" : "neutral"} testId="chat-actions-state">
                {on ? "Activé" : "Désactivé"}
              </Pill>
            </div>
          </div>
          <Switch
            testId="chat-actions-master"
            checked={on}
            label={on ? "Désactiver les actions : le chat redevient une FAQ renforcée" : "Activer les actions de l'assistant IA"}
            onClick={() => change("actionsEnabled")}
          />
        </div>

        <ul className="divide-y rounded-md border">
          {SUBS.map(({ key, name, desc, Icon }) => {
            const why = disabledReason(value, key);
            const checked = value[key] && !why;
            return (
              <li key={key} className={`flex items-center justify-between gap-4 p-3 ${why ? "opacity-70" : ""}`}>
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{name}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                    {why && on && (
                      <p data-testid={`chat-actions-why-${key}`} className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <Lock className="h-3 w-3" />
                        {why}
                      </p>
                    )}
                  </div>
                </div>
                <Switch
                  testId={`chat-actions-${key}`}
                  checked={checked}
                  disabled={!!why}
                  label={why ?? t(value[key] ? "files.disableTip" : "files.enableTip", { name: name.toLowerCase() })}
                  onClick={() => change(key)}
                />
              </li>
            );
          })}
        </ul>

        <div className="space-y-2" data-testid="chat-actions-files">
          <h4 className="text-sm font-semibold">{t("files.title")}</h4>
          <ul className="divide-y rounded-md border">
            {CREATION_SUBS.map(({ key, Icon }) => {
              const name = t(`files.${key}.name`);
              const why = disabledReason(value, key);
              const checked = value[key] && !why;
              return (
                <li key={key} className={`flex items-center justify-between gap-4 p-3 ${why ? "opacity-70" : ""}`}>
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{name}</p>
                      <p className="text-xs text-muted-foreground">{t(`files.${key}.desc`)}</p>
                      {key === "proposePresentations" && (
                        <p
                          data-testid="chat-actions-dep-proposePresentations"
                          className={`flex items-center gap-1.5 text-xs ${presentationsModuleEnabled === false ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                        >
                          <Lock className="h-3 w-3" />
                          {presentationsModuleEnabled === false
                            ? t("files.presentationsModuleOff")
                            : t("files.presentationsModuleDep")}
                        </p>
                      )}
                      {why && on && (
                        <p data-testid={`chat-actions-why-${key}`} className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                          <Lock className="h-3 w-3" />
                          {why}
                        </p>
                      )}
                    </div>
                  </div>
                  <Switch
                    testId={`chat-actions-${key}`}
                    checked={checked}
                    disabled={!!why}
                    label={why ?? t(value[key] ? "files.disableTip" : "files.enableTip", { name: name.toLowerCase() })}
                    onClick={() => change(key)}
                  />
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Aperçu du chat</h4>
          <div className="rounded-md border">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <strong className="text-sm">Assistant</strong>
              <span className="flex-1" />
              <Pill tone={badge.tone} testId="chat-actions-badge">
                {badge.text}
              </Pill>
            </div>
            <div className="space-y-2 p-3">
              <p data-testid="chat-actions-preview" className="text-xs text-muted-foreground">
                {previewText}
              </p>
              <div className="flex flex-wrap gap-2" data-testid="chat-actions-chips">
                {!on
                  ? ["Documents", "Aide"].map((c) => (
                      <span key={c} className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
                        <BookOpen className="h-3 w-3" />
                        {c}
                      </span>
                    ))
                  : SUBS.filter((s) => active.includes(s.key)).map(({ key, chip, Icon }) => (
                      <span key={key} className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
                        <Icon className="h-3 w-3" />
                        {chip}
                      </span>
                    ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-md border bg-muted/30 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          <b className="block text-sm text-foreground">Chaque écriture reste une proposition</b>
          Elle n&apos;est appliquée qu&apos;après le clic de l&apos;utilisateur.
        </p>
      </div>
    </div>
  );
}
