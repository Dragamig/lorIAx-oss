"use client";

import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useState, useCallback } from "react";
import { Palette, GripHorizontal, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBlockLock } from "@/hooks/use-block-lock";
import { ModalLockBanner } from "@/components/editor/modal-lock-banner";
import { DesignModal } from "./design-modal";
import { getMetaDocId } from "./meta-context";
import { resolveThumbnailSrc } from "./design-thumbnail";
import { mediaIdFromUrl, useMediaPresence } from "@/components/media/use-media-presence";

export function DesignBlockView({ node, updateAttributes, editor, selected, deleteNode }: NodeViewProps) {
  const { designId, title, thumbnailUrl, lockedBy, lockedAt } = node.attrs;
  const [modalOpen, setModalOpen] = useState(false);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const { missing: thumbGone } = useMediaPresence(mediaIdFromUrl(resolveThumbnailSrc(thumbnailUrl)));
  const thumbSrc = resolveThumbnailSrc(thumbnailUrl);
  const editable = editor?.isEditable;

  // Canvas Fabric.js est désormais disponible
  const isReady = true;

  const { isLockedByOther } = useBlockLock({
    lockedBy,
    lockedAt,
    modalOpen,
    updateAttributes,
  });

  // Ouverture possible (bloc cliquable) : prêt, éditable, non verrouillé par autrui.
  const canOpen = isReady && !!editable && !isLockedByOther;

  const handleOpen = useCallback(() => {
    if (isLockedByOther || !editable) return;
    if (!designId) {
      const newId = crypto.randomUUID();
      updateAttributes({ designId: newId });
    }
    setModalOpen(true);
  }, [isLockedByOther, editable, designId, updateAttributes]);

  const handleClose = useCallback(() => {
    setModalOpen(false);
  }, []);

  return (
    <NodeViewWrapper data-type="design-block" className={`editor-block-wrapper ${selected ? "is-selected" : ""}`}>
      <div className="editor-block" contentEditable={false}>
        {/* Toolbar */}
        <div className={`editor-block-toolbar ${selected ? "is-visible" : ""}`}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span data-drag-handle className="cursor-grab shrink-0">
              <GripHorizontal className="h-4 w-4 text-muted-foreground" />
            </span>
            <Palette className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={title || ""}
              onChange={(e) => updateAttributes({ title: e.target.value })}
              // Le node designBlock est `draggable: true` : sans ces gardes, un
              // clic-glisser dans le champ déclenche le drag HTML5 du bloc au lieu
              // de sélectionner le texte. `draggable={false}` exclut l'input comme
              // source de drag et `onDragStart` neutralise tout drag résiduel.
              draggable={false}
              onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onMouseDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder="Studio"
              className="flex-1 px-1.5 py-0.5 text-xs font-medium rounded border-none bg-transparent focus:outline-none focus:ring-1 focus:ring-primary truncate"
              readOnly={!editable}
            />
          </div>
          <div className="flex items-center gap-1">
            <ModalLockBanner isLocked={isLockedByOther} />
            {!isReady && (
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full shrink-0">
                Canvas bientôt disponible
              </span>
            )}
            {isReady && !isLockedByOther && editable && (
              <Button
                size="xs"
                onClick={handleOpen}
                className="bg-emerald-700 hover:bg-emerald-800 text-white"
                title={designId ? "Ouvrir le canvas" : "Créer et ouvrir"}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="text-[11px]">Ouvrir</span>
              </Button>
            )}
            {editable && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={deleteNode}
                title="Supprimer le bloc"
                aria-label="Supprimer le bloc design canvas"
                className="hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Contenu — miniature ou placeholder. Cliquable pour ouvrir le Studio
            (le texte « Cliquer pour ouvrir » devient ainsi exact). */}
        <div
          className={`editor-block-content ${canOpen ? "cursor-pointer" : ""}`}
          onClick={canOpen ? handleOpen : undefined}
          role={canOpen ? "button" : undefined}
          tabIndex={canOpen ? 0 : undefined}
          onKeyDown={canOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpen(); } } : undefined}
          title={canOpen ? (designId ? "Ouvrir le canvas" : "Créer et ouvrir") : undefined}
        >
          {thumbSrc && brokenSrc !== thumbSrc && !thumbGone ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbSrc}
              onError={() => setBrokenSrc(thumbSrc)}
              alt={title || "Design"}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground/40">
              <Palette className="h-10 w-10" />
              <span className="text-xs">Cliquer pour ouvrir Studio</span>
            </div>
          )}
        </div>
      </div>

      {/* Modale canvas Fabric.js */}
      {modalOpen && designId && (
        <DesignModal
          designId={designId}
          documentId={getMetaDocId(editor)}
          title={title || "Design"}
          thumbnailUrl={thumbnailUrl}
          lockedBy={lockedBy ?? null}
          lockedAt={lockedAt ?? null}
          updateAttributes={updateAttributes}
          onClose={handleClose}
        />
      )}
    </NodeViewWrapper>
  );
}
