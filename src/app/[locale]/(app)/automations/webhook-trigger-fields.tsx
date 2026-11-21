"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff, FileText, Info, RefreshCw, Webhook } from "lucide-react";
import { IconButton } from "./webhook-body-panel";
import { FOCUS_CLS } from "./debug-shared";
import { deduceTriggerMode, type TriggerMode } from "./trigger-mode";

const INPUT_CLS =
  "w-full truncate rounded border border-neutral-300 bg-neutral-50 px-2 py-1.5 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900";

function TallyHelp({ url }: { url: string }) {
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        aria-label="Brancher Tally : étapes"
        aria-describedby="tally-help"
        className={`inline-flex min-h-7 items-center gap-1.5 rounded border border-neutral-300 px-2 text-xs font-normal normal-case tracking-normal text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800 ${FOCUS_CLS}`}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
        Brancher Tally
      </button>
      <div
        id="tally-help"
        role="tooltip"
        className="absolute left-0 top-full z-50 mt-1.5 hidden w-72 max-w-[85vw] rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-xs font-normal normal-case tracking-normal text-neutral-900 shadow-lg group-hover/tip:block group-focus-within/tip:block dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <b className="mb-1 block">Brancher Tally en 5 étapes</b>
        <ol className="list-decimal space-y-1 pl-4">
          <li>Copier l&apos;URL : <code className="break-all rounded bg-neutral-100 px-1 text-[11px] dark:bg-neutral-800">{url}</code></li>
          <li>Dans Tally : le formulaire, Intégrations, Webhooks, coller l&apos;URL.</li>
          <li>Ajouter l&apos;en-tête <code className="rounded bg-neutral-100 px-1 text-[11px] dark:bg-neutral-800">X-Webhook-Secret</code> avec le secret ci-dessous.</li>
          <li>Envoyer une réponse de test, puis vérifier « Dernier corps reçu ».</li>
          <li>Activer l&apos;automatisme.</li>
        </ol>
      </div>
    </span>
  );
}

