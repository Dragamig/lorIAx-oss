"use client";

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Trash2,
  Check,
  MoreHorizontal,
  Pencil,
  Sparkles,
  X,
  ArrowLeftRight,
  ArrowRight,
  Lock,
  ExternalLink,
} from "lucide-react";
import type { ColumnType, ColumnConfig, DbColumn, DbListItem } from "./types";
import { COLUMN_TYPE_ICONS, COLUMN_TYPE_LABELS, formatAutonumber } from "./constants";
import { normalizeOptions } from "./options";
import { AiFormulaModal } from "@/components/bases/ai-formula-modal";
import { DeleteColumnDialog } from "./delete-column-dialog";
import { pairingLabel, type PairingInfo } from "./relation-pairing";
import type { AddColumnResult } from "./use-database-data";

// ─── Badge de jumelage ──────────────────────────────────────────────────────

export function PairingBadge({ pairing }: { pairing: PairingInfo }) {
  if (pairing.kind === "none") return null;
  const label = pairingLabel(pairing);
  const paired = pairing.kind === "paired";
  return (
    <span
      tabIndex={0}
      role="img"
      title={label}
      aria-label={label}
      data-testid="pairing-badge"
      className={`inline-flex items-center gap-1 shrink-0 rounded px-1 py-0.5 text-[10px] leading-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
        paired ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      }`}
    >
      {paired ? <ArrowLeftRight className="h-3 w-3" aria-hidden /> : <ArrowRight className="h-3 w-3" aria-hidden />}
      {!paired && "Sens unique"}
    </span>
  );
}

// ─── Relation Config Editor ─────────────────────────────────────────────────

