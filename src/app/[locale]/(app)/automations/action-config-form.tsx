"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Database, FileText, Fingerprint, Link2, ListPlus, Table2 } from "lucide-react";
import { findRowModeOf, setFindRowMode, useAutomationColumns, useSpaceDatabases, type AutomationColumn, type FindRowMode } from "./automation-shared";
import { PlaceholderField, type PlaceholderGroup } from "./placeholder-field";
import { TemplateSelector } from "./template-selector";
import { DesignTemplateSelector, useDesignTemplates } from "./design-template-selector";
import {
  deriveTemplateVariables,
  type BindingSource,
  type TemplateVariable,
} from "@/lib/automations/template-variables";

type Cfg = Record<string, unknown>;

const FIELD_CLASS =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

type SpaceOption = { id: string; name: string; slug: string };
type DocOption = { id: string; title: string };

function flattenDocs(list: unknown): DocOption[] {
  if (!Array.isArray(list)) return [];
  const out: DocOption[] = [];
  for (const d of list as Array<{ id: string; title: string; children?: unknown }>) {
    out.push({ id: d.id, title: d.title });
    out.push(...flattenDocs(d.children));
  }
  return out;
}

/**
 * Paramètres du mode « Tableur de demande » de create_document : espace cible
 * (défaut : espace de l'automatisation) et document parent choisi par id. Le
 * titre est saisi au-dessus (champ à variables). Sortie exploitable ensuite via
 * `createdDocument.link` dans une étape « Mettre à jour une ligne ».
 */
