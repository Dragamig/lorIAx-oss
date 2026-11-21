"use client";

import { usePathname, Link } from "@/i18n/routing";
import { Mail, FileText, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { BackToServices } from "@/components/admin/back-to-services";

const navItems = [
  { href: "/admin/emails", label: "Configuration", icon: Mail, exact: true },
  { href: "/admin/emails/templates", label: "Courriels types", icon: FileText },
  { href: "/admin/emails/logs", label: "Historique", icon: History },
];

export default function AdminEmailsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-4">
        <BackToServices />
      </div>
      <nav className="shrink-0 border-b bg-muted/30 px-4">
        <div className="flex items-center gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 px-3 py-3 text-sm whitespace-nowrap border-b-2 transition-colors",
                  isActive
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
