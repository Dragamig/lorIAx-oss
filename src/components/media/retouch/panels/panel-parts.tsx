import type { ReactNode } from "react";
import type { RetouchOp, RetouchRecipe } from "../recipe";

export interface PanelProps {
  recipe: RetouchRecipe;
  onChange: (op: RetouchOp) => void;
}

/** Section de panneau de propriétés : titre compact et corps. */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-border border-b px-3 py-2.5 last:border-b-0" aria-label={title}>
      <h3 className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-wide uppercase">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

export function Hint({ children, role }: { children: ReactNode; role?: "status" | "alert" }) {
  return (
    <p role={role} className="text-muted-foreground text-xs">
      {children}
    </p>
  );
}
