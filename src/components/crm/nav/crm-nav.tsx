"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { BellRing, Briefcase, ChevronDown, ChevronRight, FolderOpen, Kanban, Link2, Users } from "lucide-react";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import type { CrmStatus } from "@/lib/crm/use-crm-status";
import { RelancesBadge, useRelancesBadgeCount } from "./relances-badge";

export const CRM_NAV_STORAGE_KEY = "loriax:crm-nav-open";

interface CrmNavProps {
  pathname: string;
  status: CrmStatus;
}

function readStored(): boolean | null {
  try {
    const v = window.localStorage.getItem(CRM_NAV_STORAGE_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

function writeStored(open: boolean): void {
  try {
    window.localStorage.setItem(CRM_NAV_STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* stockage indisponible : l'état reste en mémoire */
  }
}

const ITEM_CLASS =
  "flex min-h-7 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

function itemClass(active: boolean): string {
  return `${ITEM_CLASS} ${active ? "bg-sidebar-accent font-medium" : "hover:bg-sidebar-accent"}`;
}

function RelancesEntry({ active, label, tip }: { active: boolean; label: string; tip: string }) {
  const t = useTranslations("crm.nav");
  const count = useRelancesBadgeCount();
  const aria =
    count === 0
      ? label
      : count === 1
        ? t("relancesAriaOne", { label, count: String(count) })
        : t("relancesAria", { label, count: String(count) });
  return (
    <Tip label={tip}>
      <Link href="/crm/relances" aria-label={aria} aria-current={active ? "page" : undefined} className={itemClass(active)}>
        <BellRing className="h-4 w-4" aria-hidden="true" />
        <span>{label}</span>
        <RelancesBadge count={count} />
      </Link>
    </Tip>
  );
}

export function CrmNav({ pathname, status }: CrmNavProps) {
  const t = useTranslations("crm.nav");
  const listId = useId();
  const inCrm = pathname === "/crm" || pathname.startsWith("/crm/");
  const [open, setOpen] = useState(() => inCrm);
  const [seenInCrm, setSeenInCrm] = useState(inCrm);
  const inCrmAtMount = useRef(inCrm);

  // Entrée dans /crm pendant que le menu est monté : ouverture pendant le rendu, sans effet.
  if (inCrm !== seenInCrm) {
    setSeenInCrm(inCrm);
    if (inCrm) setOpen(true);
  }

  useEffect(() => {
    const stored = readStored();
    if (stored !== null && !inCrmAtMount.current) setOpen(stored);
  }, []);

  const connected = status.enabled && status.complete;
  const showRaccordement = status.canAdmin;

  const toggle = (next: boolean) => {
    setOpen(next);
    writeStored(next);
  };

  const notConnectedBadge = !status.complete && (
    <Tip label={t("notConnectedTip")}>
      <span
        role="img"
        aria-label={t("notConnectedAria")}
        className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/20 px-1 text-xs font-semibold leading-none text-amber-700 dark:text-amber-300"
      >
        !
      </span>
    </Tip>
  );

  // Rien à déplier : un non-admin sur un CRM non raccordé garde un lien simple.
  if (!connected && !showRaccordement) {
    return (
      <Link href="/crm" className={itemClass(inCrm)} aria-current={pathname === "/crm" ? "page" : undefined}>
        <Briefcase className="h-4 w-4" aria-hidden="true" />
        {t("crm")}
        {notConnectedBadge}
      </Link>
    );
  }

  const toggleLabel = `${t("crm")} : ${open ? t("collapse") : t("expand")}`;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div>
      <Tip label={toggleLabel}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={status.complete ? toggleLabel : `${toggleLabel}, ${t("notConnectedAria")}`}
          onClick={() => toggle(!open)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" && !open) {
              e.preventDefault();
              toggle(true);
            } else if (e.key === "ArrowLeft" && open) {
              e.preventDefault();
              toggle(false);
            }
          }}
          className={`${itemClass(inCrm && !open)} w-full text-left`}
        >
          <Briefcase className="h-4 w-4" aria-hidden="true" />
          <span>{t("crm")}</span>
          {notConnectedBadge}
          <Chevron className={`h-4 w-4 ${notConnectedBadge ? "" : "ml-auto"}`} aria-hidden="true" />
        </button>
      </Tip>
      <div id={listId} hidden={!open} className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
        {connected && (
          <>
            <SubLink href="/crm" icon={<Kanban className="h-4 w-4" aria-hidden="true" />} label={t("pipeline")} active={pathname === "/crm"} />
            <RelancesEntry active={pathname.startsWith("/crm/relances")} label={t("relances")} tip={t("relancesTip")} />
            <SubLink href="/crm/dossiers" icon={<FolderOpen className="h-4 w-4" aria-hidden="true" />} label={t("dossiers")} active={pathname.startsWith("/crm/dossiers")} />
            <SubLink href="/crm/contacts" icon={<Users className="h-4 w-4" aria-hidden="true" />} label={t("contacts")} active={pathname.startsWith("/crm/contacts")} />
          </>
        )}
        {showRaccordement && (
          <SubLink href="/crm/raccordement" icon={<Link2 className="h-4 w-4" aria-hidden="true" />} label={t("raccordement")} active={pathname.startsWith("/crm/raccordement")} />
        )}
      </div>
    </div>
  );
}

function SubLink({ href, icon, label, active }: { href: string; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <Tip label={label}>
      <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={itemClass(active)}>
        {icon}
        <span>{label}</span>
      </Link>
    </Tip>
  );
}