/** URL publique + secret, copiables, et bouton de régénération. */
function WebhookAddress({
  url,
  secret,
  copiedField,
  onCopy,
  onRegenerate,
  regenerating,
  idPrefix,
}: {
  url: string;
  secret?: string;
  copiedField: "url" | "secret" | null;
  onCopy: (field: "url" | "secret", value: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  idPrefix: string;
}) {
  const [showSecret, setShowSecret] = useState(false);
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-url`} className="mb-1 block text-xs text-neutral-500">URL publique</label>
        <div className="flex items-center gap-1">
          <input id={`${idPrefix}-url`} readOnly value={url} className={INPUT_CLS} />
          <IconButton label="Copier l'URL" onClick={() => onCopy("url", url)}>
            {copiedField === "url" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          </IconButton>
        </div>
      </div>
      {secret && (
        <div>
          <label htmlFor={`${idPrefix}-secret`} className="mb-1 block text-xs text-neutral-500">Secret</label>
          <div className="flex items-center gap-1">
            <input
              id={`${idPrefix}-secret`}
              readOnly
              type={showSecret ? "text" : "password"}
              value={secret}
              className={INPUT_CLS}
            />
            <IconButton
              label={showSecret ? "Masquer le secret" : "Afficher le secret"}
              onClick={() => setShowSecret((v) => !v)}
              pressed={showSecret}
            >
              {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </IconButton>
            <IconButton label="Copier le secret" onClick={() => onCopy("secret", secret)}>
              {copiedField === "secret" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            </IconButton>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            Envoyé dans l&apos;en-tête <code>X-Webhook-Secret</code>
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenerating}
        title="Régénérer l'URL et le secret"
        aria-label="Régénérer l'URL et le secret"
        className={`flex items-center gap-1.5 rounded border border-neutral-300 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 ${FOCUS_CLS}`}
      >
        <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} aria-hidden />
        Régénérer
      </button>
    </div>
  );
}

function ModeCard({ icon, title, description, onClick }: { icon: ReactNode; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={`Choisir ${title}`}
      className={`flex w-full items-start gap-2.5 rounded-lg border border-neutral-200 bg-white p-2.5 text-left hover:border-blue-500 hover:bg-blue-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-blue-950 ${FOCUS_CLS}`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800">
        {icon}
      </span>
      <span>
        <b className="block text-xs">{title}</b>
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{description}</span>
      </span>
    </button>
  );
}

/**
 * Panneau de réglages du déclencheur `webhook_inbound` : d'abord le choix du
 * mode (Webhook générique / Tally), puis le détail du mode choisi avec un
 * bouton « Changer de mode ». Le mode initial se déduit de l'état existant.
 * URL et secret sont générés côté serveur, jamais côté client.
 */
export function WebhookTriggerFields({
  token,
  secret,
  copiedField,
  onCopy,
  onRegenerate,
  regenerating,
  hasReceived,
  body,
  tally,
}: {
  token?: string;
  secret?: string;
  copiedField: "url" | "secret" | null;
  onCopy: (field: "url" | "secret", value: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  /** Un corps a déjà été reçu sur ce webhook. */
  hasReceived: boolean;
  body: ReactNode;
  /** Connexion, formulaire, branchement et import Tally. */
  tally?: (webhookUrl: string) => ReactNode;
}) {
  const [tallyConnected, setTallyConnected] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<TriggerMode | "choose" | null>(null);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [addrOpen, setAddrOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/integrations/tally/connection");
        const d = r.ok ? await r.json().catch(() => null) : null;
        if (alive) setTallyConnected(!!d?.connected);
      } catch {
        if (alive) setTallyConnected(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!token) {
    return (
      <p className="text-[11px] italic text-neutral-400">
        Enregistrez pour générer l&apos;URL du webhook.
      </p>
    );
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/api/automations/hook/${token}`;
  const deduced = deduceTriggerMode({ tallyConnected, hasReceived });
  const mode = picked ?? deduced;

  if (mode === "pending") {
    return (
      <div role="status" aria-busy="true" aria-label="Chargement du mode du déclencheur" className="space-y-2">
        <div className="h-12 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-12 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      </div>
    );
  }

  if (mode === "choose") {
    return (
      <div className="space-y-2" role="group" aria-label="Mode du déclencheur">
        <ModeCard
          icon={<Webhook className="h-3.5 w-3.5" aria-hidden />}
          title="Webhook générique"
          description="Une URL et un secret à coller dans le service émetteur."
          onClick={() => setPicked("webhook")}
        />
        <ModeCard
          icon={<FileText className="h-3.5 w-3.5" aria-hidden />}
          title="Tally"
          description="Connexion par clé API, choix du formulaire, branchement automatique et import des réponses."
          onClick={() => setPicked("tally")}
        />
      </div>
    );
  }

  const header = (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        {mode === "webhook" ? <Webhook className="h-3.5 w-3.5" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />}
        {mode === "webhook" ? "Webhook générique" : "Tally"}
      </span>
      <button
        type="button"
        onClick={() => setPicked("choose")}
        title="Revenir au choix du mode"
        aria-label="Changer de mode"
        className={`ml-auto inline-flex min-h-7 items-center gap-1.5 rounded border border-neutral-300 px-2 text-[11px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800 ${FOCUS_CLS}`}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Changer de mode
      </button>
    </div>
  );

  if (mode === "webhook") {
    return (
      <div className="space-y-3">
        {header}
        <WebhookAddress
          url={url}
          secret={secret}
          copiedField={copiedField}
          onCopy={onCopy}
          onRegenerate={onRegenerate}
          regenerating={regenerating}
          idPrefix="wh"
        />
        <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">{body}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      {tally && tally(url)}
      <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setAddrOpen((o) => !o)}
          aria-expanded={addrOpen}
          title="URL et secret pour un branchement manuel"
          className={`flex w-full items-center gap-1 rounded text-xs font-medium text-neutral-600 dark:text-neutral-300 ${FOCUS_CLS}`}
        >
          {addrOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          Branchement manuel : URL et secret
        </button>
        {addrOpen && (
          <div className="mt-2 space-y-2">
            <TallyHelp url={url} />
            <WebhookAddress
              url={url}
              secret={secret}
              copiedField={copiedField}
              onCopy={onCopy}
              onRegenerate={onRegenerate}
              regenerating={regenerating}
              idPrefix="wh-tally"
            />
          </div>
        )}
      </div>
      <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setBodyOpen((o) => !o)}
          aria-expanded={bodyOpen}
          title="Afficher ou replier le dernier corps reçu"
          className={`flex w-full items-center gap-1 rounded text-xs font-medium text-neutral-600 dark:text-neutral-300 ${FOCUS_CLS}`}
        >
          {bodyOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          Dernier corps reçu
        </button>
        {bodyOpen && <div className="mt-2">{body}</div>}
      </div>
    </div>
  );
}
