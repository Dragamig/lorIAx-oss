/**
 * Modèle pur du bloc Activité d'une fiche CRM : fusion des interactions, tâches et mails
 * en une seule liste triée. Aucun accès base, aucune dépendance React.
 * Un mail et son interaction liée coexistent : aucun dédoublonnage.
 */
import type { InteractionDto } from "./deal-model";
import type { RelanceTask } from "./relances";
import type { MailMessageDto, MailErrorUiCode } from "@/lib/mailing/threads";

export type MailStatus = "scheduled" | "sending" | "sent" | "failed";

export type ActivityFilter = "all" | "interaction" | "mail" | "task";

export type ActivityTask = Pick<RelanceTask, "id" | "title" | "dueAt"> & Partial<RelanceTask> & {
  status?: "open" | "in_progress" | "done" | "cancelled";
  assigneeId?: string | null;
  createdBy?: string;
  /** Calculé côté serveur : assigné ou auteur (même règle que PATCH /api/tasks/[id]). */
  canToggle?: boolean;
};

export interface InteractionActivity {
  kind: "interaction";
  id: string;
  date: string | null;
  interaction: InteractionDto;
}

export interface TaskActivity {
  kind: "task";
  id: string;
  date: string | null;
  task: ActivityTask;
}

export interface MailActivity {
  kind: "mail";
  id: string;
  date: string | null;
  status: MailStatus;
  error: MailErrorUiCode | null;
  retryable: boolean;
  mail: MailMessageDto;
}

export type ActivityItem = InteractionActivity | TaskActivity | MailActivity;

export interface ActivitySources {
  interactions: InteractionDto[];
  tasks: ActivityTask[];
  mails: MailMessageDto[];
}

const DISPLAYABLE: readonly string[] = ["scheduled", "sending", "sent", "failed"];

export const toInteractionActivity = (interaction: InteractionDto): InteractionActivity => ({
  kind: "interaction",
  id: interaction.id,
  date: interaction.date,
  interaction,
});

export const toTaskActivity = (task: ActivityTask): TaskActivity => ({
  kind: "task",
  id: task.id,
  date: task.dueAt,
  task,
});

/** Null pour un mail hors statuts affichables (annulé, reçu). */
export function toMailActivity(mail: MailMessageDto): MailActivity | null {
  if (!DISPLAYABLE.includes(mail.status)) return null;
  const status = mail.status as MailStatus;
  return {
    kind: "mail",
    id: mail.id,
    date: mail.date,
    status,
    error: mail.error,
    retryable: status === "failed" && mail.error !== "delivery_unknown",
    mail,
  };
}

/** Clé i18n du badge d'un mail (traduite en tâche 8). */
export const mailBadge = (status: MailStatus): string => `fiche.activity.mail.badge.${status}`;

const time = (d: string | null): number | null => {
  if (d === null) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : t;
};

function compare(a: ActivityItem, b: ActivityItem): number {
  const ta = time(a.date);
  const tb = time(b.date);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function mergeActivity(sources: ActivitySources): ActivityItem[] {
  const mails = sources.mails.map(toMailActivity).filter((m): m is MailActivity => m !== null);
  return [
    ...sources.interactions.map(toInteractionActivity),
    ...sources.tasks.map(toTaskActivity),
    ...mails,
  ].sort(compare);
}

export function filterActivity(items: ActivityItem[], filter: ActivityFilter): ActivityItem[] {
  return filter === "all" ? items : items.filter((i) => i.kind === filter);
}
