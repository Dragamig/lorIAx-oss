"use client";

import { useTransition } from "react";
import { useRouter, usePathname } from "@/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { setUserLocale } from "@/lib/actions/user-locale";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Globe } from "lucide-react";

export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchLocale(next: Locale) {
    if (next === locale) return;
    startTransition(async () => {
      // Persister cookie + BDD (best-effort — les erreurs DB sont loguées côté serveur)
      // TODO Stage 1 (intégration UI) : feedback utilisateur (toast) si la persistance échoue
      await setUserLocale(next).catch((err) => console.error("setUserLocale failed", err));
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
            disabled={isPending}
            aria-label={t("localeSwitcherAria")}
            title={t("localeSwitcherAria")}
          />
        }
      >
        <Globe className="h-4 w-4" />
        <span className="text-xs font-medium uppercase">{locale}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" sideOffset={4}>
        {LOCALES.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => switchLocale(loc)}
            className={loc === locale ? "font-semibold" : ""}
          >
            {LOCALE_LABELS[loc]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Variant for embedding inside an existing DropdownMenu (e.g. the user menu in sidebar footer).
export function LocaleSubMenu({ label }: { label: string }) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchLocale(next: Locale) {
    if (next === locale) return;
    startTransition(async () => {
      await setUserLocale(next).catch((err) => console.error("setUserLocale failed", err));
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={isPending} className="gap-2">
        <Globe className="h-4 w-4" />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {LOCALES.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => switchLocale(loc)}
            className={loc === locale ? "font-semibold" : ""}
          >
            {LOCALE_LABELS[loc]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
