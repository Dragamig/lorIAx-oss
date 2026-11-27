import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type Tone = "neutral" | "ok" | "warn";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-foreground",
  ok: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
};

/** Centered status card shared by the closed-registration, check-email and verify-email screens. */
export function AuthStatusCard({
  icon: Icon,
  tone = "neutral",
  spin = false,
  title,
  children,
}: {
  icon: LucideIcon;
  tone?: Tone;
  spin?: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
        <div className={`grid size-12 place-items-center rounded-full ${TONE_CLASS[tone]}`}>
          <Icon className={`size-6 ${spin ? "animate-spin" : ""}`} aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {children}
      </CardContent>
    </Card>
  );
}

/** Shared page frame for the status screens (same background as the register page). */
export function AuthStatusFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
