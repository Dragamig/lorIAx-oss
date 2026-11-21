import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const preserveFieldSelectionKey = new PluginKey("preserveFieldSelection");

/**
 * Les node-views custom déclarent `draggable: true` au niveau du nœud
 * ProseMirror, ce qui pose `draggable="true"` sur le wrapper DOM. Le drag
 * natif du navigateur intercepte alors les gestes de sélection de texte
 * (glisser pour sélectionner, double-clic puis glisser) dans les champs
 * `<input>`/`<textarea>` internes des blocs (ex. le champ nom d'un bloc).
 *
 * On neutralise le drag natif uniquement quand l'interaction démarre sur un
 * contrôle de formulaire, sans toucher au drag de bloc (déclenché ailleurs sur
 * le wrapper). Les écouteurs sont en phase de capture pour passer avant le
 * comportement par défaut du navigateur : `dragstart` cible le plus proche
 * ancêtre draggable (le wrapper), pas l'input, d'où le flag posé au `mousedown`.
 */
export const PreserveFieldSelection = Extension.create({
  name: "preserveFieldSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: preserveFieldSelectionKey,

        view(editorView) {
          const isInteractiveTarget = (target: EventTarget | null) => {
            if (!(target instanceof Element)) return false;
            if (target.closest("input, textarea, select")) return true;
            const editable = target.closest('[contenteditable="true"]');
            return !!editable && editable !== editorView.dom;
          };

          let suppressNativeDrag = false;
          const handleMouseDownCapture = (event: MouseEvent) => {
            suppressNativeDrag = isInteractiveTarget(event.target);
          };
          const handleDragStartCapture = (event: DragEvent) => {
            if (suppressNativeDrag) {
              event.preventDefault();
              event.stopPropagation();
            }
          };
          const handleMouseUpCapture = () => {
            suppressNativeDrag = false;
          };

          editorView.dom.addEventListener(
            "mousedown",
            handleMouseDownCapture,
            true
          );
          editorView.dom.addEventListener(
            "dragstart",
            handleDragStartCapture,
            true
          );
          editorView.dom.addEventListener(
            "mouseup",
            handleMouseUpCapture,
            true
          );

          return {
            destroy() {
              editorView.dom.removeEventListener(
                "mousedown",
                handleMouseDownCapture,
                true
              );
              editorView.dom.removeEventListener(
                "dragstart",
                handleDragStartCapture,
                true
              );
              editorView.dom.removeEventListener(
                "mouseup",
                handleMouseUpCapture,
                true
              );
            },
          };
        },
      }),
    ];
  },
});
