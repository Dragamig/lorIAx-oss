"use client";

import { useEffect, useState } from "react";
import { LayoutTemplate, X } from "lucide-react";

interface SaveTemplateDialogProps {
  open: boolean;
  defaultName: string;
  onClose: () => void;
  onSubmit: (opts: { name: string; category: string; isGlobal: boolean }) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Dialog « Enregistrer comme template » du Studio de design.
 * Nom (requis), catégorie (optionnelle) et — pour les titulaires d'un rôle
 * GLOBAL (super_admin) — une case « Template global ». Un template global est
 * système (partagé, hors périmètre d'une seule org) : un simple admin d'org ne
 * peut pas en publier, le serveur renvoie 403 le cas échéant (source de vérité).
 * Sinon, le modèle est rattaché à l'espace hôte.
 */
export function SaveTemplateDialog({ open, defaultName, onClose, onSubmit }: SaveTemplateDialogProps) {
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const [canBeGlobal, setCanBeGlobal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Réinitialise le formulaire à chaque ouverture + résout le rôle org.
  useEffect(() => {
    if (!open) return;
    setName(defaultName || "Mon modèle");
    setCategory("");
    setIsGlobal(false);
    setError("");
    setDone(false);
    let cancelled = false;
    fetch("/api/org/current")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { isSuperAdmin?: boolean } | null) => {
        if (cancelled || !data) return;
        // Rôle GLOBAL uniquement : un template global est système, pas propre à
        // l'org. On n'affiche la case qu'au super_admin ; à défaut d'info, on la
        // masque (le serveur reste la source de vérité et renverra 403).
        setCanBeGlobal(!!data.isSuperAdmin);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, defaultName]);

  if (!open) return null;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Le nom du modèle est requis."); return; }
    setSaving(true);
    setError("");
    const res = await onSubmit({ name: trimmed, category: category.trim(), isGlobal });
    setSaving(false);
    if (res.ok) {
      setDone(true);
      setTimeout(() => onClose(), 900);
    } else {
      setError(res.error ?? "Erreur lors de l'enregistrement.");
    }
  };

  const inputCls =
    "w-full mt-1 px-2.5 py-1.5 text-[13px] rounded-md bg-background text-foreground border border-border outline-none focus:border-ring";

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 380, maxWidth: "calc(100vw - 32px)", padding: 18 }}
        className="bg-card border border-border rounded-xl shadow-2xl"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <LayoutTemplate size={16} className="text-primary" />
          <span style={{ fontSize: 14, fontWeight: 600 }} className="text-foreground">
            Enregistrer comme template
          </span>
          <button
            onClick={onClose}
            title="Fermer"
            style={{ marginLeft: "auto", width: 24, height: 24 }}
            className="flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <label style={{ fontSize: 12, display: "block" }} className="text-muted-foreground">
          Nom du modèle
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSubmit(); }}
            placeholder="Ex. Affiche événement"
            className={inputCls}
          />
        </label>

        <label style={{ fontSize: 12, display: "block", marginTop: 10 }} className="text-muted-foreground">
          Catégorie <span style={{ opacity: 0.6 }}>(optionnelle)</span>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSubmit(); }}
            placeholder="Ex. Réseaux sociaux"
            className={inputCls}
          />
        </label>

        {canBeGlobal && (
          <label
            style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={isGlobal}
              onChange={(e) => setIsGlobal(e.target.checked)}
              style={{ marginTop: 2, accentColor: "var(--primary)" }}
            />
            <span style={{ fontSize: 12 }} className="text-foreground">
              Template global (partagé)
              <span style={{ display: "block", fontSize: 11, marginTop: 1 }} className="text-muted-foreground">
                Modèle système, partagé au-delà d&apos;un seul espace. Sinon, réservé à l&apos;espace courant.
              </span>
            </span>
          </label>
        )}

        {error && (
          <p style={{ fontSize: 12, marginTop: 12 }} className="text-destructive">{error}</p>
        )}
        {done && (
          <p style={{ fontSize: 12, marginTop: 12 }} className="text-primary">Modèle enregistré.</p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button
            onClick={onClose}
            style={{ padding: "6px 14px", fontSize: 12 }}
            className="rounded-md border border-border bg-background text-foreground cursor-pointer hover:bg-muted"
          >
            Annuler
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving || done}
            style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, opacity: saving || done ? 0.6 : 1 }}
            className="rounded-md border-0 bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
