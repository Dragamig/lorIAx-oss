"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, SkipForward, Loader2, ShieldCheck } from "lucide-react";
import type { SetupData } from "@/app/[locale]/(setup)/setup/page";
import { setupFetch } from "@/lib/setup/client";

type PermissionLevel = "" | "viewer" | "editor" | "admin";

interface StepPermissionsProps {
  data: SetupData;
  onUpdate: (permissions: SetupData["permissions"]) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack?: () => void;
}

type MatrixKey = `${string}:${string}`;

function defaultLevel(role: string): PermissionLevel {
  if (role === "super_admin" || role === "admin") return "admin";
  return "editor";
}

export function StepPermissions({ data, onUpdate, onNext, onSkip, onBack }: StepPermissionsProps) {
  const t = useTranslations("setup.permissions");

  const LEVEL_LABELS: Record<PermissionLevel, string> = {
    "": t("levels.none"),
    viewer: t("levels.viewer"),
    editor: t("levels.editor"),
    admin: t("levels.admin"),
  };

  // Build initial matrix: space × user → level
  const initialMatrix = useMemo<Record<MatrixKey, PermissionLevel>>(() => {
    const matrix: Record<MatrixKey, PermissionLevel> = {};
    for (const space of data.spaces) {
      for (const user of data.users) {
        const key: MatrixKey = `${space.id}:${user.id}`;
        matrix[key] = defaultLevel(user.role);
      }
    }
    return matrix;
  }, [data.spaces, data.users]);

  const [matrix, setMatrix] = useState<Record<MatrixKey, PermissionLevel>>(initialMatrix);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleChange(spaceId: string, userId: string, level: PermissionLevel) {
    const key: MatrixKey = `${spaceId}:${userId}`;
    setMatrix((prev) => ({ ...prev, [key]: level }));
  }

  async function handleNext() {
    setSaving(true);
    setError("");

    // Collect only non-empty permissions
    const permissions: SetupData["permissions"] = [];
    for (const space of data.spaces) {
      for (const user of data.users) {
        const key: MatrixKey = `${space.id}:${user.id}`;
        const level = matrix[key];
        if (level) {
          permissions.push({ spaceId: space.id, userId: user.id, level });
        }
      }
    }

    try {
      if (permissions.length > 0) {
        const res = await setupFetch("/api/setup/permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissions }),
        });

        if (!res.ok) {
          try {
            const err = await res.json();
            throw new Error(err.error || t("errors.saveError"));
          } catch (parseErr) {
            throw new Error(t("errors.unexpectedError"));
          }
        }
      }

      onUpdate(permissions);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unexpectedError"));
    } finally {
      setSaving(false);
    }
  }

  const hasData = data.spaces.length > 0 && data.users.length > 0;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <ShieldCheck className="h-12 w-12 text-primary mx-auto mb-3" />
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("description")}
        </p>
      </div>

      {!hasData && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t("empty")}
        </p>
      )}

      {hasData && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {t("spaceColumn")}
                </th>
                {data.users.map((user) => (
                  <th
                    key={user.id}
                    className="px-4 py-3 text-center font-medium text-muted-foreground min-w-[140px]"
                  >
                    <div className="truncate max-w-[130px] mx-auto" title={user.name}>
                      {user.name}
                    </div>
                    <div className="text-xs font-normal text-muted-foreground/70 truncate max-w-[130px] mx-auto">
                      {user.role}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.spaces.map((space, spaceIdx) => (
                <tr
                  key={space.id}
                  className={spaceIdx % 2 === 0 ? "bg-background" : "bg-muted/20"}
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {space.icon && <span>{space.icon}</span>}
                      <span>{space.name}</span>
                    </div>
                  </td>
                  {data.users.map((user) => {
                    const key: MatrixKey = `${space.id}:${user.id}`;
                    const level = matrix[key] ?? "";
                    return (
                      <td key={user.id} className="px-4 py-3 text-center">
                        <select
                          value={level}
                          onChange={(e) =>
                            handleChange(space.id, user.id, e.target.value as PermissionLevel)
                          }
                          className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-full max-w-[130px]"
                        >
                          {(Object.entries(LEVEL_LABELS) as [PermissionLevel, string][]).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            )
                          )}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-between">
        <div className="flex gap-2">
          {onBack && (
            <Button variant="ghost" onClick={onBack} disabled={saving} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("previous")}
            </Button>
          )}
          <Button variant="ghost" onClick={onSkip} disabled={saving} className="gap-2">
            <SkipForward className="h-4 w-4" />
            {t("skip")}
          </Button>
        </div>
        <Button onClick={handleNext} disabled={saving} className="gap-2">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
