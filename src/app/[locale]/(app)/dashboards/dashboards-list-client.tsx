"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DashboardDef } from "@/lib/dashboards/types";

export function DashboardsListClient({
  spaceId,
  initial,
}: {
  spaceId: string;
  initial: DashboardDef[];
}) {
  const t = useTranslations("dashboards");
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), spaceId }),
      });
      if (res.ok) {
        const d = await res.json();
        router.push(`/dashboards/${d.id}?spaceId=${spaceId}`);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">{t("title")}</h1>
      <div className="flex gap-2 mb-6">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("newPlaceholder")}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <Button onClick={create} disabled={creating}>
          {t("newButton")}
        </Button>
      </div>
      {initial.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {t("empty")}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {initial.map((d) => (
            <Link
              key={d.id}
              href={`/dashboards/${d.id}?spaceId=${spaceId}`}
              className="border rounded-lg p-4 hover:bg-accent transition-colors"
            >
              <div className="font-medium">{d.name}</div>
              {d.description && (
                <div className="text-xs text-neutral-500 mt-1">
                  {d.description}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
