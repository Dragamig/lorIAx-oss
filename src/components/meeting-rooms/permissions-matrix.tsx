"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Users, User, Shield } from "lucide-react";
import { useTranslations } from "next-intl";

interface Principal {
  id: string;
  name: string;
  email?: string;
}

type PrincipalType = "user" | "team" | "role";

interface Permission {
  principalType: PrincipalType;
  principalId: string;
  canBook: boolean;
}

interface Props {
  roomId: string;
}

export function PermissionsMatrix({ roomId }: Props) {
  const t = useTranslations("organisation");
  const [users, setUsers] = useState<Principal[]>([]);
  const [teams, setTeams] = useState<Principal[]>([]);
  const [roles, setRoles] = useState<Principal[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [principalsRes, pRes] = await Promise.all([
          fetch("/api/meeting-rooms/principals"),
          fetch(`/api/meeting-rooms/${roomId}/permissions`),
        ]);
        if (cancelled) return;
        const principals = principalsRes.ok
          ? await principalsRes.json()
          : { users: [], teams: [], roles: [] };
        const pJson = pRes.ok ? await pRes.json() : [];
        setUsers(principals.users ?? []);
        setTeams(principals.teams ?? []);
        setRoles(principals.roles ?? []);
        setPerms(pJson);
      } catch {
        toast.error(t("toasts.permissionsError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [roomId, t]);

  function isAuthorized(type: PrincipalType, id: string): boolean {
    return perms.some(
      (p) => p.principalType === type && p.principalId === id && p.canBook
    );
  }

  async function toggle(type: PrincipalType, id: string) {
    const key = `${type}-${id}`;
    setSavingKey(key);
    try {
      const authorized = isAuthorized(type, id);
      if (authorized) {
        const res = await fetch(`/api/meeting-rooms/${roomId}/permissions`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ principalType: type, principalId: id }),
        });
        if (!res.ok) throw new Error();
        setPerms((prev) =>
          prev.filter((p) => !(p.principalType === type && p.principalId === id))
        );
      } else {
        const res = await fetch(`/api/meeting-rooms/${roomId}/permissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            principalType: type,
            principalId: id,
            canBook: true,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || t("toasts.genericError"));
        }
        setPerms((prev) => [
          ...prev.filter((p) => !(p.principalType === type && p.principalId === id)),
          { principalType: type, principalId: id, canBook: true },
        ]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toasts.permissionsUpdateError"));
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {t("permissions.description")}
      </p>

      {roles.length > 0 && (
        <PrincipalSection
          title={t("permissions.rolesTitle")}
          icon={<Shield className="h-3.5 w-3.5" />}
          principals={roles}
          type="role"
          isAuthorized={isAuthorized}
          onToggle={toggle}
          savingKey={savingKey}
          allowAriaLabel={(name) => t("permissions.allowAria", { name })}
        />
      )}

      {teams.length > 0 && (
        <PrincipalSection
          title={t("permissions.teamsTitle")}
          icon={<Users className="h-3.5 w-3.5" />}
          principals={teams}
          type="team"
          isAuthorized={isAuthorized}
          onToggle={toggle}
          savingKey={savingKey}
          allowAriaLabel={(name) => t("permissions.allowAria", { name })}
        />
      )}

      <PrincipalSection
        title={t("permissions.usersTitle")}
        icon={<User className="h-3.5 w-3.5" />}
        principals={users}
        type="user"
        isAuthorized={isAuthorized}
        onToggle={toggle}
        savingKey={savingKey}
        allowAriaLabel={(name) => t("permissions.allowAria", { name })}
        scrollable
      />
    </div>
  );
}

interface PrincipalSectionProps {
  title: string;
  icon: React.ReactNode;
  principals: Principal[];
  type: PrincipalType;
  isAuthorized: (type: PrincipalType, id: string) => boolean;
  onToggle: (type: PrincipalType, id: string) => void;
  savingKey: string | null;
  allowAriaLabel: (name: string) => string;
  scrollable?: boolean;
}

function PrincipalSection({
  title,
  icon,
  principals,
  type,
  isAuthorized,
  onToggle,
  savingKey,
  allowAriaLabel,
  scrollable,
}: PrincipalSectionProps) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </h4>
      <ul
        className={`divide-y divide-border rounded-md border border-border ${
          scrollable ? "max-h-72 overflow-y-auto" : ""
        }`}
      >
        {principals.map((p) => {
          const authorized = isAuthorized(type, p.id);
          const key = `${type}-${p.id}`;
          return (
            <li key={p.id} className="flex items-center justify-between px-3 py-2">
              <div className="flex flex-col">
                <span className="text-sm">{p.name}</span>
                {p.email && (
                  <span className="text-xs text-muted-foreground">{p.email}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onToggle(type, p.id)}
                disabled={savingKey === key}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  authorized ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
                }`}
                aria-label={allowAriaLabel(p.name)}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    authorized ? "translate-x-4.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
