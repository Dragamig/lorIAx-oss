"use client";

import { Tooltip } from "@base-ui/react/tooltip";

/** Info-bulle (survol et focus clavier) : libellé et raccourci éventuel. */
export function Tip({
  label,
  kbd,
  aboveToasts,
  children,
}: {
  label: string;
  kbd?: string;
  /** Info-bulle d'un contrôle posé dans un toast sonner (z-index 999999999) : sinon elle passe dessous. */
  aboveToasts?: boolean;
  children: React.ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} className={aboveToasts ? "z-[1000000000]" : "z-[70]"}>
          <Tooltip.Popup className="flex max-w-64 items-center gap-2 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md">
            <span>{label}</span>
            {kbd && <kbd className="rounded bg-background/20 px-1 font-mono text-[10px]">{kbd}</kbd>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
