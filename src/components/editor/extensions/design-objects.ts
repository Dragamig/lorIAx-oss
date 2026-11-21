// Opérations sur la sélection : duplication, suppression, groupes.
// Règle Fabric v7 : toujours discardActiveObject() AVANT de lire les coordonnées,
// les enfants d'une ActiveSelection ont des coordonnées relatives au groupe.
import type { Canvas as FabricCanvas, FabricObject } from "fabric";

const DUPLICATE_OFFSET = 12;

export async function duplicateSelection(canvas: FabricCanvas): Promise<void> {
  const objs = canvas.getActiveObjects();
  if (objs.length === 0) return;
  canvas.discardActiveObject();

  const clones: FabricObject[] = [];
  for (const obj of objs) {
    const clone = await obj.clone();
    clone.set({
      left: (clone.left ?? 0) + DUPLICATE_OFFSET,
      top: (clone.top ?? 0) + DUPLICATE_OFFSET,
    });
    canvas.add(clone);
    clones.push(clone);
  }

  if (clones.length === 1) {
    canvas.setActiveObject(clones[0]);
  } else {
    const { ActiveSelection } = await import("fabric");
    canvas.setActiveObject(new ActiveSelection(clones, { canvas }));
  }
  canvas.requestRenderAll();
}

export function deleteSelection(canvas: FabricCanvas): void {
  const objs = canvas.getActiveObjects();
  if (objs.length === 0) return;
  canvas.discardActiveObject();
  canvas.remove(...objs);
  canvas.requestRenderAll();
}

export async function groupSelection(canvas: FabricCanvas): Promise<void> {
  const { ActiveSelection, Group } = await import("fabric");
  const sel = canvas.getActiveObject();
  if (!(sel instanceof ActiveSelection)) return;
  const children = sel.removeAll() as FabricObject[];
  canvas.remove(...children);
  const group = new Group(children);
  canvas.add(group);
  canvas.setActiveObject(group);
  canvas.requestRenderAll();
  canvas.fire("object:modified", {} as never);
}

export async function ungroupSelection(canvas: FabricCanvas): Promise<void> {
  const { ActiveSelection, Group } = await import("fabric");
  const sel = canvas.getActiveObject();
  // ActiveSelection hérite de Group : exclure explicitement
  if (!(sel instanceof Group) || sel instanceof ActiveSelection) return;
  canvas.remove(sel);
  const children = sel.removeAll() as FabricObject[];
  canvas.add(...children);
  canvas.setActiveObject(new ActiveSelection(children, { canvas }));
  canvas.requestRenderAll();
  canvas.fire("object:modified", {} as never);
}