function DemandWorkbookConfig({
  config,
  set,
  spaceId,
}: {
  config: Cfg;
  set: (key: string, value: unknown) => void;
  spaceId: string;
}) {
  const [spaceList, setSpaceList] = useState<SpaceOption[]>([]);
  const [docs, setDocs] = useState<DocOption[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const targetSpaceId = str(config.spaceId) || spaceId;
  const parentId = str(config.parentId);

  useEffect(() => {
    let active = true;
    fetch("/api/spaces")
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => {
        if (active && Array.isArray(j)) setSpaceList(j as SpaceOption[]);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const targetSlug = spaceList.find((s) => s.id === targetSpaceId)?.slug;
  useEffect(() => {
    if (!targetSlug) return;
    let active = true;
    setLoadingDocs(true);
    fetch(`/api/spaces/${encodeURIComponent(targetSlug)}/documents`)
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => {
        if (active) setDocs(flattenDocs(j));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingDocs(false);
      });
    return () => {
      active = false;
    };
  }, [targetSlug]);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-neutral-500">Espace cible</span>
        <select
          value={str(config.spaceId)}
          onChange={(e) => {
            // Changer d'espace rend le parent caduc : retiré avec l'espace.
            set("spaceId", e.target.value);
            set("parentId", "");
          }}
          title="Espace où le document est créé"
          aria-label="Espace cible"
          className={FIELD_CLASS}
        >
          <option value="">Espace de l&apos;automatisation</option>
          {spaceList.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-neutral-500">Document parent</span>
        <select
          value={parentId}
          onChange={(e) => set("parentId", e.target.value)}
          title="Le tableur est créé comme sous-page de ce document (ex. Demandes entrantes)"
          aria-label="Document parent"
          className={FIELD_CLASS}
        >
          <option value="">{loadingDocs ? "Chargement…" : "Aucun (racine de l'espace)"}</option>
          {parentId && !docs.some((d) => d.id === parentId) && (
            <option value={parentId}>{parentId}</option>
          )}
          {docs.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
      </label>
      <p className="text-[11px] text-neutral-400">
        Utilisez « Stocker le résultat » puis la variable « lien document » dans une étape « Mettre à jour une ligne » pour renseigner la colonne Lien document.
      </p>
    </div>
  );
}

/**
 * Formulaire no-code de configuration d'une action, par type. Remplace la
 * saisie JSON brute : chaque champ est un input/menu déroulant, avec insertion
 * de variables via PlaceholderField. Écrit directement dans actionConfig.
 */
export function ActionConfigForm({
  actionType,
  config,
  onChange,
  groups,
  columns,
  spaceId,
  databaseId,
}: {
  actionType: string;
  config: Cfg;
  onChange: (next: Cfg) => void;
  groups: PlaceholderGroup[];
  columns: AutomationColumn[];
  spaceId: string;
  /** Base de l'automatisation (absente pour un workflow autonome). */
  databaseId?: string;
}) {
  const set = (key: string, value: unknown) => {
    const next = { ...config };
    if (value === "" || value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  // Applique plusieurs clés en UN seul onChange. Nécessaire quand un handler doit
  // modifier deux champs à la fois : deux `set(...)` consécutifs repartent tous
  // deux du même `config` figé (closure), donc le second écrase le premier.
  const patch = (changes: Record<string, unknown>) => {
    const next = { ...config };
    for (const [key, value] of Object.entries(changes)) {
      if (value === "" || value === undefined) delete next[key];
      else next[key] = value;
    }
    onChange(next);
  };

  // Fonction (pas composant) pour éviter un remontage à chaque frappe.
  const varField = (k: string, label: string, multiline?: boolean) => (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-500">{label}</span>
      <PlaceholderField
        value={str(config[k])}
        onChange={(v) => set(k, v)}
        groups={groups}
        multiline={multiline}
        rows={multiline ? 4 : undefined}
        className={FIELD_CLASS}
      />
    </label>
  );

  switch (actionType) {
    case "create_document":
      return (
        <div className="space-y-3">
          <div className="flex gap-1.5" role="group" aria-label="Type de document">
            {([
              ["document", "Document", FileText],
              ["demand_workbook", "Tableur de demande", Table2],
            ] as const).map(([k, label, Icon]) => {
              const active = (str(config.kind) || "document") === k;
              return (
                <button
                  key={k}
                  type="button"
                  title={`${label}${k === "demand_workbook" ? " : classeur vide Lignes + Exigences" : ""}`}
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() =>
                    patch({ kind: k === "document" ? undefined : k, templateId: undefined, bindings: undefined })
                  }
                  className={`flex min-h-6 flex-1 items-center justify-center gap-1 rounded border px-2 py-1.5 text-xs ${
                    active
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      : "border-neutral-300 dark:border-neutral-700"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
          {varField("title", "Titre du document")}
          {str(config.kind) === "demand_workbook" ? (
            <DemandWorkbookConfig config={config} set={set} spaceId={spaceId} />
          ) : (
            <>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Modèle (optionnel)</span>
            <TemplateSelector
              spaceId={spaceId}
              value={str(config.templateId)}
              onChange={(id) => set("templateId", id)}
              className={FIELD_CLASS}
            />
          </label>
          {str(config.templateId) && (
            <BindingPanel
              templateId={str(config.templateId)}
              bindings={(config.bindings as Record<string, BindingSource>) ?? {}}
              columns={columns}
              groups={groups}
              onChange={(next) => set("bindings", Object.keys(next).length ? next : undefined)}
            />
          )}
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Classification (optionnel)</span>
            <select value={str(config.classification)} onChange={(e) => set("classification", e.target.value)} className={FIELD_CLASS}>
              <option value="">Par défaut</option>
              <option value="public">Public</option>
              <option value="internal">Interne</option>
              <option value="confidential">Confidentiel</option>
              <option value="secret">Secret</option>
            </select>
          </label>
            </>
          )}
        </div>
      );

    case "create_design":
      return (
        <CreateDesignConfig
          config={config}
          set={set}
          patch={patch}
          columns={columns}
          groups={groups}
        />
      );

    case "create_task":
      return (
        <div className="space-y-3">
          {varField("title", "Titre de la tâche")}
          {varField("assigneeId", "Assigné à (optionnel)")}
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Échéance (optionnel)</span>
            <input type="datetime-local" value={str(config.dueAt)} onChange={(e) => set("dueAt", e.target.value)} className={FIELD_CLASS} />
          </label>
          {varField("documentId", "Document lié (optionnel)")}
        </div>
      );

    case "send_email":
      return (
        <div className="space-y-3">
          {varField("to", "Destinataire")}
          {varField("subject", "Objet")}
          {varField("html", "Corps (HTML)", true)}
        </div>
      );

    case "ai":
      return (
        <div className="space-y-3">
          {varField("prompt", "Prompt", true)}
          {varField("systemPrompt", "Instruction système (optionnel)", true)}
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Document généré</span>
            <select value={str(config.format) || "none"} onChange={(e) => set("format", e.target.value)} className={FIELD_CLASS}>
              <option value="none">Aucun (texte seul)</option>
              <option value="pdf">PDF</option>
              <option value="docx">Word (DOCX)</option>
            </select>
          </label>
          {varField("title", "Titre du document (optionnel)")}
        </div>
      );

    case "notify_user":
      return (
        <div className="space-y-3">
          {varField("userId", "Utilisateur à notifier")}
          {varField("title", "Titre de la notification")}
          {varField("message", "Message (optionnel)", true)}
        </div>
      );

    case "webhook":
      return (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">URL</span>
            <input value={str(config.url)} onChange={(e) => set("url", e.target.value)} placeholder="https://exemple.com/hook" className={`${FIELD_CLASS} font-mono`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Méthode</span>
            <select value={str(config.method) || "POST"} onChange={(e) => set("method", e.target.value)} className={FIELD_CLASS}>
              {["POST", "GET", "PUT", "PATCH", "DELETE"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
      );

    case "create_row":
    case "update_row":
    case "find_row":
      return (
        <RowActionForm
          actionType={actionType}
          config={config}
          onChange={onChange}
          set={set}
          groups={groups}
          ownColumns={columns}
          spaceId={spaceId}
          ownDatabaseId={databaseId}
        />
      );

    default:
      return <p className="text-xs italic text-neutral-400">Cette action n&apos;a pas d&apos;options.</p>;
  }
}

/** Champs utilisateur bindables (miroir des clés {{user.*}} reconnues). */
const USER_FIELDS: { ref: string; label: string }[] = [
  { ref: "name", label: "Nom" },
  { ref: "email", label: "E-mail" },
  { ref: "id", label: "Identifiant" },
];

/** Extrait les variables d'étape ({{variables.<chemin>}}) des groupes fournis. */
function stepVariables(groups: PlaceholderGroup[]): { ref: string; label: string }[] {
  const out: { ref: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const opt of g.options) {
      const m = /^\{\{\s*variables\.([\w.-]+)\s*\}\}$/.exec(opt.value);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        out.push({ ref: m[1], label: opt.label });
      }
    }
  }
  return out;
}

/**
 * Panneau de data-binding (Task 12) : pour chaque placeholder du modèle choisi,
 * l'utilisateur relie une source (colonne de la base déclencheuse, variable
 * d'étape, champ utilisateur ou texte statique). Le mapping est écrit dans
 * `config.bindings[key] = { kind, ref }`. Les placeholders non liés restent
 * vides à l'exécution (activables plus tard).
 */
function BindingPanel({
  templateId,
  bindings,
  columns,
  groups,
  onChange,
}: {
  templateId: string;
  bindings: Record<string, BindingSource>;
  columns: { id: string; name: string }[];
  groups: PlaceholderGroup[];
  onChange: (next: Record<string, BindingSource>) => void;
}) {
  const [vars, setVars] = useState<TemplateVariable[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Le parent ne monte ce panneau qu'avec un templateId non vide ; garde
    // défensive sans setState synchrone (règle react-hooks/set-state-in-effect).
    if (!templateId) return;
    let active = true;
    setLoading(true);
    fetch(`/api/templates/${templateId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((tpl) => {
        if (!active || !tpl) {
          if (active) setVars([]);
          return;
        }
        // Priorité aux variables matérialisées (Task 10) ; repli : dérivation
        // depuis le contenu (nœuds templateVariable + scan markdown).
        const materialized: TemplateVariable[] = Array.isArray(tpl.variables)
          ? tpl.variables.filter(
              (v: unknown): v is TemplateVariable =>
                !!v && typeof (v as TemplateVariable).key === "string"
            )
          : [];
        setVars(materialized.length ? materialized : deriveTemplateVariables(tpl.content));
      })
      .catch(() => {
        if (active) setVars([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [templateId]);

  if (loading) {
    return <p className="text-[11px] italic text-neutral-400">Chargement des champs du modèle…</p>;
  }
  if (vars.length === 0) {
    return (
      <p className="text-[11px] italic text-neutral-400">
        Ce modèle ne contient aucun champ à relier.
      </p>
    );
  }

  return (
    <BindingRows
      vars={vars}
      bindings={bindings}
      columns={columns}
      groups={groups}
      onChange={onChange}
    />
  );
}

/**
 * Rendu partagé des lignes de data-binding (une par variable de modèle) —
 * réutilisé tel quel par create_document (variables dérivées du contenu) et
 * create_design (variables du template). Chaque ligne relie une source
 * (colonne / variable d'étape / champ utilisateur / texte statique).
 */
function BindingRows({
  vars,
  bindings,
  columns,
  groups,
  onChange,
}: {
  vars: TemplateVariable[];
  bindings: Record<string, BindingSource>;
  columns: { id: string; name: string }[];
  groups: PlaceholderGroup[];
  onChange: (next: Record<string, BindingSource>) => void;
}) {
  const stepVars = stepVariables(groups);
  const setBinding = (key: string, source: BindingSource | null) => {
    const next = { ...bindings };
    if (source) next[key] = source;
    else delete next[key];
    onChange(next);
  };

  return (
    <div className="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <span className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
        Champs du modèle
      </span>
      {vars.map((v) => {
        const b = bindings[v.key];
        const kind = b?.kind ?? "";
        return (
          <div key={v.key} className="space-y-1 border-t border-neutral-100 pt-2 first:border-0 first:pt-0 dark:border-neutral-800">
            <span className="block text-xs font-medium">{v.label}</span>
            <div className="flex gap-1.5">
              <select
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as BindingSource["kind"] | "";
                  if (!k) return setBinding(v.key, null);
                  // Valeur par défaut de `ref` selon la source choisie.
                  const ref =
                    k === "cells"
                      ? columns[0]?.id ?? ""
                      : k === "variables"
                        ? stepVars[0]?.ref ?? ""
                        : k === "user"
                          ? "name"
                          : "";
                  setBinding(v.key, { kind: k, ref });
                }}
                className={`${FIELD_CLASS} max-w-[45%]`}
              >
                <option value="">Non lié</option>
                <option value="cells" disabled={columns.length === 0}>Colonne</option>
                <option value="variables" disabled={stepVars.length === 0}>Variable d&apos;étape</option>
                <option value="user">Champ utilisateur</option>
                <option value="static">Texte statique</option>
              </select>
              {kind === "cells" && (
                <select
                  value={b?.ref ?? ""}
                  onChange={(e) => setBinding(v.key, { kind: "cells", ref: e.target.value })}
                  className={FIELD_CLASS}
                >
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
              {kind === "variables" && (
                <select
                  value={b?.ref ?? ""}
                  onChange={(e) => setBinding(v.key, { kind: "variables", ref: e.target.value })}
                  className={FIELD_CLASS}
                >
                  {stepVars.map((s) => (
                    <option key={s.ref} value={s.ref}>{s.label}</option>
                  ))}
                </select>
              )}
              {kind === "user" && (
                <select
                  value={b?.ref ?? "name"}
                  onChange={(e) => setBinding(v.key, { kind: "user", ref: e.target.value })}
                  className={FIELD_CLASS}
                >
                  {USER_FIELDS.map((f) => (
                    <option key={f.ref} value={f.ref}>{f.label}</option>
                  ))}
                </select>
              )}
              {kind === "static" && (
                <input
                  value={b?.ref ?? ""}
                  onChange={(e) => setBinding(v.key, { kind: "static", ref: e.target.value })}
                  placeholder="Texte…"
                  className={FIELD_CLASS}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Configuration de l'action create_design (Spec 2) — pendant, pour les designs,
 * de create_document : sélecteur de modèle, data-binding des variables du
 * template (mêmes sources que create_document via BindingRows), puis format de
 * rendu et nom de fichier. Le `storeAs` de sortie est géré au niveau du nœud
 * (champ « Stocker le résultat » du canevas), comme les autres actions. Le
 * `spaceId` n'est PAS saisi ici : il est résolu à l'exécution.
 */
function CreateDesignConfig({
  config,
  set,
  patch,
  columns,
  groups,
}: {
  config: Cfg;
  set: (key: string, value: unknown) => void;
  patch: (changes: Record<string, unknown>) => void;
  columns: { id: string; name: string }[];
  groups: PlaceholderGroup[];
}) {
  const { templates, loading } = useDesignTemplates();
  const templateId = str(config.templateId);
  const selected = templates.find((t) => t.id === templateId);
  const vars: TemplateVariable[] = (selected?.variables ?? []).map((v) => ({
    key: v.key,
    label: v.label,
  }));

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-neutral-500">Modèle de design</span>
        <DesignTemplateSelector
          templates={templates}
          loading={loading}
          value={templateId}
          onChange={(id) => {
            // Changer de modèle rend les anciens bindings caducs (variables
            // différentes) : on les réinitialise. En UN seul patch — deux `set`
            // consécutifs repartiraient du même config figé et le 2e écraserait
            // le 1er (templateId perdu → aucun champ à relier).
            patch({ templateId: id, bindings: undefined });
          }}
          className={FIELD_CLASS}
        />
      </label>
      {templateId &&
        (loading ? (
          <p className="text-[11px] italic text-neutral-400">Chargement des champs du modèle…</p>
        ) : vars.length > 0 ? (
          <BindingRows
            vars={vars}
            bindings={(config.bindings as Record<string, BindingSource>) ?? {}}
            columns={columns}
            groups={groups}
            onChange={(next) => set("bindings", Object.keys(next).length ? next : undefined)}
          />
        ) : (
          <p className="text-[11px] italic text-neutral-400">
            Ce modèle ne contient aucun champ à relier.
          </p>
        ))}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Format</span>
          <select
            value={str(config.format) || "png"}
            onChange={(e) => set("format", e.target.value)}
            className={FIELD_CLASS}
          >
            <option value="png">Image (PNG)</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Nom de fichier (optionnel)</span>
          <input
            value={str(config.filename)}
            onChange={(e) => set("filename", e.target.value)}
            placeholder="visuel"
            className={FIELD_CLASS}
          />
        </label>
      </div>
    </div>
  );
}

/** Sélecteur « Chercher par » de find_row : valeur d'une colonne ou identifiant de ligne. */
function FindRowModeSwitch({ mode, onChange }: { mode: FindRowMode; onChange: (m: FindRowMode) => void }) {
  const items: { id: FindRowMode; label: string; tip: string; Icon: typeof Table2 }[] = [
    { id: "column", label: "Valeur d'une colonne", tip: "Chercher la ligne dont une colonne vaut une valeur", Icon: Table2 },
    { id: "id", label: "Identifiant de ligne", tip: "Chercher la ligne par son identifiant (par exemple une cellule relation)", Icon: Fingerprint },
  ];
  return (
    <div role="group" aria-label="Chercher par" title="Critère de recherche de la ligne" className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">Chercher par</span>
      {items.map(({ id, label, tip, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => id !== mode && onChange(id)}
          aria-pressed={mode === id}
          aria-label={label}
          title={tip}
          className={`inline-flex min-h-6 items-center gap-1 rounded border px-2 py-0.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
            mode === id
              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Formulaire des actions sur une base (create_row, update_row, find_row) :
 * base cible, correspondance (create_row / find_row), cellules à écrire.
 * Changer de base recharge les colonnes et réinitialise ce qui en dépend.
 */
function RowActionForm({
  actionType,
  config,
  onChange,
  set,
  groups,
  ownColumns,
  spaceId,
  ownDatabaseId,
}: {
  actionType: string;
  config: Cfg;
  onChange: (next: Cfg) => void;
  set: (key: string, value: unknown) => void;
  groups: PlaceholderGroup[];
  ownColumns: AutomationColumn[];
  spaceId: string;
  ownDatabaseId?: string;
}) {
  const { databases, loading } = useSpaceDatabases(spaceId);
  const configured = str(config.databaseId);
  const targetId = configured || ownDatabaseId || "";
  const isOwn = !!ownDatabaseId && targetId === ownDatabaseId;
  const fetched = useAutomationColumns(isOwn ? undefined : targetId || undefined);
  const targetColumns = isOwn ? ownColumns : fetched;
  const ownName = databases.find((d) => d.id === ownDatabaseId)?.name;
  const known = databases.some((d) => d.id === configured);

  const changeBase = (nextId: string) => {
    const previous = config;
    const next = { ...config };
    if (!nextId || nextId === ownDatabaseId) delete next.databaseId;
    else next.databaseId = nextId;
    delete next.cells;
    delete next.relationModes;
    delete next.match;
    delete next.columnId;
    delete next.value;
    delete next.rowId;
    onChange(next);
    const name = databases.find((d) => d.id === nextId)?.name ?? ownName ?? "cette base";
    toast.success(`Base cible : ${name}. Colonnes rechargées, valeurs réinitialisées.`, {
      action: { label: "Annuler", onClick: () => onChange(previous) },
    });
  };

  const match = (config.match as { columnId?: string; value?: string } | undefined) ?? {};
  const setMatch = (changes: { columnId?: string; value?: string }) => {
    const merged = { columnId: match.columnId ?? "", value: match.value ?? "", ...changes };
    if (!merged.columnId) {
      const next = { ...config };
      delete next.match;
      delete next.onMatch;
      onChange(next);
      return;
    }
    // Défaut proposé à la création d'une correspondance : compléter les champs vides.
    onChange({ ...config, match: merged, onMatch: config.onMatch ?? "fill_empty" });
  };

  const valueGroups = groups;

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-xs text-neutral-500">
          <Database className="h-3 w-3" /> Base cible
        </span>
        <select
          value={configured}
          onChange={(e) => changeBase(e.target.value)}
          aria-label="Base cible"
          title="Base sur laquelle l'action agit"
          className={FIELD_CLASS}
        >
          <option value="">
            {ownDatabaseId ? `Cette base (${ownName ?? "…"})` : loading ? "Chargement des bases…" : "Choisir une base…"}
          </option>
          {configured && !known && !loading && <option value={configured}>{configured}</option>}
          {databases
            .filter((d) => d.id !== ownDatabaseId)
            .map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
        </select>
        {!ownDatabaseId && !configured && (
          <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-400">
            Ce workflow n&apos;a pas de base : choisissez-en une.
          </span>
        )}
      </label>

      {actionType === "update_row" && (
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">
            {isOwn ? "Ligne cible (défaut : ligne déclencheuse)" : "Ligne cible (identifiant de la ligne)"}
          </span>
          <PlaceholderField
            value={str(config.rowId)}
            onChange={(v) => set("rowId", v)}
            groups={valueGroups}
            dates={false}
            placeholder={isOwn ? undefined : "{{variables.contact.foundRow.id}}"}
            className={FIELD_CLASS}
          />
        </label>
      )}

      {actionType === "find_row" && findRowModeOf(config) === "id" && (
        <section
          className="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-800"
          aria-label="Ligne à chercher"
        >
          <FindRowModeSwitch mode="id" onChange={(m) => onChange(setFindRowMode(config, m))} />
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Identifiant de la ligne</span>
            <PlaceholderField
              value={str(config.rowId)}
              onChange={(v) => onChange({ ...config, rowId: v })}
              groups={valueGroups}
              dates={false}
              placeholder="{{cells.<relation>.0}}"
              className={FIELD_CLASS}
            />
          </label>
          <p className="text-[11px] text-neutral-500">
            Une cellule relation donne son premier identifiant avec .0. Sortie : foundRow (identifiant et cellules), vide si la ligne est introuvable dans la base cible.
          </p>
        </section>
      )}

      {(actionType === "create_row" || (actionType === "find_row" && findRowModeOf(config) === "column")) && (
        <section
          className="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-800"
          aria-label={actionType === "find_row" ? "Ligne à chercher" : "Correspondance"}
        >
          {actionType === "find_row" ? (
            <FindRowModeSwitch mode="column" onChange={(m) => onChange(setFindRowMode(config, m))} />
          ) : (
            <span className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Correspondance sur</span>
          )}
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">Colonne</span>
            <select
              value={actionType === "find_row" ? str(config.columnId) : str(match.columnId)}
              onChange={(e) =>
                actionType === "find_row" ? set("columnId", e.target.value) : setMatch({ columnId: e.target.value })
              }
              aria-label="Colonne de correspondance"
              className={FIELD_CLASS}
            >
              <option value="">{actionType === "find_row" ? "Choisir une colonne…" : "Aucune (toujours créer)"}</option>
              {targetColumns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          {(actionType === "find_row" || match.columnId) && (
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Vaut</span>
              <PlaceholderField
                value={actionType === "find_row" ? str(config.value) : str(match.value)}
                onChange={(v) => (actionType === "find_row" ? set("value", v) : setMatch({ value: v }))}
                groups={valueGroups}
                className={FIELD_CLASS}
              />
            </label>
          )}
          {actionType === "create_row" && match.columnId && (
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">Si une ligne existe</span>
              <select
                value={str(config.onMatch) || "overwrite"}
                onChange={(e) => set("onMatch", e.target.value)}
                aria-label="Si une ligne existe"
                title="Compléter : seules les cellules vides sont remplies, rien n'est écrasé. Remplacer : les valeurs écrites par l'action remplacent celles de la ligne. Un doublon exact n'écrit jamais."
                className={FIELD_CLASS}
              >
                <option value="fill_empty">Compléter les champs vides</option>
                <option value="overwrite">Remplacer les valeurs</option>
              </select>
            </label>
          )}
          <p className="text-[11px] text-neutral-500">
            {actionType === "find_row"
              ? "Sortie : foundRow (identifiant et cellules), vide si aucune ligne ne correspond."
              : "Ligne trouvée : doublon exact ignoré, sinon complétée ou mise à jour. Sinon : créée."}
          </p>
        </section>
      )}

      {actionType !== "find_row" && (
        <CellsEditor
          value={(config.cells as Cfg) ?? {}}
          columns={targetColumns}
          groups={valueGroups}
          onChange={(cells) => set("cells", cells)}
          relationModes={(config.relationModes as Record<string, string> | undefined) ?? {}}
          onRelationModeChange={(colId, append) => {
            const modes = { ...((config.relationModes as Record<string, string> | undefined) ?? {}) };
            if (append) modes[colId] = "append";
            else delete modes[colId];
            if (Object.keys(modes).length > 0) set("relationModes", modes);
            else {
              const next = { ...config };
              delete next.relationModes;
              onChange(next);
            }
            toast.success(append ? "Les liens seront ajoutés aux liens existants" : "Les liens remplaceront les liens existants");
          }}
        />
      )}
    </div>
  );
}

/** Éditeur de cellules { colonne → valeur } pour create_row / update_row. */
function CellsEditor({
  value,
  columns,
  groups,
  onChange,
  relationModes,
  onRelationModeChange,
}: {
  value: Cfg;
  columns: AutomationColumn[];
  groups: PlaceholderGroup[];
  onChange: (next: Cfg) => void;
  relationModes: Record<string, string>;
  onRelationModeChange: (colId: string, append: boolean) => void;
}) {
  const entries = Object.entries(value);
  const usedIds = new Set(entries.map(([id]) => id));
  const unused = columns.filter((c) => !usedIds.has(c.id));

  const setValue = (colId: string, v: string) => onChange({ ...value, [colId]: v });
  const remove = (colId: string) => {
    const previous = value;
    const next = { ...value };
    delete next[colId];
    onChange(next);
    const name = columns.find((c) => c.id === colId)?.name ?? "Colonne";
    toast.success(`${name} retirée`, { action: { label: "Annuler", onClick: () => onChange(previous) } });
  };
  const add = (colId: string) => {
    if (colId) onChange({ ...value, [colId]: "" });
  };

  return (
    <div className="space-y-2">
      <span className="block text-xs text-neutral-500">Valeurs des colonnes</span>
      {entries.length === 0 && (
        <p className="text-[11px] italic text-neutral-400">Aucune colonne renseignée.</p>
      )}
      {entries.map(([colId, v]) => {
        const col = columns.find((c) => c.id === colId);
        const isRelation = col?.type === "relation";
        return (
          <div key={colId} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs font-medium">
                {isRelation && <Link2 className="h-3 w-3" aria-hidden />}
                {col?.name ?? colId}
              </span>
              <button
                type="button"
                onClick={() => remove(colId)}
                aria-label={`Retirer la colonne ${col?.name ?? colId}`}
                title={`Retirer ${col?.name ?? colId}`}
                className="inline-flex min-h-6 items-center rounded px-1.5 text-[11px] text-red-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-red-400"
              >
                Retirer
              </button>
            </div>
            <PlaceholderField
              value={str(v)}
              onChange={(nv) => setValue(colId, nv)}
              groups={groups}
              placeholder={isRelation ? "{{variables.contact.row.id}}" : undefined}
              className={FIELD_CLASS}
            />
            {isRelation && (
              <label
                className="mt-1.5 flex min-h-6 cursor-pointer items-center gap-1.5 text-xs"
                title="Coché : les liens indiqués sont ajoutés à ceux déjà présents dans la ligne (sans doublon). Décoché : ils les remplacent."
              >
                <input
                  type="checkbox"
                  checked={relationModes[colId] === "append"}
                  onChange={(e) => onRelationModeChange(colId, e.target.checked)}
                  aria-label={`Ajouter aux liens existants de ${col?.name ?? colId}`}
                  className="h-3.5 w-3.5 rounded border-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                />
                <ListPlus className="h-3 w-3" aria-hidden />
                Ajouter aux liens existants
              </label>
            )}
            {isRelation && (
              <p className="mt-1 text-[11px] text-neutral-500">
                Relation : saisissez l&apos;identifiant de la ligne liée, ou insérez la sortie d&apos;une étape
                (ex. identifiant de la ligne créée).
              </p>
            )}
          </div>
        );
      })}
      {unused.length > 0 && (
        <select
          value=""
          onChange={(e) => add(e.target.value)}
          aria-label="Ajouter une colonne"
          className={FIELD_CLASS}
        >
          <option value="">+ Ajouter une colonne…</option>
          {unused.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