function RelationConfigEditor({
  column,
  allDatabases,
  currentDatabaseId,
  pairing,
  onUpdateConfig,
}: {
  column: DbColumn;
  allDatabases: DbListItem[];
  currentDatabaseId: string;
  pairing: PairingInfo;
  onUpdateConfig: (config: ColumnConfig) => void;
}) {
  const targetDbId = column.config?.targetDatabaseId ?? "";
  const otherDatabases = allDatabases.filter((db) => db.id !== currentDatabaseId);
  const locked = pairing.kind === "paired";
  const lockHint = "La base cible d'une relation jumelée ne peut pas être modifiée. Supprimez la jumelle pour la changer.";

  return (
    <div className="border-t px-3 py-2">
      <span className="text-xs text-muted-foreground block mb-1">Base cible</span>
      <div className="flex items-center gap-1.5">
        <select
          value={targetDbId}
          disabled={locked}
          aria-label="Base cible"
          title={locked ? lockHint : undefined}
          onChange={(e) =>
            onUpdateConfig({ ...column.config, targetDatabaseId: e.target.value || undefined })
          }
          className="w-full text-xs px-2 py-1.5 rounded border bg-background disabled:opacity-70 disabled:cursor-not-allowed"
        >
          <option value="">— Choisir une base —</option>
          {otherDatabases.map((db) => (
            <option key={db.id} value={db.id}>
              {db.name}
            </option>
          ))}
        </select>
        {locked && (
          <span tabIndex={0} role="img" title={lockHint} aria-label={lockHint} className="shrink-0 text-muted-foreground rounded focus-visible:outline-2 focus-visible:outline-primary">
            <Lock className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </div>
      {locked && (
        <>
          <p className="text-[10px] text-muted-foreground mt-1">{pairingLabel(pairing)}</p>
          <a
            href={`/bases/${pairing.targetDatabaseId}`}
            target="_blank"
            rel="noopener"
            title="Voir la colonne jumelle dans la base cible"
            aria-label="Voir la colonne jumelle"
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary rounded"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Voir la colonne jumelle
          </a>
        </>
      )}
      {otherDatabases.length === 0 && (
        <p className="text-xs text-muted-foreground mt-1 italic">
          Aucune autre base dans cet espace
        </p>
      )}
    </div>
  );
}

// ─── Column Header Menu ─────────────────────────────────────────────────────

export type ColumnHeaderMenuHandle = { startRename: () => void };

type ColumnHeaderMenuProps = {
  column: DbColumn;
  onRename: (name: string) => void;
  onChangeType: (type: ColumnType) => void;
  onDelete: (alsoDeleteInverse?: boolean) => void;
  onUpdateConfig: (config: ColumnConfig) => void;
  allDatabases: DbListItem[];
  currentDatabaseId: string;
  pairing: PairingInfo;
};

export const ColumnHeaderMenu = forwardRef<ColumnHeaderMenuHandle, ColumnHeaderMenuProps>(({
  column,
  onRename,
  onChangeType,
  onDelete,
  onUpdateConfig,
  allDatabases,
  currentDatabaseId,
  pairing,
}, ref) => {
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameValue, setNameValue] = useState(column.name);
  const [editingOptions, setEditingOptions] = useState(false);
  const [optionsValue, setOptionsValue] = useState(
    normalizeOptions(column.config?.options).join(", ")
  );
  // Brouillon local de formule : on ne pousse la config (requête réseau +
  // refresh) qu'au blur, sinon chaque frappe relance un round-trip qui écrase
  // la valeur en cours de saisie et fait perdre des caractères.
  const [formulaDraft, setFormulaDraft] = useState(column.config?.formula ?? "");
  useEffect(() => {
    setFormulaDraft(column.config?.formula ?? "");
  }, [column.config?.formula]);
  const [aiFormulaOpen, setAiFormulaOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Menu plus large pour les types qui demandent de la saisie (formule) :
  // sinon le champ est trop étroit et la formule illisible.
  const dropdownWidth = column.type === "formula" ? 340 : 208;

  const computePos = () => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const left = rect.left + dropdownWidth > window.innerWidth ? rect.right - dropdownWidth : rect.left;
    setMenuPos({ top: rect.bottom + 4, left });
  };

  useImperativeHandle(ref, () => ({
    startRename: () => {
      setNameValue(column.name);
      setRenaming(true);
      computePos();
      setOpen(true);
    },
  }), [column.name]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (!wrapperRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
        setRenaming(false);
        setEditingOptions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <>
    <div ref={wrapperRef}>
      <button
        onClick={() => {
          if (!open) computePos();
          setOpen(!open);
        }}
        className="p-0.5 rounded hover:bg-accent transition-colors opacity-0 group-hover/col:opacity-100"
        aria-label={`Options de la colonne ${column.name}`}
      >
        <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>

      {open && menuPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left, zIndex: 9999, width: dropdownWidth, maxHeight: `calc(100vh - ${menuPos.top}px - 12px)`, overflowY: "auto" }}
          className="rounded-md border bg-popover text-popover-foreground shadow-md"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !renaming) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {/* Rename */}
          {renaming ? (
            <div className="p-2 flex gap-1">
              <input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    onRename(nameValue);
                    setRenaming(false);
                    setOpen(false);
                  } else if (e.key === "Escape") {
                    setRenaming(false);
                    setOpen(false);
                  }
                }}
                className="flex-1 text-sm px-2 py-1 rounded border bg-background"
              />
              <button
                onClick={() => {
                  onRename(nameValue);
                  setRenaming(false);
                  setOpen(false);
                }}
                className="p-1 rounded hover:bg-accent"
                aria-label="Valider le renommage"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setRenaming(true)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
            >
              <Pencil className="h-3.5 w-3.5" />
              Renommer
            </button>
          )}

          {/* Type selector */}
          <div className="border-t px-3 py-1.5">
            <span className="text-xs text-muted-foreground">Type</span>
            <div className="flex flex-col gap-0.5 mt-1">
              {(Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    // On garde le menu ouvert : l'usager peut enchaîner sur la
                    // config du type (formule, options…) sans rouvrir les ⋯.
                    onChangeType(t);
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                    column.type === t
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {COLUMN_TYPE_ICONS[t]}
                  {COLUMN_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Select options editor */}
          {column.type === "select" && (
            <div className="border-t px-3 py-2">
              {editingOptions ? (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Options (virgules)</span>
                  <input
                    autoFocus
                    value={optionsValue}
                    onChange={(e) => setOptionsValue(e.target.value)}
                    className="text-xs px-2 py-1 rounded border bg-background"
                    placeholder="Option A, Option B, Option C"
                  />
                  <button
                    onClick={() => {
                      const options = optionsValue
                        .split(",")
                        .map((s: string) => s.trim())
                        .filter(Boolean);
                      onUpdateConfig({ ...column.config, options });
                      setEditingOptions(false);
                    }}
                    className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Valider
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {/* Options affichées en pastilles, hors du champ (style Airtable). */}
                  {normalizeOptions(column.config?.options).length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {normalizeOptions(column.config?.options).map((opt) => (
                        <span
                          key={opt}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] bg-accent text-accent-foreground"
                        >
                          {opt}
                          <button
                            onClick={() => {
                              const options = normalizeOptions(column.config?.options).filter((o) => o !== opt);
                              onUpdateConfig({ ...column.config, options });
                              setOptionsValue(options.join(", "));
                            }}
                            className="hover:text-destructive"
                            aria-label={`Retirer ${opt}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Aucune option</span>
                  )}
                  <button
                    onClick={() => {
                      setOptionsValue(normalizeOptions(column.config?.options).join(", "));
                      setEditingOptions(true);
                    }}
                    className="text-xs text-primary hover:underline self-start"
                  >
                    Modifier les options
                  </button>
                </div>
              )}
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input type="checkbox" checked={!!column.config?.multiple} onChange={(e) => onUpdateConfig({ ...column.config, multiple: e.target.checked })} onMouseDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }} onPointerDown={(e) => e.stopPropagation()} className="h-3.5 w-3.5 rounded accent-primary" />
                <span className="text-xs text-muted-foreground">Choix multiple</span>
              </label>
            </div>
          )}

          {/* Person config */}
          {column.type === "person" && (
            <div className="border-t px-3 py-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!column.config?.multiple} onChange={(e) => onUpdateConfig({ ...column.config, multiple: e.target.checked })} onMouseDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }} onPointerDown={(e) => e.stopPropagation()} className="h-3.5 w-3.5 rounded accent-primary" />
                <span className="text-xs text-muted-foreground">Plusieurs personnes</span>
              </label>
            </div>
          )}

          {/* Number unit editor */}
          {column.type === "number" && (
            <div className="border-t px-3 py-2">
              <span className="text-xs text-muted-foreground block mb-1">Unité</span>
              <input value={column.config?.unit ?? ""} onChange={(e) => onUpdateConfig({ ...column.config, unit: e.target.value || undefined })} className="w-full text-xs px-2 py-1 rounded border bg-background" placeholder="€, kg, km, %..." />
            </div>
          )}

          {/* Formula editor */}
          {column.type === "formula" && (
            <div className="border-t px-3 py-2">
              <span className="text-xs text-muted-foreground block mb-1">Formule</span>
              <textarea
                value={formulaDraft}
                onChange={(e) => setFormulaDraft(e.target.value)}
                onBlur={() => {
                  if (formulaDraft !== (column.config?.formula ?? "")) {
                    onUpdateConfig({ ...column.config, formula: formulaDraft });
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full text-xs px-2 py-1 rounded border bg-background font-mono resize-y"
                placeholder='prop("Colonne") * 2'
                rows={2}
              />
              <p className="text-[10px] text-muted-foreground mt-1">prop(&quot;Nom&quot;), if(), concat(), round()...</p>
              <button
                type="button"
                onClick={() => setAiFormulaOpen(true)}
                className="mt-2 flex items-center gap-1.5 text-xs text-purple-600 hover:underline dark:text-purple-400"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Générer avec l&apos;IA
              </button>
              <AiFormulaModal
                databaseId={currentDatabaseId}
                open={aiFormulaOpen}
                currentFormula={formulaDraft}
                onClose={() => setAiFormulaOpen(false)}
                onAccept={(formula) => {
                  setFormulaDraft(formula);
                  onUpdateConfig({ ...column.config, formula });
                }}
              />
            </div>
          )}

          {/* Autonumber config */}
          {column.type === "autonumber" && (
            <div className="border-t px-3 py-2 flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Numéro de départ</span>
                <input
                  type="number"
                  value={(column.config?.startNumber as number | undefined) ?? 1}
                  onChange={(e) => onUpdateConfig({ ...column.config, startNumber: e.target.value ? Number(e.target.value) : 1 })}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full text-xs px-2 py-1 rounded border bg-background"
                  placeholder="1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Zéros de tête (longueur)</span>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={(column.config?.padding as number | undefined) ?? 0}
                  onChange={(e) => onUpdateConfig({ ...column.config, padding: e.target.value ? Math.max(0, Number(e.target.value)) : 0 })}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full text-xs px-2 py-1 rounded border bg-background"
                  placeholder="0 (aucun)"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Préfixe</span>
                <input
                  type="text"
                  value={(column.config?.prefix as string | undefined) ?? ""}
                  onChange={(e) => onUpdateConfig({ ...column.config, prefix: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full text-xs px-2 py-1 rounded border bg-background"
                  placeholder="REF-"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Suffixe</span>
                <input
                  type="text"
                  value={(column.config?.suffix as string | undefined) ?? ""}
                  onChange={(e) => onUpdateConfig({ ...column.config, suffix: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full text-xs px-2 py-1 rounded border bg-background"
                  placeholder="/2026"
                />
              </label>
              <div className="text-[10px] text-muted-foreground">
                Aperçu :{" "}
                <span className="font-mono tabular-nums">
                  {formatAutonumber((column.config?.startNumber as number | undefined) ?? 1, {
                    padding: column.config?.padding as number | undefined,
                    prefix: column.config?.prefix as string | undefined,
                    suffix: column.config?.suffix as string | undefined,
                  })}
                </span>
              </div>
            </div>
          )}

          {/* URL config */}
          {column.type === "url" && (
            <div className="border-t px-3 py-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!column.config?.displayAsButton}
                  onChange={(e) => onUpdateConfig({ ...column.config, displayAsButton: e.target.checked })}
                  onMouseDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 rounded accent-primary"
                />
                <span className="text-xs text-muted-foreground">Afficher en bouton</span>
              </label>
            </div>
          )}

          {/* Relation config */}
          {column.type === "relation" && (
            <RelationConfigEditor
              column={column}
              allDatabases={allDatabases}
              currentDatabaseId={currentDatabaseId}
              pairing={pairing}
              onUpdateConfig={(config) => {
                onUpdateConfig(config);
                setOpen(false);
              }}
            />
          )}

          {/* Affichage — retour à la ligne (par colonne, style Airtable) */}
          <div className="border-t px-3 py-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!column.config?.wrap}
                onChange={(e) => onUpdateConfig({ ...column.config, wrap: e.target.checked })}
                onMouseDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="h-3.5 w-3.5 rounded accent-primary"
              />
              <span className="text-xs text-muted-foreground">Retour à la ligne</span>
            </label>
          </div>

          {/* Delete */}
          <div className="border-t">
            <button
              onClick={() => {
                setOpen(false);
                setDeleteOpen(true);
              }}
              title="Supprimer la colonne"
              aria-label={`Supprimer la colonne ${column.name}`}
              className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-accent flex items-center gap-2"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Supprimer
            </button>
          </div>
        </div>
      , document.body)}
      <DeleteColumnDialog
        open={deleteOpen}
        columnName={column.name}
        isRelation={column.type === "relation"}
        pairing={pairing}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={(alsoDeleteInverse) => {
          setDeleteOpen(false);
          onDelete(alsoDeleteInverse);
        }}
      />
    </>
  );
});

ColumnHeaderMenu.displayName = "ColumnHeaderMenu";

// ─── Add Column Menu ─────────────────────────────────────────────────────────

export function AddColumnMenu({
  onAdd,
  allDatabases,
  currentDatabaseId,
  currentDatabaseName,
}: {
  onAdd: (
    name: string,
    type: ColumnType,
    config?: ColumnConfig,
    relationOptions?: { createInverse: boolean; inverseName?: string },
  ) => Promise<AddColumnResult> | void;
  allDatabases: DbListItem[];
  currentDatabaseId: string;
  currentDatabaseName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [targetDbId, setTargetDbId] = useState("");
  const [formula, setFormula] = useState("");
  const [optionsStr, setOptionsStr] = useState("");
  const [createInverse, setCreateInverse] = useState(true);
  const [inverseName, setInverseName] = useState(currentDatabaseName ?? "");
  const [inverseError, setInverseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function resetForm() {
    setCreateInverse(true);
    setInverseName(currentDatabaseName ?? "");
    setInverseError(null);
    setName("");
    setType("text");
    setTargetDbId("");
    setFormula("");
    setOptionsStr("");
  }

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (!wrapperRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const otherDatabases = allDatabases.filter((db) => db.id !== currentDatabaseId);

  const targetName = otherDatabases.find((db) => db.id === targetDbId)?.name;

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return;
    if (type === "relation" && !targetDbId) return;
    const config: ColumnConfig = {};
    if (type === "relation" && targetDbId) {
      config.targetDatabaseId = targetDbId;
    }
    // Permet de renseigner la config directement à la création.
    if (type === "formula" && formula.trim()) {
      config.formula = formula.trim();
    }
    if (type === "select") {
      const options = optionsStr.split(",").map((s) => s.trim()).filter(Boolean);
      if (options.length > 0) config.options = options;
    }
    const relationOptions =
      type === "relation" && targetDbId
        ? { createInverse, inverseName: createInverse ? inverseName.trim() || undefined : undefined }
        : undefined;
    setSubmitting(true);
    setInverseError(null);
    try {
      const result = await onAdd(
        name.trim(),
        type,
        Object.keys(config).length > 0 ? config : undefined,
        relationOptions,
      );
      if (result && result.ok === false) {
        if (result.code === "inverse-name-exists") {
          setInverseError(`Une colonne « ${inverseName.trim() || currentDatabaseName} » existe déjà dans ${targetName ?? "la base cible"}. Choisissez un autre nom.`);
        }
        return;
      }
      resetForm();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <div ref={wrapperRef}>
      <button
        onClick={() => {
          if (!open && wrapperRef.current) {
            const rect = wrapperRef.current.getBoundingClientRect();
            const dropdownWidth = 208;
            const left = rect.right + dropdownWidth > window.innerWidth ? rect.left - dropdownWidth : rect.right + 4;
            setMenuPos({ top: rect.top, left });
          }
          setOpen(!open);
        }}
        className="database-block-add-col"
        title="Ajouter une colonne"
        aria-label="Ajouter une colonne"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>

      {open && menuPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left, zIndex: 9999, width: type === "formula" ? 340 : 208, maxHeight: `calc(100vh - ${menuPos.top}px - 12px)`, overflowY: "auto" }}
          className="rounded-md border bg-popover text-popover-foreground shadow-md p-3"
        >
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nom de la colonne"
              className="text-sm px-2 py-1.5 rounded border bg-background"
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") handleSubmit();
                else if (e.key === "Escape") {
                  setOpen(false);
                  resetForm();
                }
              }}
            />
            <div className="flex flex-col gap-0.5">
              {(Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                    type === t
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {COLUMN_TYPE_ICONS[t]}
                  {COLUMN_TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            {/* Relation target selector */}
            {type === "relation" && (
              <div>
                <span className="text-xs text-muted-foreground block mb-1">Base cible</span>
                <select
                  value={targetDbId}
                  onChange={(e) => setTargetDbId(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 rounded border bg-background"
                >
                  <option value="">— Choisir —</option>
                  {otherDatabases.map((db) => (
                    <option key={db.id} value={db.id}>
                      {db.name}
                    </option>
                  ))}
                </select>
                {targetDbId && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createInverse}
                        onChange={(e) => { setCreateInverse(e.target.checked); setInverseError(null); }}
                        onMouseDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 rounded accent-primary"
                      />
                      <span className="text-xs">Créer la colonne inverse dans {targetName}</span>
                    </label>
                    {createInverse ? (
                      <>
                        <p className="text-[10px] text-muted-foreground">
                          Les liens ajoutés d&apos;un côté apparaissent de l&apos;autre.
                        </p>
                        <input
                          value={inverseName}
                          onChange={(e) => { setInverseName(e.target.value); setInverseError(null); }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                          aria-label="Nom de la colonne inverse"
                          aria-invalid={inverseError ? true : undefined}
                          title="Nom de la colonne inverse"
                          className={`w-full text-xs px-2 py-1 rounded border bg-background ${inverseError ? "border-destructive" : ""}`}
                          placeholder="Nom de la colonne inverse"
                        />
                        {inverseError && (
                          <p role="alert" className="text-[11px] text-destructive">{inverseError}</p>
                        )}
                      </>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">
                        Relation à sens unique : aucune colonne n&apos;est créée dans {targetName}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Formule — configurable dès la création */}
            {type === "formula" && (
              <div>
                <span className="text-xs text-muted-foreground block mb-1">Formule</span>
                <textarea
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full text-xs px-2 py-1 rounded border bg-background font-mono resize-y"
                  placeholder='prop("Colonne") * 2'
                  rows={2}
                />
                <p className="text-[10px] text-muted-foreground mt-1">prop(&quot;Nom&quot;), if(), concat(), round()...</p>
              </div>
            )}

            {/* Options de choix — configurables dès la création */}
            {type === "select" && (
              <div>
                <span className="text-xs text-muted-foreground block mb-1">Options (séparées par des virgules)</span>
                <input
                  value={optionsStr}
                  onChange={(e) => setOptionsStr(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full text-xs px-2 py-1 rounded border bg-background"
                  placeholder="Option A, Option B, Option C"
                />
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!name.trim() || submitting || (type === "relation" && !targetDbId)}
              title={!name.trim() ? "Saisissez un nom de colonne" : type === "relation" && !targetDbId ? "Choisissez une base cible" : "Ajouter la colonne"}
              className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Ajouter
            </button>
          </div>
        </div>
      , document.body)}
    </>
  );
}
